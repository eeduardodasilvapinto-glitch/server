/* ================================================================
   Veltris WPP Server - WhatsApp Baileys Backend (Multi-Session)
   Gerencia N sessoes do WhatsApp, isoladas por usuario/empresa
   ================================================================ */

import { makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } from '@whiskeysockets/baileys'
import { createClient } from '@supabase/supabase-js'
import QRCode from 'qrcode'
import pino from 'pino'
import fs from 'fs'
import path from 'path'
import http from 'http'
import WebSocket from 'ws'
import 'dotenv/config'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const AUTH_BASE = process.env.WPP_AUTH_DIR || './auth'
const MEDIA_DIR = process.env.WPP_MEDIA_DIR || './media'
const HTTP_PORT = process.env.PORT || process.env.WPP_HTTP_PORT || 3123

const logger = pino({ level: process.env.LOG_LEVEL || 'info' })
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false }, transport: WebSocket })

if (!fs.existsSync(AUTH_BASE)) fs.mkdirSync(AUTH_BASE, { recursive: true })
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true })

// Map<sessionId, { sock, authDir, qrCode, outgoingInterval, reconnectTimeout, phone, status }>
const sessions = new Map()

/* ------------------------------------------------------------------ */
/*  Baileys instance                                                  */
/* ------------------------------------------------------------------ */
async function startSession(sessionId, userId, companyId) {
  logger.info({ sessionId }, 'startSession called')
  if (sessions.has(sessionId)) {
    const existing = sessions.get(sessionId)
    if (existing.sock) { logger.info({ sessionId }, 'Session already has socket'); return }
  }

  const authDir = path.join(AUTH_BASE, sessionId)
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true })

  const entry = { sock: null, authDir, qrCode: null, outgoingInterval: null, reconnectTimeout: null, phone: null, status: 'connecting', userId, companyId }
  sessions.set(sessionId, entry)

  const { state, saveCreds } = await useMultiFileAuthState(authDir)
  const { version } = await (async () => {
    try {
      const { fetchLatestBaileysVersion } = await import('@whiskeysockets/baileys')
      return await fetchLatestBaileysVersion()
    } catch { return { version: [2, 3000, 0] } }
  })()

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: ['Veltris CRM', 'Chrome', '1.0.0'],
    logger: pino({ level: 'silent' }),
    markOnlineOnConnect: true,
    syncFullHistory: true,
  })

  entry.sock = sock
  entry.labels = {}      // labelId → {id, name, hexColor}
  entry.chatLabels = {}  // chatJid → [labelId]
  logger.info({ sessionId }, 'Baileys socket created, waiting for QR')

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async ({ qr, connection, lastDisconnect }) => {
    if (qr) {
      try {
        // Only show first QR, keep it until scanned
        if (!entry.qrCode) {
          const qrDataUrl = await QRCode.toDataURL(qr)
          entry.qrCode = qrDataUrl
          console.log(`\n[${sessionId}] QR Code gerado`)
          try {
            const qrTerminal = await QRCode.toString(qr, { type: 'terminal', small: true })
            console.log(qrTerminal)
          } catch {}
          logger.info({ sessionId }, 'QR Code generated')
          await supabase.from('whatsapp_sessions').update({ qr_code: qrDataUrl, status: 'connecting' }).eq('id', sessionId)
        }
      } catch (e) {
        logger.error({ sessionId, error: e.message }, 'Failed to save QR code')
      }
    }

    if (connection === 'open') {
      logger.info({ sessionId }, 'WhatsApp connected')
      entry.status = 'connected'
      entry.qrCode = null
      const rawId = sock.user?.id || ''
      const phone = rawId.split(':')[0] || ''
      entry.phone = phone
      await supabase.from('whatsapp_sessions').update({ status: 'connected', phone, qr_code: null }).eq('id', sessionId)
      startOutgoingPump(sessionId)
      syncContacts(sessionId, companyId)
      try {
        var { data: labelData } = await supabase.from('whatsapp_labels').select('*').eq('session_id', sessionId)
        if (labelData) { for (var lb of labelData) { entry.labels[lb.label_id] = { id: lb.label_id, name: lb.name, hexColor: lb.color } } }
        var { data: assocData } = await supabase.from('whatsapp_label_assocs').select('*').eq('session_id', sessionId)
        if (assocData) { for (var la of assocData) { if (!entry.chatLabels[la.chat_jid]) entry.chatLabels[la.chat_jid] = []; entry.chatLabels[la.chat_jid].push(la.label_id) } }
      } catch(e) {}
      // Also try to load existing chats from store after history sync
      setTimeout(() => loadExistingChatsFromStore(sessionId, companyId), 15000)
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut
      logger.info({ sessionId, code: statusCode, shouldReconnect }, 'Connection closed')
      entry.status = shouldReconnect ? 'connecting' : 'disconnected'
      entry.qrCode = null
      entry.sock = null
      stopOutgoingPump(sessionId)
      await supabase.from('whatsapp_sessions').update({ status: entry.status }).eq('id', sessionId)
      if (shouldReconnect) {
        entry.reconnectTimeout = setTimeout(() => startSession(sessionId, userId, companyId), 5000)
      } else {
        logger.warn({ sessionId }, 'Logged out. Clearing auth.')
        try { fs.rmSync(authDir, { recursive: true, force: true }) } catch {}
        sessions.delete(sessionId)
      }
    }
  })

  sock.ev.on('messaging-history.set', async ({ chats, contacts: historyContacts, messages }) => {
    try {
      logger.info({ sessionId, chats: chats?.length, contacts: historyContacts?.length, messages: messages?.length }, 'History sync received')
      // Save messages to DB (batched, non-blocking)
      if (messages && messages.length > 0) {
        try {
          // Build jid→chatId map from ALL chats in DB
          var chatIdByJid = {}
          var { data: allDbChats } = await supabase.from('whatsapp_chats').select('id,remote_jid')
          if (allDbChats) {
            for (var dbc of allDbChats) {
              var fullJid = dbc.remote_jid
              var shortJid = fullJid ? fullJid.split('@')[0] : ''
              chatIdByJid[fullJid] = dbc.id
              chatIdByJid[shortJid] = dbc.id
              // Also try with +55 variations
              if (shortJid.startsWith('55')) {
                chatIdByJid[shortJid.substring(2)] = dbc.id
              } else {
                chatIdByJid['55' + shortJid] = dbc.id
              }
            }
          }
          // Batch insert messages
          const inserts = []
          var skippedNoJid = 0, skippedNoChat = 0, skippedNoContent = 0
          for (const msg of messages) {
            const jid = msg.key?.remoteJid
            if (!jid) { skippedNoJid++; continue }
            const shortJid = jid.split('@')[0]
            const chatId = chatIdByJid[jid] || chatIdByJid[shortJid]
            if (!chatId) { skippedNoChat++; continue }
            const msgContent = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || msg.message?.videoMessage?.caption || msg.message?.documentMessage?.caption || ''
            if (!msgContent) { skippedNoContent++; continue }
          const direction = msg.key.fromMe ? 'sent' : 'received'
            const msgTs = msg.messageTimestamp ? new Date(msg.messageTimestamp * 1000).toISOString() : new Date().toISOString()
            inserts.push({ chat_id: chatId, session_id: sessionId, text: msgContent.substring(0, 500), direction, created_at: msgTs })
          }
          logger.info({ sessionId, total: messages.length, skippedNoJid, skippedNoChat, skippedNoContent, inserts: inserts.length }, 'Message processing stats')
          // Bulk insert in chunks of 100
          var insertOk = 0, insertErr = 0
          for (let bi = 0; bi < inserts.length; bi += 100) {
            var { error: insErr } = await supabase.from('whatsapp_messages').insert(inserts.slice(bi, bi + 100))
            if (insErr) { insertErr++; console.error('INSERT ERROR:', JSON.stringify(insErr), 'batch', bi) }
            else { insertOk++ }
          }
          logger.info({ sessionId, prepared: inserts.length, chunksOk: insertOk, chunksErr: insertErr }, 'History messages saved')
        } catch (e) {
          logger.error({ sessionId, error: e.message }, 'Error saving history messages')
        }
      }
      // Build contact name map from history contacts
      const nameMap = {}
      if (historyContacts) {
        for (const c of historyContacts) {
          const jid = c.id
          if (jid.includes('@g.us') || jid.includes('@broadcast') || jid.includes('@newsletter')) continue
          const cName = typeof c.name === 'string' ? c.name : (typeof c.notify === 'string' ? c.notify : (typeof c.verifiedName === 'string' ? c.verifiedName : ''))
          if (cName) nameMap[jid] = cName
        }
      }
      if (chats && chats.length > 0) {
        for (const chat of chats) {
          const jid = chat.id
          if (jid.includes('@g.us') || jid.includes('@broadcast') || jid.includes('@newsletter') || jid === 'status@broadcast') continue
          const phone = jid.split('@')[0]
          const chatNameRaw = typeof chat.name === 'string' ? chat.name : null
          const chatNotifyRaw = typeof chat.notify === 'string' ? chat.notify : null
          const contactName = nameMap[jid] || chatNameRaw || chatNotifyRaw || phone
          const lastMsgTs = chat.conversationTimestamp ? new Date(chat.conversationTimestamp * 1000).toISOString() : null
          // Find or create contact
          const { data: existingContact } = await supabase.from('contacts').select('id').eq('phone', phone).limit(1)
          let contactId = null
          if (existingContact && existingContact.length > 0) {
            contactId = existingContact[0].id
            if (contactName && contactName !== phone) await supabase.from('contacts').update({ name: contactName }).eq('id', contactId)
          } else if (contactName && contactName !== phone) {
            const payload = { name: contactName, phone, source: 'whatsapp', stage: 'novo', score: 0 }
            if (companyId) payload.company_id = companyId
            const { data: newC } = await supabase.from('contacts').insert(payload).select().single()
            if (newC) contactId = newC.id
          }
          // Find or create chat
          const { data: existing } = await supabase.from('whatsapp_chats').select('id').eq('remote_jid', jid).limit(1)
          if (existing && existing.length > 0) {
            await supabase.from('whatsapp_chats').update({ contact_name: contactName, contact_id: contactId }).eq('id', existing[0].id)
          } else {
            const payload = { remote_jid: jid, contact_id: contactId, contact_name: contactName, last_message_at: lastMsgTs, unread_count: chat.unreadCount || 0, session_id: sessionId }
            if (companyId) payload.company_id = companyId
            await supabase.from('whatsapp_chats').insert(payload)
          }
        }
      }
    } catch (e) {
      logger.error({ sessionId, error: e.message }, 'Error in history sync')
    }
  })

  // No debug event listeners needed
  sock.ev.on('labels.association', async ({ association, type, labelIds, chatId }) => {
    try {
      if (type === 'add' && chatId && labelIds) {
        if (!entry.chatLabels[chatId]) entry.chatLabels[chatId] = []
        for (var lid of labelIds) { if (!entry.chatLabels[chatId].includes(lid)) entry.chatLabels[chatId].push(lid) }
        await supabase.from('whatsapp_label_assocs').upsert({ chat_jid: chatId, label_id: labelIds[0], session_id: sessionId }).eq('chat_jid', chatId).eq('label_id', labelIds[0]).eq('session_id', sessionId)
      }
      if (type === 'remove' && chatId && labelIds) {
        if (entry.chatLabels[chatId]) { entry.chatLabels[chatId] = entry.chatLabels[chatId].filter(function(l) { return !labelIds.includes(l) }) }
        for (var lid of labelIds) { await supabase.from('whatsapp_label_assocs').delete().eq('chat_jid', chatId).eq('label_id', lid).eq('session_id', sessionId) }
      }
    } catch(e) { logger.warn({ error: e.message }, 'Error upserting label association') }
  })

  sock.ev.on('contacts.upsert', async (contacts) => {
    try {
      for (const c of contacts) {
        const jid = c.id
        if (jid.includes('@g.us') || jid.includes('@broadcast') || jid === 'status@broadcast') continue
        if (!c.name && !c.notify) continue
        const phone = jid.split('@')[0]
        // Skip lid-only contacts (14+ digits)
        if (phone.replace(/\D/g,'').length >= 14) continue
        const name = typeof c.name === 'string' ? c.name : (typeof c.notify === 'string' ? c.notify : phone)
        // Search by phone, jid, or lid (delete exact duplicates first)
        await supabase.from('contacts').delete().eq('phone', jid)
        await supabase.from('contacts').delete().eq('phone', phone).not('name', 'is', null).filter('name', 'neq', name).filter('name', 'neq', phone)
        const { data: existing } = await supabase.from('contacts').select('id').or('phone.eq.' + phone + ',phone.eq.' + jid).limit(1)
        if (existing && existing.length > 0) {
          await supabase.from('contacts').update({ name, phone }).eq('id', existing[0].id)
        } else {
          const payload = { name, phone, source: 'whatsapp', stage: 'novo', score: 0 }
          if (companyId) payload.company_id = companyId
          await supabase.from('contacts').insert(payload)
        }
      }
    } catch (e) {
      logger.error({ sessionId, error: e.message }, 'Error in contact upsert')
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return
    for (const msg of messages) {
      try {
        if (!msg.message) continue
        const jid = msg.key.remoteJid
        if (!jid || jid.includes('@g.us') || jid.includes('@broadcast') || jid.includes('@newsletter')) continue
        // Skip lid-only contacts (phone with 14+ digits)
        var msgPhone = jid.split('@')[0]
        if (msgPhone.replace(/\D/g,'').length >= 14) continue
        // Detect media messages
        var mediaUrl = null, msgType = 'text'
        // Audio
        if (msg.message?.audioMessage) {
          msgType = 'audio'
          try {
            var buf = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock?.updateMediaMessage })
            if (buf) { var fname = sessionId + '_' + msg.key.id + '.ogg'; fs.writeFileSync(path.join(MEDIA_DIR, fname), buf); mediaUrl = '/media/' + fname }
          } catch (e) { logger.warn({ sessionId, error: e.message }, 'Failed to download audio') }
        }
        // Image
        if (msg.message?.imageMessage) {
          msgType = 'image'
          try {
            var buf = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock?.updateMediaMessage })
            if (buf) { var fname = sessionId + '_' + msg.key.id + '.jpg'; fs.writeFileSync(path.join(MEDIA_DIR, fname), buf); mediaUrl = '/media/' + fname }
          } catch (e) { logger.warn({ sessionId, error: e.message }, 'Failed to download image') }
        }
        const msgContent = msgType === 'audio' ? '🎤 Mensagem de áudio'
          : msgType === 'image' ? '📷 Foto'
          : msg.message.conversation
          || msg.message.extendedTextMessage?.text
          || msg.message.imageMessage?.caption
          || msg.message.videoMessage?.caption
          || msg.message.documentMessage?.caption
          || ''
        if (!msgContent && !mediaUrl) continue
        const phone = jid.split('@')[0]
          const pushName = msg.pushName || phone
          const direction = msg.key.fromMe ? 'outgoing' : 'received'

        let contactId = null
        let q = supabase.from('contacts').select('id').eq('phone', phone).limit(1)
        if (companyId) q = q.eq('company_id', companyId)
        const { data: contacts } = await q
        if (contacts && contacts.length > 0) {
          contactId = contacts[0].id
          await supabase.from('contacts').update({ last_contacted_at: new Date().toISOString() }).eq('id', contactId)
        } else {
          const payload = { name: pushName, phone, source: 'whatsapp', stage: 'novo', score: 0, last_contacted_at: new Date().toISOString() }
          if (companyId) payload.company_id = companyId
          const { data: newC } = await supabase.from('contacts').insert(payload).select().single()
          if (newC) contactId = newC.id
        }

        let chatId = null
        let { data: chats } = await supabase.from('whatsapp_chats').select('id,unread_count,remote_jid').eq('remote_jid', jid).limit(1)
        if (!chats || chats.length === 0) {
          const phoneJid = phone + '@s.whatsapp.net'
          const simplePhone = phone.startsWith('55') ? phone.substring(2) : phone
          const { data: alt } = await supabase.from('whatsapp_chats').select('id,unread_count,remote_jid')
            .or(`remote_jid.eq.${phone},remote_jid.eq.${phoneJid},remote_jid.eq.${simplePhone}`)
            .limit(1)
          chats = alt
        }
        if (chats && chats.length > 0) {
          chatId = chats[0].id
          var isFromMe = msg.key.fromMe
          await supabase.from('whatsapp_chats').update({
            remote_jid: jid, last_message: { text: msgContent.substring(0, 200), at: new Date().toISOString() },
            last_message_at: new Date().toISOString(), 
            unread_count: isFromMe ? (chats[0].unread_count || 0) : (chats[0].unread_count || 0) + 1, 
            contact_name: pushName
          }).eq('id', chatId)
        } else {
          const payload = { remote_jid: jid, contact_id: contactId, contact_name: pushName, last_message: { text: msgContent.substring(0, 200), at: new Date().toISOString() }, last_message_at: new Date().toISOString(), unread_count: isFromMe ? 0 : 1, session_id: sessionId }
          if (companyId) payload.company_id = companyId
          const { data: newChat } = await supabase.from('whatsapp_chats').insert(payload).select().single()
          if (newChat) chatId = newChat.id
        }

        if (chatId) {
          // Dedup: check if similar message exists in last 10s
          var { data: dup } = await supabase.from('whatsapp_messages').select('id').eq('chat_id', chatId).eq('text', msgContent.substring(0, 100)).gte('created_at', new Date(Date.now() - 10000).toISOString()).limit(1)
          if (!dup || dup.length === 0) {
            var dir = msg.key.fromMe ? 'outgoing' : 'received'
            var msgPayload = { chat_id: chatId, session_id: sessionId, text: msgContent, direction: dir, created_at: new Date(msg.messageTimestamp ? msg.messageTimestamp * 1000 : Date.now()).toISOString() }
            if (mediaUrl) { msgPayload.media_url = mediaUrl; msgPayload.message_type = msgType }
            await supabase.from('whatsapp_messages').insert(msgPayload)
            // Keep latest 500
            supabase.from('whatsapp_messages').select('id').eq('chat_id', chatId).order('created_at', {ascending: false}).limit(500).then(function(oldRes) {
              if (oldRes.data && oldRes.data.length === 500) {
                var ids = oldRes.data.map(function(m) { return m.id })
                supabase.from('whatsapp_messages').delete().eq('chat_id', chatId).not('id', 'in', '(' + ids.map(function(id) { return "'" + id + "'" }).join(',') + ')')
              }
            })
          }
        }
      } catch (e) {
        logger.error({ sessionId, error: e.message }, 'Error handling incoming message')
      }
    }
  })
}

/* ------------------------------------------------------------------ */
/*  Outgoing message pump (per session)                                */
/* ------------------------------------------------------------------ */
function startOutgoingPump(sessionId) {
  stopOutgoingPump(sessionId)
  const entry = sessions.get(sessionId)
  if (!entry) return
  entry.outgoingInterval = setInterval(() => processOutgoing(sessionId), 3000)
}

function stopOutgoingPump(sessionId) {
  const entry = sessions.get(sessionId)
  if (entry && entry.outgoingInterval) {
    clearInterval(entry.outgoingInterval)
    entry.outgoingInterval = null
  }
}

function normalizeJid(raw) {
  if (!raw) return null
  if (raw.includes('@')) return raw
  let cleaned = raw.replace(/\D/g, '')
  if (cleaned.length <= 10) cleaned = '55' + cleaned
  return cleaned + '@s.whatsapp.net'
}

async function processOutgoing(sessionId) {
  const entry = sessions.get(sessionId)
  if (!entry || !entry.sock) return
  try {
    const { data: messages } = await supabase
      .from('whatsapp_messages').select('id,chat_id,text')
      .eq('session_id', sessionId).eq('direction', 'sent')
      .gte('created_at', new Date(Date.now() - 30000).toISOString()) // only last 30s
      .order('created_at', { ascending: true }).limit(20)
    if (!messages || messages.length === 0) return
    for (const msg of messages) {
      try {
        const { data: chats } = await supabase.from('whatsapp_chats').select('remote_jid').eq('id', msg.chat_id).limit(1)
        let jid = chats?.[0]?.remote_jid
        const normalized = normalizeJid(jid)
        if (!normalized) { await supabase.from('whatsapp_messages').update({ status: 'failed' }).eq('id', msg.id); continue }
        if (normalized !== jid) await supabase.from('whatsapp_chats').update({ remote_jid: normalized }).eq('id', msg.chat_id)
        jid = normalized
        await entry.sock.sendMessage(jid, { text: msg.text })
        await supabase.from('whatsapp_messages').update({ direction: 'outgoing' }).eq('id', msg.id)
        await supabase.from('whatsapp_chats').update({ last_message: { text: msg.text.substring(0, 200), at: new Date().toISOString() }, last_message_at: new Date().toISOString() }).eq('id', msg.chat_id)
        logger.info({ sessionId, jid, msgId: msg.id }, 'Message sent')
      } catch (e) {
        logger.error({ sessionId, msgId: msg.id, error: e.message }, 'Failed to send message')
        await supabase.from('whatsapp_messages').update({ status: 'failed' }).eq('id', msg.id)
        if (e.message?.includes('Connection closed')) {
          entry.sock = null; stopOutgoingPump(sessionId)
          await supabase.from('whatsapp_sessions').update({ status: 'connecting' }).eq('id', sessionId)
          entry.reconnectTimeout = setTimeout(() => startSession(sessionId, entry.userId, entry.companyId), 5000)
          return
        }
      }
    }
  } catch (e) {
    logger.error({ sessionId, error: e.message }, 'Error in outgoing pump')
  }
}

async function loadExistingChatsFromStore(sessionId, companyId) {
  const entry = sessions.get(sessionId)
  if (!entry || !entry.sock) return
  try {
    const { data: dbChats } = await supabase.from('whatsapp_chats').select('remote_jid').eq('session_id', sessionId)
    const existingJids = new Set((dbChats || []).map(c => c.remote_jid))
    const contacts = entry.sock?.store?.contacts || {}
    let synced = 0
    for (const [jid, contact] of Object.entries(contacts)) {
      if (jid.includes('@g.us') || jid.includes('@broadcast') || jid.includes('@newsletter') || jid === 'status@broadcast') continue
      if (!contact.name && !contact.notify && !contact.verifiedName) continue
      if (existingJids.has(jid)) continue
      if (!contact.lastMsgTimestamp && !contact.conversationTimestamp) continue
      const phone = jid.split('@')[0]
      const name = (typeof contact.name === 'string' ? contact.name : (typeof contact.notify === 'string' ? contact.notify : (typeof contact.verifiedName === 'string' ? contact.verifiedName : phone)))
      const lastMsgTs = contact.lastMsgTimestamp ? new Date(contact.lastMsgTimestamp * 1000).toISOString() : null
      const payload = { remote_jid: jid, contact_name: name, session_id: sessionId, unread_count: 0, last_message_at: lastMsgTs }
      if (companyId) payload.company_id = companyId
      await supabase.from('whatsapp_chats').insert(payload)
      synced++
    }
    if (synced) logger.info({ sessionId, synced }, 'Chats loaded from contact store')
    else logger.info({ sessionId, totalContacts: Object.keys(contacts).length }, 'No new chats found in store')
  } catch (e) {
    logger.error({ sessionId, error: e.message }, 'Error loading chats from store')
  }
}

async function syncContacts(sessionId, companyId) {
  const entry = sessions.get(sessionId)
  if (!entry || !entry.sock?.store?.contacts) { setTimeout(() => syncContacts(sessionId, companyId), 10000); return }
  try {
    const entries = Object.entries(entry.sock.store.contacts)
    let synced = 0, skipped = 0
    for (const [jid, contact] of entries) {
      if (jid.includes('@g.us') || jid.includes('@broadcast') || jid.includes('@newsletter') || jid === 'status@broadcast') continue
      if (!contact.name && !contact.notify && !contact.verifiedName) continue
      const phone = jid.split('@')[0]
      const name = contact.name || contact.notify || contact.verifiedName || phone
      const lastContacted = contact.lastMsgTimestamp ? new Date(contact.lastMsgTimestamp * 1000).toISOString() : null
      let q = supabase.from('contacts').select('id,last_contacted_at').eq('phone', phone).limit(1)
      if (companyId) q = q.eq('company_id', companyId)
      const { data: existing } = await q
      if (existing && existing.length > 0) {
        if (lastContacted && (!existing[0].last_contacted_at || new Date(lastContacted) > new Date(existing[0].last_contacted_at)))
          await supabase.from('contacts').update({ last_contacted_at: lastContacted }).eq('id', existing[0].id)
        skipped++
      } else {
        const payload = { name, phone, source: 'whatsapp', stage: 'novo', score: 0, last_contacted_at: lastContacted }
        if (companyId) payload.company_id = companyId
        await supabase.from('contacts').insert(payload)
        synced++
      }
    }
    logger.info({ sessionId, synced, skipped, total: entries.length }, 'Contacts sync completed')
  } catch (e) { logger.error({ sessionId, error: e.message }, 'Error syncing contacts') }
}

/* ------------------------------------------------------------------ */
/*  Session poller — checks DB for new/connecting sessions             */
/* ------------------------------------------------------------------ */
async function pollSessions() {
  try {
    const { data: dbSessions } = await supabase
      .from('whatsapp_sessions')
      .select('id,status,user_id,company_id')
      .in('status', ['connecting', 'disconnected', 'connected'])
      .order('created_at', { ascending: false })

    if (!dbSessions) return

    // Find the most recent connecting session (if any)
    var latestConnecting = null
    for (const dbS of dbSessions) {
      if (dbS.status === 'connected') {
        if (!sessions.has(dbS.id)) {
          const { data: full } = await supabase.from('whatsapp_sessions').select('*').eq('id', dbS.id).limit(1)
          if (full && full.length > 0) startSession(dbS.id, dbS.user_id, dbS.company_id)
        }
      } else if (dbS.status === 'connecting' && !sessions.has(dbS.id)) {
        if (!latestConnecting) latestConnecting = dbS
      } else if (dbS.status === 'disconnected' && sessions.has(dbS.id)) {
        const entry = sessions.get(dbS.id)
        if (entry.sock) { try { entry.sock.logout() } catch {} }
        entry.sock = null
        stopOutgoingPump(dbS.id)
        if (entry.reconnectTimeout) { clearTimeout(entry.reconnectTimeout); entry.reconnectTimeout = null }
        try { fs.rmSync(entry.authDir, { recursive: true, force: true }) } catch {}
        sessions.delete(dbS.id)
      }
    }
    // Only start the latest connecting session
    if (latestConnecting && !sessions.has(latestConnecting.id)) {
      startSession(latestConnecting.id, latestConnecting.user_id, latestConnecting.company_id)
    }
    // Mark old stale connecting sessions as disconnected
    for (const dbS of dbSessions) {
      if (dbS.status === 'connecting' && dbS.id !== latestConnecting?.id && !sessions.has(dbS.id)) {
        await supabase.from('whatsapp_sessions').update({ status: 'disconnected' }).eq('id', dbS.id)
      }
    }
  } catch (e) {
    logger.error({ error: e.message }, 'Error polling sessions')
  }
}

/* ------------------------------------------------------------------ */
/*  HTTP server                                                        */
/* ------------------------------------------------------------------ */
function getSessionIdFromUrl(url) {
  const u = new URL(url, 'http://localhost')
  return u.searchParams.get('sessionId') || u.searchParams.get('session_id') || null
}

const httpServer = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  logger.info({ url: req.url, method: req.method }, 'HTTP request')
  const sessionId = getSessionIdFromUrl(req.url)

  if (req.url.startsWith('/labels')) {
    // Dev check
    try { var{data:chk}=await supabase.from('whatsapp_labels').select('id').limit(1); console.log('LABELS TABLE EXISTS:', chk !== null, 'has data:', (chk||[]).length) } catch(ec) { console.error('LABELS TABLE CHECK:', ec.message) }
    try {
      var sId2 = sessionId
      if (!sId2) { try { sId2 = new URL(req.url, 'http://localhost').searchParams.get('sessionId') } catch(e) {} }
      var labList = []
      if (sId2) {
        var sEn2 = sessions.get(sId2)
        if (sEn2 && sEn2.labels) labList = Object.values(sEn2.labels)
        if (labList.length === 0) {
          var{data:dbLabels}=await supabase.from('whatsapp_labels').select('*').eq('session_id',sId2)
          if(dbLabels) labList = dbLabels.map(function(l){return{id:l.label_id,name:l.name,color:l.color}})
        }
      }
      res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({labels:labList})); return
    } catch(er) { console.error('LABELS ERROR:', er.message); res.writeHead(500); res.end(JSON.stringify({error:er.message})) }
  }

  // Serve static frontend files
  if (req.method === 'GET' && !req.url.includes('?')) {
    var staticRoot = path.resolve(process.cwd(), '..')
    var staticPath = path.join(staticRoot, req.url === '/' ? 'index.html' : req.url)
    // Prevent directory traversal
    if (!staticPath.startsWith(staticRoot)) { res.writeHead(403); res.end('Forbidden'); return }
    if (fs.existsSync(staticPath) && !fs.statSync(staticPath).isDirectory()) {
      var extMap = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'}
      var ext = path.extname(staticPath).toLowerCase()
      res.writeHead(200, {'Content-Type': extMap[ext] || 'application/octet-stream'})
      fs.createReadStream(staticPath).pipe(res)
      return
    }
  }

  // Fast-path handlers (outside try to avoid routing bugs)
  try {
  if (req.url.startsWith('/health')) {
    var hsId = sessionId; if(!hsId){try{hsId=new URL(req.url,'http://localhost').searchParams.get('sessionId')}catch(e){}}
    var hEntry = hsId ? sessions.get(hsId) : null
    if (hEntry) { res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({sessionId:hsId,connected:hEntry.status==='connected',status:hEntry.status,phone:hEntry.phone})) }
    else if (hsId) { var {data:dbS}=await supabase.from('whatsapp_sessions').select('status,phone').eq('id',hsId).limit(1); res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({sessionId:hsId,connected:dbS?.[0]?.status==='connected',status:dbS?.[0]?.status||'unknown',phone:dbS?.[0]?.phone||null})) }
    else { res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({sessionId:null,connected:false,status:'unknown'})) }
    return
  }
  if (req.url.startsWith('/qr')) {
    var qsId = sessionId; if(!qsId){try{qsId=new URL(req.url,'http://localhost').searchParams.get('sessionId')}catch(e){}}
    var qEntry = qsId ? sessions.get(qsId) : null
    res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({qr_code:qEntry?.qrCode||null})); return
  }
  if (req.url === '/sessions') {
    var active = []; for(const[id,entry]of sessions){active.push({sessionId:id,status:entry.status,phone:entry.phone,hasQr:!!entry.qrCode})}
    if(active.length===0){var{data:dbSessions}=await supabase.from('whatsapp_sessions').select('id,status,phone').eq('status','connected').limit(1);if(dbSessions&&dbSessions.length>0){active=dbSessions.map(function(s){return{sessionId:s.id,status:s.status,phone:s.phone}})}}
    res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({sessions:active})); return
  }
  if (req.url.startsWith('/chats') && sessionId) {
    var{data:chatList}=await supabase.from('whatsapp_chats').select('*').not('last_message_at','is',null).order('last_message_at',{ascending:false}).limit(500)
    var{data:dbContacts}=await supabase.from('contacts').select('phone,name')
    var nameMap={},savedPhones={},allCP=new Set((dbContacts||[]).map(c=>c.phone).filter(Boolean))
    if(dbContacts){for(const c of dbContacts){var isReal=c.name&&!c.name.startsWith('{')&&!c.name.includes('@')&&c.name!==c.phone&&(!/^\d+$/.test(c.name.replace(/[^0-9]/g,'')+'x'));if(isReal){var va=[c.phone,'55'+c.phone.replace(/^55/,''),c.phone.replace(/^55/,''),c.phone+'@s.whatsapp.net',c.phone+'@lid'];for(const v of va){nameMap[v]=c.name;savedPhones[v]=true}}}}
    if(chatList){for(const chat of chatList){var phone=chat.remote_jid?.split('@')[0]||'',fullJid=chat.remote_jid||'',cn=nameMap[fullJid]||nameMap[phone]||nameMap['55'+phone.replace(/^55/,'')]||nameMap[phone.replace(/^55/,'')]||null;if(cn)chat.contact_name=cn;else if(chat.contact_name?.includes('@')||chat.contact_name?.startsWith('{'))chat.contact_name=phone}}
    if(chatList&&chatList.length>0){var ids=chatList.map(c=>c.id).filter(Boolean);if(ids.length>0){var{data:allMsgs}=await supabase.from('whatsapp_messages').select('*').in('chat_id',ids).order('created_at',{ascending:true}).limit(10000);if(allMsgs){var cm={};for(const c of chatList)cm[c.id]=c;for(const m of allMsgs){if(cm[m.chat_id]){if(!cm[m.chat_id].last_messages)cm[m.chat_id].last_messages=[];if(cm[m.chat_id].last_messages.length<10)cm[m.chat_id].last_messages.push(m)}}}}}
    // Deduplicate by phone (extracted from remote_jid)
    if(chatList){var seenPhone={};var deduped=[];for(const c of chatList){var p=c.remote_jid?.split('@')[0]||c.remote_jid||'';if(p&&!seenPhone[p]){seenPhone[p]=true;deduped.push(c)}else if(!p){deduped.push(c)}}chatList=deduped}
    // For each chat, try to get the real contact name from contacts table
    if(chatList && dbContacts){
      var nameFromPhone={};var nameFromName={};
      for(var nc of dbContacts){
        if(nc.phone&&nc.name&&!nc.name.includes('@')){
          var cp=nc.phone.replace(/\D/g,'').replace(/^55/,'');nameFromPhone[cp]=nc.name;nameFromPhone['55'+cp]=nc.name
          var cleanN=nc.name.toLowerCase().replace(/[^a-z0-9]/g,'');if(cleanN)nameFromName[cleanN]=nc.name
        }
      }
      for(var cc of chatList){
        var chatP=cc.remote_jid?.split('@')[0]||''
        var chatClean=chatP.replace(/\D/g,'').replace(/^55/,'')
        var realName=nameFromPhone[chatP]||nameFromPhone[chatClean]||nameFromPhone['55'+chatClean]
        if(!realName){
          var chatNameClean=(cc.contact_name||'').toLowerCase().replace(/[^a-z0-9]/g,'')
          if(chatNameClean)realName=nameFromName[chatNameClean]
        }
        if(realName)cc.contact_name=realName
      }
    }
    // Filter out lid JIDs and chats whose contact_name looks like a lid ID
    if(chatList){chatList=chatList.filter(function(c){
      var jid=c.remote_jid||''
      if(jid.includes('@lid'))return false
      var n=c.contact_name||''
      return n.length<14||!/^\d+$/.test(n.replace(/\D/g,''))
    })}
    res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({chats:chatList||[]})); return
  }
  if (req.url.startsWith('/messages?')) {
    var u=new URL(req.url,'http://localhost'); var cid=u.searchParams.get('chatId')||''
    if(cid){var{data:msgList}=await supabase.from('whatsapp_messages').select('*').eq('chat_id',cid).order('created_at',{ascending:false}).limit(500); if(msgList)msgList.reverse(); res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({messages:msgList||[]})); return}
  }
  if (req.url.startsWith('/db-contacts')) {
    console.log('DB-CONTACTS handler reached')
    var{data:dbAll}=await supabase.from('contacts').select('name,phone')
    var filtered=(dbAll||[]).filter(function(c){if(!c.name||c.name===c.phone)return false;if(c.name.startsWith('{')||c.name.includes('"low"'))return false;if(c.name.includes('@'))return false;if(/^\d+$/.test(c.name.replace(/\D/g,'')+'x'))return false;return true})
    var seen={}; var final=[]; for(const c of filtered){if(c.phone&&!seen[c.phone]){seen[c.phone]=true;final.push(c)}}
    // Cache order for 30s
    if(!global._dbOrderCache||Date.now()-global._dbOrderTime>30000){
      var{data:msgTimes}=await supabase.from('whatsapp_messages').select('chat_id,created_at').order('created_at',{ascending:false}).limit(10000)
      var msgTimesByChat={};if(msgTimes){for(var ti=0;ti<msgTimes.length;ti++){var mt=msgTimes[ti];if(mt.chat_id&&!msgTimesByChat[mt.chat_id])msgTimesByChat[mt.chat_id]=mt.created_at}}
      var{data:allChats}=await supabase.from('whatsapp_chats').select('id,remote_jid').limit(2000)
      var phoneTime={};if(allChats){for(var ci2=0;ci2<allChats.length;ci2++){var ch=allChats[ci2];var t=msgTimesByChat[ch.id];if(t){var p=ch.remote_jid?.split('@')[0]||'';if(p){phoneTime[p]=t;phoneTime[p.replace(/^55/,'')]=t;phoneTime['55'+p.replace(/^55/,'')]=t}}}}
      global._dbOrderCache=phoneTime; global._dbOrderTime=Date.now()
    }
    var phoneTime=global._dbOrderCache||{}
    function getLastT(c){return phoneTime[c.phone]||phoneTime[c.phone.replace(/^55/,'')]||phoneTime['55'+c.phone.replace(/^55/,'')]||''}
    try {
      // Debug: show first 5 contacts and their last message time
      var debugInfo = final.slice(0,5).map(function(c){return{c:c.name,t:getLastT(c)||'(sem msg)'}})
      console.log('ORDER DEBUG:', JSON.stringify(debugInfo))
      final.sort(function(a,b){var ta=getLastT(a),tb=getLastT(b);if(ta&&tb)return ta>tb?-1:1;if(ta&&!tb)return -1;if(!ta&&tb)return 1;return(a.name||'').localeCompare(b.name||'')})
      // Show sorted first 5
      console.log('SORTED FIRST 5:', JSON.stringify(final.slice(0,5).map(function(c){return c.name})))
      res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({contacts:final||[]})); return
    } catch(es) { console.error('DB-CONTACTS ERROR:', es.message, es.stack); res.writeHead(500); res.end(JSON.stringify({error:es.message})) }
  }
  if (req.url.startsWith('/contacts') && sessionId) {
    var sEntry=sessions.get(sessionId); var storeContacts=sEntry?.sock?.store?.contacts||{}
    if(Object.keys(storeContacts).length>0){var list=[];for(const[jid,contact]of Object.entries(storeContacts)){if(jid.includes('@g.us')||jid.includes('@broadcast')||jid.includes('@newsletter')||jid==='status@broadcast')continue;var name=typeof contact.name==='string'?contact.name:(typeof contact.notify==='string'?contact.notify:(typeof contact.verifiedName==='string'?contact.verifiedName:''));list.push({jid,name,phone:jid.split('@')[0],lastMsgTimestamp:contact.lastMsgTimestamp||null})}res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({contacts:list}));return}
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({contacts:[]}));return
  }
  if (req.url.startsWith('/disconnect') && req.method==='POST' && sessionId) {
    await supabase.from('whatsapp_sessions').update({status:'disconnected'}).eq('id',sessionId)
    var dEntry=sessions.get(sessionId)
    if(dEntry){if(dEntry.sock){try{dEntry.sock.logout()}catch{}}dEntry.sock=null;stopOutgoingPump(sessionId);if(dEntry.reconnectTimeout){clearTimeout(dEntry.reconnectTimeout);dEntry.reconnectTimeout=null}try{fs.rmSync(dEntry.authDir,{recursive:true,force:true})}catch{}sessions.delete(sessionId)}
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true}));return
  }
  if (req.url.startsWith('/search-contact')) {
    var u=new URL(req.url,'http://localhost'); var q=u.searchParams.get('q')||''
    var{data:nMatch}=await supabase.from('contacts').select('name,phone').ilike('name','%'+q+'%')
    var{data:pMatch}=await supabase.from('contacts').select('name,phone').ilike('phone','%'+q+'%')
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({name:nMatch||[],phone:pMatch||[]}));return
  }
  if (req.url.startsWith('/debug')) {
    var uu=new URL(req.url,'http://localhost')
    if(uu.pathname==='/debug'||uu.pathname==='/debug/'){var{data:mData}=await supabase.from('whatsapp_messages').select('id').limit(10000);var{data:cData}=await supabase.from('whatsapp_chats').select('id').limit(5000);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({chats:cData?.length||0,messages:mData?.length||0}));return}
    if(uu.pathname==='/debug/msgtest'){var{data:someMsgs}=await supabase.from('whatsapp_messages').select('*').limit(5);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({sample:someMsgs||[]}));return}
    if(uu.pathname==='/debug/msgstats'){var{count:cnt}=await supabase.from('whatsapp_messages').select('*',{count:'exact',head:true});var{data:allMsgs}=await supabase.from('whatsapp_messages').select('chat_id,created_at').order('created_at',{ascending:false}).limit(100);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({total:cnt,recentChats:[...new Set((allMsgs||[]).map(m=>m.chat_id))],sampleMsg:allMsgs?.[0]||null}));return}
    if(uu.pathname==='/debug/checkconstraint'){try{var q=await supabase.rpc('exec_sql',{sql:"SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='whatsapp_messages_status_check'"});res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({result:q}));}catch(e){var q2=await supabase.from('_constraints').select('*').eq('constraint_name','whatsapp_messages_status_check');res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message,fallback:q2}));}return}
  }
  console.log('CHECKING /labels:', req.url, 'sessionId:', sessionId)
  // GET /labels?sessionId=xxx
  if (req.url.startsWith('/labels') && sessionId) {
    console.log('/labels MATCHED!')
    try {
      var sEntry = sessions.get(sessionId)
      var labelList = sEntry?.labels ? Object.values(sEntry.labels) : []
      res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({labels:labelList})); return
    } catch(e) { console.error('LABELS ERROR:', e.message) }
  }
  // GET /chat-labels?sessionId=xxx&chatId=xxx
  if (req.url.startsWith('/chat-labels') && sessionId) {
    var uu=new URL(req.url,'http://localhost'); var cId=uu.searchParams.get('chatId')||''
    var sEntry = sessions.get(sessionId); var lbls = sEntry?.chatLabels?.[cId]||[]
    var resolved = lbls.map(function(lid){var lb=sEntry?.labels?.[lid];return lb?{id:lid,name:lb.name,color:lb.hexColor}:null}).filter(Boolean)
    res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({labels:resolved})); return
  }
  // Mark chat as read
  if (req.url.startsWith('/mark-read') && req.method === 'POST') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', function() {
      try {
        var data = JSON.parse(body)
        if (data.chatId) {
          supabase.from('whatsapp_chats').update({ unread_count: 0 }).eq('id', data.chatId).then(function() { 
            res.writeHead(200); res.end(JSON.stringify({ ok: true }))
          }).catch(function(err) { 
            res.writeHead(500); res.end(JSON.stringify({ error: err.message }))
          })
        } else { res.writeHead(400); res.end(JSON.stringify({ error: 'chatId required' })) }
      } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })) }
    })
    return
  }
  // Serve audio/video files
  if (req.url.startsWith('/media/')) {
    var filePath = path.join(MEDIA_DIR, req.url.replace('/media/', '').replace(/[^a-zA-Z0-9\-_\.]/g, ''))
    if (fs.existsSync(filePath)) {
      var ext = path.extname(filePath).toLowerCase()
      var ct = ext === '.ogg' ? 'audio/ogg' : ext === '.mp3' ? 'audio/mpeg' : ext === '.mp4' ? 'video/mp4' : 'application/octet-stream'
      res.writeHead(200, { 'Content-Type': ct, 'Content-Length': fs.statSync(filePath).size })
      fs.createReadStream(filePath).pipe(res)
    } else { res.writeHead(404); res.end('Not found') }
    return
  }
  if (req.url === '/send-message' && req.method === 'POST') {
    var body = ''
    req.on('data', function(chunk) { body += chunk })
    req.on('end', function() {
      try {
        var data = JSON.parse(body)
        if (!data.chatId || !data.text || !data.sessionId) { res.writeHead(400); res.end(JSON.stringify({ error: 'chatId, text, sessionId required' })); return }
        supabase.from('whatsapp_messages').insert({
          chat_id: data.chatId, session_id: data.sessionId, text: data.text.substring(0, 500),
          direction: 'sent', created_at: new Date().toISOString()
        }).then(function() { 
          // Keep only latest 500 messages
          var cleanup = function() {
            supabase.from('whatsapp_messages').select('id').eq('chat_id', data.chatId).order('created_at', {ascending: false}).limit(500).then(function(oldRes) {
              if (oldRes.data && oldRes.data.length === 500) {
                var ids = oldRes.data.map(function(m) { return m.id })
                supabase.from('whatsapp_messages').delete().eq('chat_id', data.chatId).not('id', 'in', '(' + ids.map(function(id) { return "'" + id + "'" }).join(',') + ')')
              }
            })
          }
          cleanup()
          console.log('SEND-MSG INSERT OK'); res.writeHead(200); res.end(JSON.stringify({ ok: true })) 
        }).catch(function(err) { console.error('SEND-MSG INSERT FAIL:', err.message, JSON.stringify(err)); res.writeHead(500); res.end(JSON.stringify({ error: err.message })) })
      } catch (e) { console.error('SEND-MSG PARSE ERROR:', e.message); res.writeHead(400); res.end(JSON.stringify({ error: e.message })) }
    })
    return
  }
  if (req.url.startsWith('/cleanup-chat-dups')) {
    var{data:allChats}=await supabase.from('whatsapp_chats').select('id,remote_jid,contact_name').order('created_at',{ascending:true})
    var seen3={},removed3=0
    if(allChats){for(const c of allChats){var jid=c.remote_jid;var short=jid?jid.split('@')[0]:'';var key3=short||c.id;if(seen3[key3]){await supabase.from('whatsapp_chats').delete().eq('id',c.id);removed3++}else{seen3[key3]=true}}}
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,removed:removed3}));return
  }

  } catch(ef) { console.error('FAST PATH ERROR:', ef.message, ef.stack); res.writeHead(500); res.end(JSON.stringify({error:ef.message})) }

  try {
    // GET /connect?user_id=xxx — create a new session in DB
    if (req.url.startsWith('/connect')) {
      try {
        const u = new URL(req.url, 'http://localhost')
        const userId = u.searchParams.get('user_id') || null
        logger.info({ userId }, 'Creating new session')
        const { data: newSession, error: insertError } = await supabase.from('whatsapp_sessions').insert({
          status: 'connecting',
          user_id: userId,
        }).select().single()
        if (insertError) {
          logger.error({ error: insertError }, 'Failed to insert session')
          res.writeHead(500); res.end(JSON.stringify({ error: insertError.message }))
          return
        }
        if (newSession) {
          logger.info({ sessionId: newSession.id }, 'Session created, starting Baileys')
          startSession(newSession.id, newSession.user_id, newSession.company_id)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ sessionId: newSession.id }))
        } else {
          res.writeHead(500); res.end(JSON.stringify({ error: 'No session returned' }))
        }
      } catch (e) {
        logger.error({ error: e.message, stack: e.stack }, 'Connect error')
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }))
      }
      return
    }

    // Endpoints that don't need sessionId
    if (req.url === '/send-message' || req.url.startsWith('/debug') || req.url.startsWith('/db-contacts') || req.url.startsWith('/cleanup-contacts') || req.url.startsWith('/deduplicate-contacts') || req.url.startsWith('/sync-all-contacts-as-chats') || req.url.startsWith('/search-contact') || req.url.startsWith('/search-chat') || req.url.startsWith('/messages?') || req.url.startsWith('/remove-lids')) {
      if (req.url.startsWith('/remove-lids')) {
        console.log('REMOVE-LIDS handler')
        var{data:allL}=await supabase.from('contacts').select('id,name,phone')
        var toRemL=[]
        if(allL){for(var ll of allL){var cl=ll.phone?.replace(/\D/g,'')||'';if(cl.length>=14||(cl.startsWith('55')&&cl.length>13))toRemL.push(ll.id)}}
        if(toRemL.length){await supabase.from('contacts').delete().in('id',toRemL)}
        res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,removed:toRemL.length}));return
      }
      if (req.url.startsWith('/deduplicate-contacts')) {
        var{data:allD}=await supabase.from('contacts').select('id,name,phone').order('created_at',{ascending:true})
        console.log('DEDUP: total', allD?.length, 'contacts')
        var seenPh={},seenNm={},toDel=[]
        if(allD){
          // Log sample for debugging
          for(var ds=0;ds<Math.min(5,allD.length);ds++) console.log('DEDUP SAMPLE:', allD[ds].name, allD[ds].phone)
          for(var dc of allD){
            var rawPk=dc.phone||''
            var pk=rawPk.replace(/\D/g,'').replace(/^55/,'')
            var nk=(dc.name||'').toLowerCase().replace(/[^a-z0-9]/g,'')
            var reason=''
            if(pk&&seenPh[pk])reason='phone '+pk
            else if(nk&&seenNm[nk])reason='name '+nk
            if(reason){toDel.push(dc.id);console.log('DEDUP REMOVE:', dc.name, dc.phone, '('+reason+')')}else{if(pk)seenPh[pk]=true;if(nk)seenNm[nk]=true}
          }
        }
        console.log('DEDUP: removing', toDel.length)
        if(toDel.length){await supabase.from('contacts').delete().in('id',toDel)}
        res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,removed:toDel.length}));return
      }
  if (req.url.startsWith('/debug')) {
        const u = new URL(req.url, 'http://localhost')
        if (u.pathname === '/debug' || u.pathname === '/debug/') {
          const { count: msgCount } = await supabase.from('whatsapp_messages').select('*', { count: 'exact', head: true })
          const { count: chatCount } = await supabase.from('whatsapp_chats').select('*', { count: 'exact', head: true })
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ chats: chatCount || 0, messages: msgCount?.length || 0 }))
        } else if (req.url.startsWith('/debug-match')) {
          const u = new URL(req.url, 'http://localhost')
          const q = u.searchParams.get('phone') || ''
          const { data: found } = await supabase.from('contacts').select('name,phone').or('phone.eq.' + q + ',phone.eq.' + q + '@lid,phone.eq.' + q + '@s.whatsapp.net')
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ query: q, matches: found || [], count: found?.length || 0 }))
        } else if (req.url.startsWith('/db-contacts')) {
        const { data: dbAll } = await supabase.from('contacts').select('name,phone')
        const contactList = (dbAll || []).filter(function(c) {
          if (!c.name || c.name === c.phone) return false
          if (c.name.startsWith('{') || c.name.includes('"low"')) return false
          if (c.name.includes('@')) return false
          if (/^\d+$/.test(c.name.replace(/\D/g, '') + 'x')) return false
          return true
        })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ contacts: contactList || [] }))
      } else if (req.url.startsWith('/search-chat')) {
        const u = new URL(req.url, 'http://localhost')
        const q = u.searchParams.get('q') || ''
        const sid = u.searchParams.get('sessionId') || ''
        const { data: found } = sid ? await supabase.from('whatsapp_chats').select('remote_jid,contact_name').eq('session_id', sid).or('contact_name.ilike.%' + q + '%,remote_jid.ilike.%' + q + '%') : { data: [] }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ chats: found || [] }))
      } else if (req.url.startsWith('/search-contact')) {
        const u = new URL(req.url, 'http://localhost')
        const q = u.searchParams.get('q') || ''
        const { data: nameMatch } = await supabase.from('contacts').select('name,phone').ilike('name', '%' + q + '%')
        const { data: phoneMatch } = await supabase.from('contacts').select('name,phone').ilike('phone', '%' + q + '%')
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ name: nameMatch || [], phone: phoneMatch || [] }))
      } else if (req.url.startsWith('/messages?')) {
        const u = new URL(req.url, 'http://localhost')
        const chatId = u.searchParams.get('chatId') || ''
        if (chatId) {
          const { data: messages } = await supabase.from('whatsapp_messages').select('*').eq('chat_id', chatId).order('created_at', { ascending: true }).limit(500)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ messages: messages || [] }))
        } else {
          res.writeHead(400); res.end(JSON.stringify({ error: 'chatId required' }))
        }
      } else if (req.url === '/send-message' && req.method === 'POST') {
        let body = ''
        req.on('data', chunk => body += chunk)
        req.on('end', () => {
          try {
            const data = JSON.parse(body)
            const { chatId, text, sessionId } = data
            if (!chatId || !text || !sessionId) { res.writeHead(400); res.end(JSON.stringify({ error: 'chatId, text, sessionId required' })); return }
            supabase.from('whatsapp_messages').insert({
              chat_id: chatId, session_id: sessionId, text: text.substring(0, 500),
              direction: 'sent', status: 'queued'
        }).then(function() { console.log('SEND-MSG INSERT OK'); res.writeHead(200); res.end(JSON.stringify({ ok: true })) }).catch(function(err) { console.error('SEND-MSG INSERT FAIL:', err.message, JSON.stringify(err)); res.writeHead(500); res.end(JSON.stringify({ error: err.message })) })
          } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })) }
        })
      } else if (req.url.startsWith('/sync-all-contacts-as-chats')) {
        const u = new URL(req.url, 'http://localhost')
        const sid = u.searchParams.get('sessionId') || ''
        const { data: allContacts } = await supabase.from('contacts').select('name,phone')
        const { data: existingChats } = sid ? await supabase.from('whatsapp_chats').select('remote_jid').eq('session_id', sid) : { data: [] }
        const existingJids = new Set((existingChats || []).map(c => c.remote_jid))
        let created = 0
        if (allContacts) {
          for (const c of allContacts) {
            if (!c.name || c.name === c.phone || c.name.startsWith('{')) continue
            const jidVariants = [c.phone, c.phone + '@s.whatsapp.net', c.phone + '@lid']
            for (const jid of jidVariants) {
              if (!existingJids.has(jid) && sid) {
                await supabase.from('whatsapp_chats').insert({ remote_jid: jid, contact_name: c.name, session_id: sid })
                existingJids.add(jid)
                created++
                break
              }
            }
          }
        }
        logger.info({ created }, 'All contacts synced as chats')
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, created }))
      } else if (req.url.startsWith('/deduplicate-contacts')) {
        const { data: all } = await supabase.from('contacts').select('id,name,phone')
        var seen = {}, removed = 0
        if (all) {
          for (const c of all) {
            var key = c.phone + '|' + (c.name || '')
            if (seen[key]) {
              var { error } = await supabase.from('contacts').delete().eq('id', c.id)
              if (!error) removed++
            } else {
              seen[key] = true
            }
          }
        }
        logger.info({ removed }, 'Duplicates deduplicated')
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, removed }))
      } else if (req.url.startsWith('/cleanup-contacts')) {
        const { data: badContacts } = await supabase.from('contacts').select('id,name,phone')
        let removed = 0
        if (badContacts) {
          for (const c of badContacts) {
            if (!c.name || c.name === c.phone || c.name.startsWith('{') || c.name.startsWith('55') || c.name.includes('@') || /^\d+$/.test(c.name.replace(/\D/g, '') + 'x')) {
              await supabase.from('contacts').delete().eq('id', c.id)
              removed++
            }
          }
        }
        logger.info({ removed }, 'Bad contacts cleaned up')
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, removed }))
      }
      return
    }

    // GET /qr — works even without sessionId
    if (req.url.startsWith('/qr')) {
      var qrSessionId = sessionId
      if (!qrSessionId) {
        try { qrSessionId = new URL(req.url, 'http://localhost').searchParams.get('sessionId') } catch (e) {}
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      const qEntry = qrSessionId ? sessions.get(qrSessionId) : null
      res.end(JSON.stringify({ qr_code: qEntry?.qrCode || null }))
      return
    }

    if (!sessionId) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'sessionId required' }))
      return
    }

    const entry = sessions.get(sessionId)

    // POST /disconnect?sessionId=xxx
    if (req.url.startsWith('/disconnect') && req.method === 'POST') {
      await supabase.from('whatsapp_sessions').update({ status: 'disconnected' }).eq('id', sessionId)
      if (entry) {
        if (entry.sock) { try { entry.sock.logout() } catch {} }
        entry.sock = null
        stopOutgoingPump(sessionId)
        if (entry.reconnectTimeout) { clearTimeout(entry.reconnectTimeout); entry.reconnectTimeout = null }
        try { fs.rmSync(entry.authDir, { recursive: true, force: true }) } catch {}
        sessions.delete(sessionId)
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }

    // GET /db-fix-names?sessionId=xxx — clean bad object names from DB directly
    if (req.url.startsWith('/db-fix-names')) {
      if (sessionId) {
        const { data: badChats } = await supabase.from('whatsapp_chats').select('id,remote_jid,contact_name').eq('session_id', sessionId).or('contact_name.like.{%},contact_name.like.{@}')
        let fixed = 0
        if (badChats) {
          for (const chat of badChats) {
            const phone = (chat.remote_jid || '').split('@')[0]
            if (phone) {
              await supabase.from('whatsapp_chats').update({ contact_name: phone }).eq('id', chat.id)
              fixed++
            }
          }
        }
        logger.info({ sessionId, fixed }, 'DB names fixed')
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, fixed }))
      } else {
        res.writeHead(404); res.end(JSON.stringify({ error: 'Session not found' }))
      }
      return
    }

    // GET /fix-names?sessionId=xxx — update chat and contact names from store + contacts table
    if (req.url.startsWith('/fix-names')) {
      if (sessionId && sessions.has(sessionId)) {
        const entry = sessions.get(sessionId)
        const storeContacts = entry.sock?.store?.contacts || {}
        let updated = 0
        var sampleNames = []
        for (const [jid, c] of Object.entries(storeContacts).slice(0, 20)) {
          sampleNames.push({ jid, name: c.name, notify: c.notify, verifiedName: c.verifiedName, shortName: c.shortName })
        }
        logger.info({ sessionId, sample: sampleNames }, 'Fix-names sample')
        // Pass 1: update from store contacts (address book names + pushNames)
        for (const [jid, contact] of Object.entries(storeContacts)) {
          if (jid.includes('@g.us') || jid.includes('@broadcast') || jid.includes('@newsletter') || jid === 'status@broadcast') continue
          const name = typeof contact.name === 'string' ? contact.name : (typeof contact.notify === 'string' ? contact.notify : (typeof contact.verifiedName === 'string' ? contact.verifiedName : (typeof contact.shortName === 'string' ? contact.shortName : '')))
          if (!name) continue
          const phone = jid.split('@')[0]
          if (name !== phone) {
            await supabase.from('contacts').update({ name }).eq('phone', phone)
            await supabase.from('whatsapp_chats').update({ contact_name: name }).eq('remote_jid', jid)
            updated++
          }
        }
        // Pass 2: update names from contacts table for any remaining
        const { data: dbContacts } = await supabase.from('contacts').select('phone,name').not('name', 'is', null)
        if (dbContacts) {
          for (const c of dbContacts) {
            if (!c.name || c.name === c.phone || c.name.startsWith('{')) continue
            const chatJids = [c.phone, c.phone + '@s.whatsapp.net', '55' + c.phone.replace(/^55/, ''), '55' + c.phone.replace(/^55/, '') + '@s.whatsapp.net']
            for (const jid of chatJids) {
              const r = await supabase.from('whatsapp_chats').update({ contact_name: c.name }).eq('session_id', sessionId).eq('remote_jid', jid)
              if (!r.error) { updated++; break }
            }
          }
        }
        logger.info({ sessionId, updated }, 'Names fixed')
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, updated }))
      } else {
        res.writeHead(404); res.end(JSON.stringify({ error: 'Session not found or not connected' }))
      }
      return
    }

    // GET /messages?chatId=xxx
      return
    }

    // GET /contacts?sessionId=xxx — all contacts from Baileys store (names from phone book)
    if (req.url.startsWith('/contacts')) {
      const storeContacts = entry?.sock?.store?.contacts || {}
      if (Object.keys(storeContacts).length > 0) {
        const list = []
        for (const [jid, contact] of Object.entries(storeContacts)) {
          if (jid.includes('@g.us') || jid.includes('@broadcast') || jid.includes('@newsletter') || jid === 'status@broadcast') continue
          const name = typeof contact.name === 'string' ? contact.name : (typeof contact.notify === 'string' ? contact.notify : (typeof contact.verifiedName === 'string' ? contact.verifiedName : ''))
          list.push({ jid, name, phone: jid.split('@')[0], lastMsgTimestamp: contact.lastMsgTimestamp || null })
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ contacts: list }))
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ contacts: [] }))
      }
      return
    }

    res.writeHead(404); res.end('Not found')
  } catch (e) {
    res.writeHead(500); res.end(JSON.stringify({ error: e.message }))
  }
})

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */
async function main() {
  httpServer.listen(HTTP_PORT, () => logger.info({ port: HTTP_PORT }, 'HTTP server listening'))

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    logger.fatal('SUPABASE_URL and SUPABASE_SERVICE_KEY are required.')
    process.exit(1)
  }

  // Poll DB for sessions every 10s
  setInterval(pollSessions, 10000)

  // Initial poll
  await pollSessions()

  logger.info('Veltris WPP Server (multi-session) is running.')
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

function shutdown() {
  logger.info('Shutting down...')
  for (const [id, entry] of sessions) {
    stopOutgoingPump(id)
    if (entry.reconnectTimeout) clearTimeout(entry.reconnectTimeout)
    if (entry.sock) try { entry.sock.end(undefined) } catch {}
  }
  process.exit(0)
}

main().catch(err => {
  logger.fatal({ error: err.message }, 'Fatal error')
  process.exit(1)
})
