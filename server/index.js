import WebSocket from 'ws'
import { makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } from '@whiskeysockets/baileys'
import QRCode from 'qrcode'
import pino from 'pino'
import fs from 'fs'
import path from 'path'
import http from 'http'
import 'dotenv/config'

globalThis.WebSocket = WebSocket

const { createClient } = await import('@supabase/supabase-js')

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const AUTH_BASE = process.env.WPP_AUTH_DIR || './auth'
const MEDIA_DIR = process.env.WPP_MEDIA_DIR || './media'
const HTTP_PORT = 3123

const logger = pino({ level: process.env.LOG_LEVEL || 'info' })
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false }, realtime: { transport: WebSocket } })

if (!fs.existsSync(AUTH_BASE)) fs.mkdirSync(AUTH_BASE, { recursive: true })
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true })

const sessions = new Map()

function normalizePhone(raw) {
  if (!raw) return ''
  return raw.replace(/\D/g, '').replace(/^55/, '')
}

function phoneVariants(raw) {
  const p = normalizePhone(raw)
  if (!p) return []
  return [p, '55' + p]
}

async function findContactByPhone(phone, companyId) {
  const variants = phoneVariants(phone)
  for (const v of variants) {
    let q = supabase.from('contacts').select('id,name,phone').eq('phone', v)
    if (companyId) q = q.eq('company_id', companyId)
    const { data } = await q.limit(1)
    if (data?.length) return data[0]
  }
  return null
}

async function findContactByNameOrPhone(phone, name, companyId) {
  if (!name || name === phone) return findContactByPhone(phone, companyId)
  const variants = phoneVariants(phone)
  for (const v of variants) {
    let q = supabase.from('contacts').select('id,name,phone').eq('phone', v)
    if (companyId) q = q.eq('company_id', companyId)
    const { data } = await q.limit(1)
    if (data?.length) return data[0]
  }
  let q = supabase.from('contacts').select('id,name,phone').eq('name', name)
  if (companyId) q = q.eq('company_id', companyId)
  const { data } = await q.limit(1)
  if (data?.length) return data[0]
  return null
}

async function findChat(jid, sessionId) {
  const phone = jid.split('@')[0]
  const np = normalizePhone(phone)
  const variants = [jid, phone, phone + '@s.whatsapp.net', np, '55' + np, '55' + np + '@s.whatsapp.net']
  for (const v of variants) {
    let q = supabase.from('whatsapp_chats').select('id,unread_count').eq('remote_jid', v)
    if (sessionId) q = q.eq('session_id', sessionId)
    const { data } = await q.limit(1)
    if (data?.length) return data[0]
  }
  return null
}

async function startSession(sessionId, userId, companyId) {
  logger.info({ sessionId }, 'startSession')
  await supabase.from('whatsapp_sessions').update({ status: 'connecting' }).eq('id', sessionId)
  if (sessions.has(sessionId)) {
    const existing = sessions.get(sessionId)
    if (existing.sock) return
  }

  const authDir = path.join(AUTH_BASE, sessionId)
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true })

  try {
    const { data: sessionData } = await supabase.from('whatsapp_sessions').select('auth_creds').eq('id', sessionId).limit(1)
    if (sessionData?.[0]?.auth_creds) {
      fs.writeFileSync(path.join(authDir, 'creds.json'), JSON.stringify(sessionData[0].auth_creds))
      logger.info({ sessionId }, 'Auth restored from Supabase')
    }
  } catch (e) { logger.warn({ sessionId }, 'No auth stored yet') }

  const entry = { sock: null, authDir, qrCode: null, outgoingInterval: null, reconnectTimeout: null, phone: null, status: 'connecting', userId, companyId, labels: {}, chatLabels: {}, syncingHistory: false, syncProgress: '' }
  sessions.set(sessionId, entry)

  const { state, saveCreds } = await useMultiFileAuthState(authDir)
  const { version } = await (async () => {
    try { const { fetchLatestBaileysVersion } = await import('@whiskeysockets/baileys'); return await fetchLatestBaileysVersion() } catch { return { version: [2, 3000, 0] } }
  })()

  const sock = makeWASocket({
    version, auth: state, printQRInTerminal: false,
    browser: ['Veltris CRM', 'Chrome', '1.0.0'],
    logger: pino({ level: 'silent' }),
    markOnlineOnConnect: false, syncFullHistory: true,
  })

  entry.sock = sock

  function startOutgoingPump() {
    if (entry.outgoingInterval) clearInterval(entry.outgoingInterval)
    logger.info({ sessionId }, 'Outgoing pump started')
    entry.outgoingInterval = setInterval(async () => {
      if (!entry.sock) { logger.debug({ sessionId }, 'Pump: no socket'); return }
      try {
        const { data: pending } = await supabase.from('whatsapp_messages').select('id,chat_id,text')
          .eq('session_id', sessionId).eq('direction', 'sent')
          .gte('created_at', new Date(Date.now() - 120000).toISOString()).order('created_at', { ascending: true }).limit(20)
        if (!pending?.length) { logger.debug({ sessionId }, 'Pump: no pending'); return }
        logger.info({ sessionId, count: pending.length }, 'Pump: processing pending messages')
        for (const msg of pending) {
          const { data: chats } = await supabase.from('whatsapp_chats').select('remote_jid').eq('id', msg.chat_id).limit(1)
          const jid = chats?.[0]?.remote_jid
          if (!jid) { logger.warn({ sessionId, msgId: msg.id }, 'Pump: no jid found'); continue }
          await entry.sock.sendMessage(jid, { text: msg.text })
          await supabase.from('whatsapp_messages').update({ direction: 'outgoing' }).eq('id', msg.id)
          logger.info({ sessionId, jid, msgId: msg.id }, 'Pump: message sent')
        }
      } catch (e) {
        logger.error({ sessionId, error: e.message }, 'Pump error')
        if (e.message?.includes('Connection closed')) { entry.sock = null; stopOutgoingPump() }
      }
    }, 3000)
  }

  function stopOutgoingPump() {
    if (entry.outgoingInterval) { clearInterval(entry.outgoingInterval); entry.outgoingInterval = null }
  }

  sock.ev.on('creds.update', async () => {
    await saveCreds()
    try {
      const credsPath = path.join(authDir, 'creds.json')
      if (fs.existsSync(credsPath)) {
        const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'))
        await supabase.from('whatsapp_sessions').update({ auth_creds: creds }).eq('id', sessionId)
      }
    } catch (e) {}
  })

  sock.ev.on('connection.update', async ({ qr, connection, lastDisconnect }) => {
    if (qr) {
      const qrDataUrl = await QRCode.toDataURL(qr)
      entry.qrCode = qrDataUrl
      await supabase.from('whatsapp_sessions').update({ qr_code: qrDataUrl, status: 'connecting' }).eq('id', sessionId)
    }
    if (connection && entry.qrCode) {
      entry.qrCode = null
      await supabase.from('whatsapp_sessions').update({ qr_code: null }).eq('id', sessionId)
    }
    if (connection === 'open') {
      entry.status = 'connected'
      const rawId = sock.user?.id || ''
      const phone = rawId.split(':')[0] || ''
      entry.phone = phone
      startOutgoingPump()
      await supabase.from('whatsapp_sessions').update({ status: 'connected', phone, qr_code: null }).eq('id', sessionId)
      setTimeout(() => syncContacts(sessionId, companyId), 5000)
      setTimeout(() => syncChatsFromStore(sessionId, companyId), 10000)
    }
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut
      entry.status = shouldReconnect ? 'connecting' : 'disconnected'
      entry.qrCode = null; entry.sock = null; stopOutgoingPump()
      await supabase.from('whatsapp_sessions').update({ status: entry.status }).eq('id', sessionId)
      if (shouldReconnect) {
        entry.reconnectTimeout = setTimeout(() => startSession(sessionId, userId, companyId), 5000)
      } else {
        try { fs.rmSync(authDir, { recursive: true, force: true }) } catch {}
        sessions.delete(sessionId)
      }
    }
  })

  sock.ev.on('messaging-history.set', async ({ chats, contacts: historyContacts, messages }) => {
    entry.syncingHistory = true
    entry.syncProgress = 'Processando histórico...'
    logger.info({ sessionId, chats: chats?.length, contacts: historyContacts?.length, messages: messages?.length }, 'History sync')
    if (!chats?.length && !historyContacts?.length && !messages?.length) { entry.syncingHistory = false; entry.syncProgress = ''; return }
    const nameMap = {}
    if (historyContacts) {
      for (const c of historyContacts) {
        const jid = c.id
        if (!jid || jid.includes('@g.us') || jid.includes('@broadcast') || jid.includes('@newsletter')) continue
        const cName = typeof c.name === 'string' ? c.name : (typeof c.notify === 'string' ? c.notify : (typeof c.verifiedName === 'string' ? c.verifiedName : ''))
        if (cName) nameMap[jid] = cName
      }
    }
    if (chats) {
      entry.syncProgress = `Sincronizando ${chats.length} conversas...`
      for (const chat of chats) {
        const jid = chat.id
        if (!jid || jid.includes('@g.us') || jid.includes('@broadcast') || jid.includes('@newsletter') || jid === 'status@broadcast') continue
        const phone = jid.split('@')[0]
        if (normalizePhone(phone).length >= 14) continue
        const contactName = nameMap[jid] || (typeof chat.name === 'string' ? chat.name : (typeof chat.notify === 'string' ? chat.notify : null)) || phone
        let contactId = null
        const existingContact = await findContactByPhone(phone, companyId)
        if (existingContact) { contactId = existingContact.id }
        else {
          const p = { name: contactName, phone: normalizePhone(phone), source: 'whatsapp', stage: 'novo', score: 0 }
          if (companyId) p.company_id = companyId
          const { data: newC } = await supabase.from('contacts').insert(p).select().single()
          if (newC) contactId = newC.id
        }
        const existingChat = await findChat(jid, sessionId)
        if (!existingChat) {
          await supabase.from('whatsapp_chats').insert({
            remote_jid: jid, contact_id: contactId, contact_name: contactName,
            last_message_at: chat.conversationTimestamp ? new Date(chat.conversationTimestamp * 1000).toISOString() : null,
            session_id: sessionId
          })
        }
      }
    }
    if (messages) {
      const total = messages.length
      const batchSize = 100
      for (let i = 0; i < total; i += batchSize) {
        entry.syncProgress = `Baixando mensagens ${Math.min(i + batchSize, total)}/${total}...`
        const batch = messages.slice(i, i + batchSize)
        const inserts = []
        for (const msg of batch) {
          const jid = msg.key?.remoteJid
          if (!jid || jid.includes('@g.us') || jid.includes('@broadcast') || jid.includes('@newsletter')) continue
          const phone = jid.split('@')[0]
          if (normalizePhone(phone).length >= 14) continue
          const existingChat = await findChat(jid, sessionId)
          if (!existingChat) continue
          const msgContent = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || msg.message?.videoMessage?.caption || ''
          if (!msgContent) continue
          const msgTs = msg.messageTimestamp ? new Date(msg.messageTimestamp * 1000).toISOString() : new Date().toISOString()
          inserts.push({ chat_id: existingChat.id, session_id: sessionId, text: msgContent.substring(0, 500), direction: msg.key.fromMe ? 'sent' : 'received', created_at: msgTs })
        }
        if (inserts.length) {
          await supabase.from('whatsapp_messages').insert(inserts)
        }
      }
    }
    entry.syncingHistory = false
    entry.syncProgress = 'Sincronização concluída!'
    logger.info({ sessionId }, 'History sync completed')
  })

  sock.ev.on('contacts.upsert', async (contacts) => {
    for (const c of contacts) {
      const jid = c.id
      if (!jid || jid.includes('@g.us') || jid.includes('@broadcast') || jid === 'status@broadcast') continue
      if (!c.name && !c.notify) continue
      const phone = jid.split('@')[0]
      if (normalizePhone(phone).length >= 14) continue
      const name = typeof c.name === 'string' ? c.name : (typeof c.notify === 'string' ? c.notify : phone)
      const existing = await findContactByNameOrPhone(phone, name, companyId)
      if (existing) {
        await supabase.from('contacts').update({ name, phone: normalizePhone(phone) }).eq('id', existing.id)
      } else {
        const p = { name, phone: normalizePhone(phone), source: 'whatsapp', stage: 'novo', score: 0 }
        if (companyId) p.company_id = companyId
        await supabase.from('contacts').insert(p)
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return
    logger.info({ sessionId, type, count: messages.length }, 'Messages upsert')
    for (const msg of messages) {
      try {
        if (!msg.message) { logger.debug({ sessionId, id: msg.key?.id }, 'No message body'); continue }
        const jid = msg.key.remoteJid
        if (!jid) { logger.debug({ sessionId, id: msg.key?.id }, 'No remoteJid'); continue }
        if (jid.includes('@g.us') || jid.includes('@broadcast') || jid.includes('@newsletter')) { logger.debug({ sessionId, jid }, 'Skipping group/broadcast'); continue }
        const msgPhone = jid.split('@')[0]
        if (msgPhone.replace(/\D/g,'').length >= 14) { logger.debug({ sessionId, phone: msgPhone }, 'Skipping LID'); continue }
        logger.info({ sessionId, jid, fromMe: msg.key.fromMe }, 'Processing incoming message')

        let mediaUrl = null, msgType = 'text'
        if (msg.message?.audioMessage) {
          msgType = 'audio'
          try {
            const buf = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock?.updateMediaMessage })
            if (buf) { const fname = sessionId + '_' + msg.key.id + '.ogg'; fs.writeFileSync(path.join(MEDIA_DIR, fname), buf); mediaUrl = '/media/' + fname }
          } catch (e) {}
        }
        if (msg.message?.imageMessage) {
          msgType = 'image'
          try {
            const buf = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock?.updateMediaMessage })
            if (buf) { const fname = sessionId + '_' + msg.key.id + '.jpg'; fs.writeFileSync(path.join(MEDIA_DIR, fname), buf); mediaUrl = '/media/' + fname }
          } catch (e) {}
        }

        const msgContent = msgType === 'audio' ? 'Mensagem de �udio' : msgType === 'image' ? 'Foto' : msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || msg.message.videoMessage?.caption || msg.message.documentMessage?.caption || ''
        if (!msgContent && !mediaUrl) continue
        const phone = jid.split('@')[0]
        if (normalizePhone(phone).length >= 14) continue
        const pushName = msg.pushName || phone
        const labelNames = ['minha posse','meu imovel','casa','apartamento','reserva','trabalho','escritorio','comercial','recado','fax','secretaria','eletronica','vendas']
        const cleanName = pushName.toLowerCase().trim()
        const displayName = (cleanName.length < 3 || labelNames.includes(cleanName) || (cleanName === cleanName.replace(/[A-Z]/g, '') && cleanName.includes(' '))) ? phone : pushName
        const isFromMe = msg.key.fromMe

        let contactId = null
        const existing = await findContactByPhone(phone, companyId)
        if (existing) {
          contactId = existing.id
          await supabase.from('contacts').update({ last_contacted_at: new Date().toISOString() }).eq('id', contactId)
        } else {
          const p = { name: displayName, phone: normalizePhone(phone), source: 'whatsapp', stage: 'novo', score: 0, last_contacted_at: new Date().toISOString() }
          if (companyId) p.company_id = companyId
          const { data: newC } = await supabase.from('contacts').insert(p).select().single()
          if (newC) contactId = newC.id
        }

        let chatId = null
        const existingChat = await findChat(jid, sessionId)
        if (existingChat) {
          chatId = existingChat.id
          await supabase.from('whatsapp_chats').update({
            remote_jid: jid, last_message: { text: msgContent.substring(0, 200), at: new Date().toISOString() },
            last_message_at: new Date().toISOString(),
            unread_count: isFromMe ? (existingChat.unread_count || 0) : (existingChat.unread_count || 0) + 1,
            contact_name: displayName
          }).eq('id', chatId)
        } else {
          const p = { remote_jid: jid, contact_id: contactId, contact_name: displayName, last_message: { text: msgContent.substring(0, 200), at: new Date().toISOString() }, last_message_at: new Date().toISOString(), unread_count: isFromMe ? 0 : 1, session_id: sessionId }
          if (companyId) p.company_id = companyId
          const { data: newChat } = await supabase.from('whatsapp_chats').insert(p).select().single()
          if (newChat) chatId = newChat.id
        }

        if (chatId) {
          const { data: dup } = await supabase.from('whatsapp_messages').select('id').eq('chat_id', chatId).eq('text', msgContent.substring(0, 100)).gte('created_at', new Date(Date.now() - 10000).toISOString()).limit(1)
          if (!dup?.length) {
            const dir = isFromMe ? 'outgoing' : 'received'
            const mp = { chat_id: chatId, session_id: sessionId, text: msgContent, direction: dir, created_at: new Date(msg.messageTimestamp ? msg.messageTimestamp * 1000 : Date.now()).toISOString() }
            if (mediaUrl) { mp.media_url = mediaUrl; mp.message_type = msgType }
            await supabase.from('whatsapp_messages').insert(mp)
          }
        }
      } catch (e) {}
    }
  })
}

async function syncContacts(sessionId, companyId) {
  const entry = sessions.get(sessionId)
  if (!entry?.sock?.store?.contacts) { setTimeout(() => syncContacts(sessionId, companyId), 10000); return }
  try {
    const entries = Object.entries(entry.sock.store.contacts)
    let synced = 0, skipped = 0
    for (const [jid, contact] of entries) {
      if (jid.includes('@g.us') || jid.includes('@broadcast') || jid.includes('@newsletter') || jid === 'status@broadcast') continue
      if (!contact.name && !contact.notify && !contact.verifiedName) continue
      const phone = jid.split('@')[0]
      if (normalizePhone(phone).length >= 14) continue
      const name = contact.name || contact.notify || contact.verifiedName || phone
      const existing = await findContactByNameOrPhone(phone, name, companyId)
      if (existing) { skipped++ }
      else {
        const p = { name, phone: normalizePhone(phone), source: 'whatsapp', stage: 'novo', score: 0 }
        if (companyId) p.company_id = companyId
        await supabase.from('contacts').insert(p); synced++
      }
    }
    logger.info({ sessionId, synced, skipped }, 'Contacts synced')
  } catch (e) {}
}

async function syncChatsFromStore(sessionId, companyId) {
  const entry = sessions.get(sessionId)
  if (!entry?.sock?.store?.contacts) { setTimeout(() => syncChatsFromStore(sessionId, companyId), 10000); return }
  try {
    const { data: existing } = await supabase.from('whatsapp_chats').select('remote_jid').eq('session_id', sessionId)
    const existingJids = new Set((existing || []).map(c => c.remote_jid))
    const contacts = entry.sock.store.contacts
    let created = 0
    for (const [jid, contact] of Object.entries(contacts)) {
      if (jid.includes('@g.us') || jid.includes('@broadcast') || jid.includes('@newsletter') || jid === 'status@broadcast') continue
      if (!contact.name && !contact.notify && !contact.verifiedName) continue
      if (existingJids.has(jid)) continue
      const phone = jid.split('@')[0]
      if (phone.replace(/\D/g,'').length >= 14) continue
      const name = contact.name || contact.notify || contact.verifiedName || phone
      const p = { remote_jid: jid, contact_name: name, session_id: sessionId }
      if (companyId) p.company_id = companyId
      await supabase.from('whatsapp_chats').insert(p); created++
    }
    if (created) logger.info({ sessionId, created }, 'Chats synced from store')
  } catch (e) {}
}

async function pollSessions() {
  try {
    const { data: dbSessions } = await supabase.from('whatsapp_sessions').select('id,status,user_id,company_id').in('status', ['connecting', 'disconnected', 'connected']).order('created_at', { ascending: false })
    if (!dbSessions) return
    let latestConnecting = null
    for (const dbS of dbSessions) {
      if (dbS.status === 'connected' && !sessions.has(dbS.id)) { startSession(dbS.id, dbS.user_id, dbS.company_id) }
      else if (dbS.status === 'connecting' && !sessions.has(dbS.id)) { if (!latestConnecting) latestConnecting = dbS }
      else if (dbS.status === 'disconnected' && sessions.has(dbS.id)) {
        const entry = sessions.get(dbS.id); if (entry.sock) try { entry.sock.logout() } catch {}; entry.sock = null
        if (entry.reconnectTimeout) { clearTimeout(entry.reconnectTimeout); entry.reconnectTimeout = null }
        try { fs.rmSync(entry.authDir, { recursive: true, force: true }) } catch {}; sessions.delete(dbS.id)
      }
    }
    if (latestConnecting && !sessions.has(latestConnecting.id)) { startSession(latestConnecting.id, latestConnecting.user_id, latestConnecting.company_id) }
  } catch (e) {}
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  const url = new URL(req.url, 'http://localhost')
  const pathname = url.pathname

  if (pathname === '/health') {
    let sid = url.searchParams.get('sessionId')
    let entry = sid ? sessions.get(sid) : null
    if (entry) { res.writeHead(200); res.end(JSON.stringify({ sessionId: sid, connected: entry.status === 'connected', status: entry.status, phone: entry.phone })); return }
    if (sid) {
      const { data: dbS } = await supabase.from('whatsapp_sessions').select('status,phone').eq('id', sid).limit(1)
      res.writeHead(200); res.end(JSON.stringify({ sessionId: sid, connected: dbS?.[0]?.status === 'connected', status: dbS?.[0]?.status || 'unknown', phone: dbS?.[0]?.phone || null })); return
    }
    res.writeHead(200); res.end(JSON.stringify({ status: 'ok', pid: process.pid, sessionsCount: sessions.size })); return
  }

  if (pathname === '/sessions') {
    const active = []
    for (const [id, entry] of sessions) { active.push({ sessionId: id, status: entry.status, phone: entry.phone, hasQr: !!entry.qrCode }) }
    if (!active.length) {
      const { data: dbS } = await supabase.from('whatsapp_sessions').select('id,status,phone').limit(10)
      if (dbS) for (const s of dbS) active.push({ sessionId: s.id, status: s.status === 'connected' ? 'connecting' : s.status, phone: s.phone })
    }
    res.writeHead(200); res.end(JSON.stringify({ sessions: active })); return
  }

  if (pathname === '/qr') {
    const sid = url.searchParams.get('sessionId')
    const entry = sid ? sessions.get(sid) : null
    res.writeHead(200); res.end(JSON.stringify({ qr_code: entry?.qrCode || null })); return
  }

  if (pathname === '/sync-status') {
    const sid = url.searchParams.get('sessionId')
    const entry = sid ? sessions.get(sid) : null
    res.writeHead(200); res.end(JSON.stringify({ syncing: entry?.syncingHistory || false, progress: entry?.syncProgress || '' })); return
  }

  if (pathname === '/pump-status') {
    const sid = url.searchParams.get('sessionId')
    const entry = sid ? sessions.get(sid) : null
    const pumpRunning = !!entry?.outgoingInterval
    let pending = []
    if (sid) {
      const { data } = await supabase.from('whatsapp_messages').select('id,chat_id,text,direction,created_at').eq('session_id', sid).eq('direction', 'sent').gte('created_at', new Date(Date.now() - 120000).toISOString()).limit(10)
      pending = data || []
    }
    res.writeHead(200); res.end(JSON.stringify({ pumpRunning, pendingCount: pending.length, pending, hasSocket: !!entry?.sock, sessionStatus: entry?.status })); return
  }

  if (pathname === '/connect') {
    try {
      const userId = url.searchParams.get('user_id') || null
      const { data: newSession, error } = await supabase.from('whatsapp_sessions').insert({ status: 'connecting', user_id: userId }).select().single()
      if (error) { res.writeHead(500); res.end(JSON.stringify({ error: error.message })); return }
      if (newSession) { startSession(newSession.id, newSession.user_id, newSession.company_id); res.writeHead(200); res.end(JSON.stringify({ sessionId: newSession.id })) }
      else { res.writeHead(500); res.end(JSON.stringify({ error: 'No session' })) }
    } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })) }
    return
  }

  if (pathname === '/disconnect' && req.method === 'POST') {
    const sid = url.searchParams.get('sessionId')
    if (!sid) { res.writeHead(400); res.end(JSON.stringify({ error: 'sessionId required' })); return }
    await supabase.from('whatsapp_sessions').update({ status: 'disconnected' }).eq('id', sid)
    const entry = sessions.get(sid)
    if (entry) { if (entry.sock) try { entry.sock.logout() } catch {}; entry.sock = null; sessions.delete(sid) }
    res.writeHead(200); res.end(JSON.stringify({ ok: true })); return
  }

  if (pathname === '/contacts') {
    const sid = url.searchParams.get('sessionId')
    const entry = sid ? sessions.get(sid) : null
    const storeContacts = entry?.sock?.store?.contacts || {}
    const list = []
    for (const [jid, contact] of Object.entries(storeContacts)) {
      if (jid.includes('@g.us') || jid.includes('@broadcast') || jid.includes('@newsletter') || jid === 'status@broadcast') continue
      const name = typeof contact.name === 'string' ? contact.name : (typeof contact.notify === 'string' ? contact.notify : (typeof contact.verifiedName === 'string' ? contact.verifiedName : ''))
      if (name) list.push({ jid, name, phone: jid.split('@')[0] })
    }
    res.writeHead(200); res.end(JSON.stringify({ contacts: list })); return
  }

  if (pathname === '/chats') {
    const sid = url.searchParams.get('sessionId')
    if (!sid) { res.writeHead(400); res.end(JSON.stringify({ error: 'sessionId required' })); return }
    const { data: waChats } = await supabase.from('whatsapp_chats').select('*').eq('session_id', sid).order('last_message_at', { ascending: false, nullsLast: true })
    const { data: contacts } = await supabase.from('contacts').select('id,name,phone,stage,tags,source')
    const nameByPhone = {}; const contactByPhone = {}
    if (contacts) for (const c of contacts) { const np = normalizePhone(c.phone || ''); nameByPhone[np] = c.name || np; contactByPhone[np] = c }
    const seen = {}; const result = []
    if (waChats) {
      for (const ch of waChats) {
        const np = normalizePhone(ch.remote_jid?.split('@')[0] || '')
        if (!np || np.length >= 14 || seen[np]) continue
        seen[np] = true
        const contact = contactByPhone[np]
        result.push({ id: ch.id, remote_jid: ch.remote_jid, contact_id: ch.contact_id, contact_name: contact?.name || ch.contact_name, last_message: ch.last_message, last_message_at: ch.last_message_at, unread_count: ch.unread_count || 0, contact_phone: contact?.phone || np, contact_stage: contact?.stage || null, contact_tags: contact?.tags || null, session_id: sid })
      }
    }
    // Also include contacts from contacts table that have no chat yet
    if (contacts) {
      for (const c of contacts) {
        const np = normalizePhone(c.phone || '')
        if (!np || np.length >= 14 || seen[np]) continue
        seen[np] = true
        // Only include WhatsApp-sourced contacts or those with a real name
        if (c.source !== 'whatsapp' && !c.name) continue
        // Check if this contact has any messages (orphaned)
        const { data: orphanMsgs } = await supabase.from('whatsapp_messages').select('id').limit(1)
        // Create a virtual chat entry for this contact
        result.push({
          id: 'contact_' + c.id, remote_jid: np, contact_id: c.id,
          contact_name: c.name || np,
          last_message: null, last_message_at: null,
          unread_count: 0, contact_phone: c.phone || np,
          contact_stage: c.stage || null, contact_tags: c.tags || null, session_id: sid,
        })
      }
    }
    res.writeHead(200); res.end(JSON.stringify({ chats: result })); return
  }

  if (pathname === '/messages') {
    const cid = url.searchParams.get('chatId')
    if (!cid) { res.writeHead(400); res.end(JSON.stringify({ error: 'chatId required' })); return }
    let messages = []
    // Handle virtual contact IDs (contact_ prefix)
    if (cid.startsWith('contact_')) {
      const contactId = cid.replace('contact_', '')
      // Try to find messages by contact phone
      const { data: contact } = await supabase.from('contacts').select('phone').eq('id', contactId).limit(1)
      if (contact?.length) {
        const np = normalizePhone(contact[0].phone || '')
        const { data: allChats } = await supabase.from('whatsapp_chats').select('id,remote_jid')
        const matchIds = []
        if (allChats) for (const ch of allChats) { if (normalizePhone(ch.remote_jid?.split('@')[0] || '') === np) matchIds.push(ch.id) }
        if (matchIds.length) {
          const result = await supabase.from('whatsapp_messages').select('*').in('chat_id', matchIds).order('created_at', { ascending: false }).range(0, 999)
          if (result.data?.length) messages = result.data
        }
      }
    } else {
      const result = await supabase.from('whatsapp_messages').select('*').eq('chat_id', cid).order('created_at', { ascending: false }).range(0, 999)
      messages = result.data || []
      // Merge from all chats with same phone
      const { data: chat } = await supabase.from('whatsapp_chats').select('remote_jid').eq('id', cid).limit(1)
      if (chat?.length) {
        const np = normalizePhone(chat[0].remote_jid?.split('@')[0] || '')
        const { data: allChats } = await supabase.from('whatsapp_chats').select('id,remote_jid')
        const matchIds = [cid]
        if (allChats) for (const ch of allChats) { if (normalizePhone(ch.remote_jid?.split('@')[0] || '') === np && ch.id !== cid) matchIds.push(ch.id) }
        if (matchIds.length > 1) {
          const { data } = await supabase.from('whatsapp_messages').select('*').in('chat_id', matchIds).order('created_at', { ascending: false }).range(0, 999)
          if (data?.length) {
            messages = data
            for (const mid of matchIds) { if (mid !== cid) { await supabase.from('whatsapp_messages').update({ chat_id: cid }).eq('chat_id', mid); await supabase.from('whatsapp_chats').delete().eq('id', mid) } }
          }
        }
      }
    }
    if (messages?.length) messages.reverse()
    res.writeHead(200); res.end(JSON.stringify({ messages: messages || [] })); return
  }

  if (pathname === '/db-contacts') {
    const { data: dbAll } = await supabase.from('contacts').select('name,phone')
    const filtered = (dbAll || []).filter(c => c.name && c.name !== c.phone && !c.name.startsWith('{') && !c.name.includes('@') && !/^\d+$/.test(c.name.replace(/\D/g, '') + 'x'))
    const seen = {}; const final = []
    for (const c of filtered) { const np = normalizePhone(c.phone); if (np && !seen[np]) { seen[np] = true; final.push(c) } }
    res.writeHead(200); res.end(JSON.stringify({ contacts: final })); return
  }

  if (pathname === '/remove-lids') {
    const { data: allC } = await supabase.from('contacts').select('id,name,phone')
    const toRemove = (allC || []).filter(c => { const p = normalizePhone(c.phone || ''); return p.length >= 14 })
    if (toRemove.length) { await supabase.from('contacts').delete().in('id', toRemove.map(c => c.id)) }
    res.writeHead(200); res.end(JSON.stringify({ ok: true, removed: toRemove.length })); return
  }

  if (pathname === '/deduplicate-contacts') {
    const { data: all } = await supabase.from('contacts').select('id,name,phone').order('created_at', { ascending: true })
    const seen = {}; const toDelete = []
    if (all) {
      for (const c of all) {
        const key = normalizePhone(c.phone) + '|' + ((c.name || '').toLowerCase().replace(/[^a-z0-9]/g, ''))
        if (seen[key]) { toDelete.push(c.id) }
        else { seen[key] = true }
      }
    }
    if (toDelete.length) { await supabase.from('contacts').delete().in('id', toDelete) }
    res.writeHead(200); res.end(JSON.stringify({ ok: true, removed: toDelete.length })); return
  }

  if (pathname === '/add-auth-column') {
    try {
      const { error } = await supabase.rpc('exec_sql', { sql: "ALTER TABLE whatsapp_sessions ADD COLUMN IF NOT EXISTS auth_creds JSONB;" })
      res.writeHead(200); res.end(JSON.stringify({ ok: !error, error: error?.message || null }))
    } catch (e) {
      res.writeHead(200); res.end(JSON.stringify({ ok: false, error: e.message, hint: 'Rode manualmente no Supabase SQL Editor: ALTER TABLE whatsapp_sessions ADD COLUMN IF NOT EXISTS auth_creds JSONB;' }))
    }
    return
  }

  if (pathname === '/send-message' && req.method === 'POST') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', async () => {
      try {
        const data = JSON.parse(body)
        if (!data.chatId || !data.text || !data.sessionId) { res.writeHead(400); res.end(JSON.stringify({ error: 'chatId, text, sessionId required' })); return }
        let chatId = data.chatId
        // Handle virtual contact IDs — create chat on first message
        if (chatId.startsWith('contact_')) {
          const contactId = chatId.replace('contact_', '')
          const { data: contact } = await supabase.from('contacts').select('phone,name').eq('id', contactId).limit(1)
          if (contact?.length) {
            const jid = '55' + normalizePhone(contact[0].phone || '') + '@s.whatsapp.net'
            const { data: newChat } = await supabase.from('whatsapp_chats').insert({
              remote_jid: jid, contact_id: contactId, contact_name: contact[0].name,
              session_id: data.sessionId
            }).select().single()
            if (newChat) chatId = newChat.id
          }
        }
        await supabase.from('whatsapp_messages').insert({ chat_id: chatId, session_id: data.sessionId, text: data.text.substring(0, 500), direction: 'sent', created_at: new Date().toISOString() })
        res.writeHead(200); res.end(JSON.stringify({ ok: true }))
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })) }
    })
    return
  }

  if (pathname === '/mark-read' && req.method === 'POST') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', async () => {
      try {
        const data = JSON.parse(body)
        if (!data.chatId) { res.writeHead(400); res.end(JSON.stringify({ error: 'chatId required' })); return }
        await supabase.from('whatsapp_chats').update({ unread_count: 0 }).eq('id', data.chatId)
        res.writeHead(200); res.end(JSON.stringify({ ok: true }))
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })) }
    })
    return
  }

  if (pathname === '/search-contact') {
    const q = url.searchParams.get('q') || ''
    const { data: nMatch } = await supabase.from('contacts').select('name,phone').ilike('name', '%' + q + '%')
    const { data: pMatch } = await supabase.from('contacts').select('name,phone').ilike('phone', '%' + q + '%')
    res.writeHead(200); res.end(JSON.stringify({ name: nMatch || [], phone: pMatch || [] })); return
  }

  if (pathname === '/debug') {
    const { data: mData } = await supabase.from('whatsapp_messages').select('id').limit(50000)
    const { data: cData } = await supabase.from('whatsapp_chats').select('id').limit(50000)
    res.writeHead(200); res.end(JSON.stringify({ chats: cData?.length || 0, messages: mData?.length || 0 })); return
  }

  if (pathname === '/debug-contact') {
    const q = url.searchParams.get('phone') || ''
    const np = normalizePhone(q)
    const contact = await findContactByPhone(q, null)
    const { data: chats } = await supabase.from('whatsapp_chats').select('*')
    const matchChats = (chats || []).filter(ch => normalizePhone(ch.remote_jid?.split('@')[0] || '') === np)
    const chatIds = matchChats.map(ch => ch.id)
    const { data: msgs } = chatIds.length ? await supabase.from('whatsapp_messages').select('*').in('chat_id', chatIds).order('created_at', { ascending: false }).limit(100) : { data: [] }
    res.writeHead(200); res.end(JSON.stringify({
      phone_original: q, phone_normalized: np,
      contact: contact || null,
      chats: matchChats.map(ch => ({ id: ch.id, remote_jid: ch.remote_jid, contact_name: ch.contact_name, last_message_at: ch.last_message_at })),
      messages_count: msgs?.length || 0,
      messages_sample: msgs?.slice(0, 5) || [],
    })); return
  }

  if (pathname.startsWith('/media/')) {
    const filePath = path.join(MEDIA_DIR, pathname.replace('/media/', '').replace(/[^a-zA-Z0-9\-_\.]/g, ''))
    if (fs.existsSync(filePath)) {
      const ext = path.extname(filePath).toLowerCase()
      const ct = ext === '.ogg' ? 'audio/ogg' : ext === '.jpg' ? 'image/jpeg' : ext === '.png' ? 'image/png' : 'application/octet-stream'
      res.writeHead(200, { 'Content-Type': ct }); fs.createReadStream(filePath).pipe(res)
    } else { res.writeHead(404); res.end('Not found') }
    return
  }

  res.writeHead(404); res.end('Not found')
})

server.listen(HTTP_PORT, () => logger.info({ port: HTTP_PORT }, 'Listening'))
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { logger.fatal('Env vars missing'); process.exit(1) }
setInterval(pollSessions, 10000)
pollSessions()
logger.info('Veltris WPP Server (multi-session) is running.')
process.on('SIGINT', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))
