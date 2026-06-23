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
  // Try exact name match
  let q = supabase.from('contacts').select('id,name,phone').eq('name', name)
  if (companyId) q = q.eq('company_id', companyId)
  const { data } = await q.limit(1)
  if (data?.length) return data[0]
  return null
}

async function findChat(jid, sessionId) {
  const phone = jid.split('@')[0]
  const variants = [jid, phone, phone + '@s.whatsapp.net']
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

  const entry = { sock: null, authDir, qrCode: null, outgoingInterval: null, reconnectTimeout: null, phone: null, status: 'connecting', userId, companyId, labels: {}, chatLabels: {} }
  sessions.set(sessionId, entry)

  const { state, saveCreds } = await useMultiFileAuthState(authDir)
  const { version } = await (async () => {
    try { const { fetchLatestBaileysVersion } = await import('@whiskeysockets/baileys'); return await fetchLatestBaileysVersion() } catch { return { version: [2, 3000, 0] } }
  })()

  const sock = makeWASocket({
    version, auth: state, printQRInTerminal: false,
    browser: ['Veltris CRM', 'Chrome', '1.0.0'],
    logger: pino({ level: 'silent' }),
    markOnlineOnConnect: false, syncFullHistory: false,
  })

  entry.sock = sock

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async ({ qr, connection, lastDisconnect }) => {
    if (qr) {
      const qrDataUrl = await QRCode.toDataURL(qr)
      entry.qrCode = qrDataUrl
      logger.info({ sessionId }, 'QR available')
      await supabase.from('whatsapp_sessions').update({ qr_code: qrDataUrl, status: 'connecting' }).eq('id', sessionId)
    }
    if (connection && entry.qrCode) {
      entry.qrCode = null
      await supabase.from('whatsapp_sessions').update({ qr_code: null }).eq('id', sessionId)
    }
    if (connection === 'open') {
      logger.info({ sessionId }, 'Connected')
      entry.status = 'connected'
      const rawId = sock.user?.id || ''
      const phone = rawId.split(':')[0] || ''
      entry.phone = phone
      await supabase.from('whatsapp_sessions').update({ status: 'connected', phone, qr_code: null }).eq('id', sessionId)
      setTimeout(() => syncContacts(sessionId, companyId), 5000)
      setTimeout(() => syncChatsFromStore(sessionId, companyId), 10000)
    }
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut
      logger.info({ sessionId, code: statusCode }, 'Disconnected')
      entry.status = shouldReconnect ? 'connecting' : 'disconnected'
      entry.qrCode = null; entry.sock = null
      await supabase.from('whatsapp_sessions').update({ status: entry.status }).eq('id', sessionId)
      if (shouldReconnect) {
        entry.reconnectTimeout = setTimeout(() => startSession(sessionId, userId, companyId), 5000)
      } else {
        try { fs.rmSync(authDir, { recursive: true, force: true }) } catch {}
        sessions.delete(sessionId)
      }
    }
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
    for (const msg of messages) {
      try {
        if (!msg.message) continue
        const jid = msg.key.remoteJid
        if (!jid || jid.includes('@g.us') || jid.includes('@broadcast') || jid.includes('@newsletter')) continue
        const msgPhone = jid.split('@')[0]
        if (msgPhone.replace(/\D/g,'').length >= 14) continue

        let mediaUrl = null, msgType = 'text'
        if (msg.message?.audioMessage) {
          msgType = 'audio'
          try {
            const buf = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock?.updateMediaMessage })
            if (buf) { const fname = sessionId + '_' + msg.key.id + '.ogg'; fs.writeFileSync(path.join(MEDIA_DIR, fname), buf); mediaUrl = '/media/' + fname }
          } catch (e) { logger.warn({ sessionId, error: e.message }, 'Audio download failed') }
        }
        if (msg.message?.imageMessage) {
          msgType = 'image'
          try {
            const buf = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock?.updateMediaMessage })
            if (buf) { const fname = sessionId + '_' + msg.key.id + '.jpg'; fs.writeFileSync(path.join(MEDIA_DIR, fname), buf); mediaUrl = '/media/' + fname }
          } catch (e) { logger.warn({ sessionId, error: e.message }, 'Image download failed') }
        }

        const msgContent = msgType === 'audio' ? 'Mensagem de áudio' : msgType === 'image' ? 'Foto' : msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || msg.message.videoMessage?.caption || msg.message.documentMessage?.caption || ''
        if (!msgContent && !mediaUrl) continue
        const phone = jid.split('@')[0]
        if (normalizePhone(phone).length >= 14) continue
        const pushName = msg.pushName || phone
        // Filter label-like pushNames: all lowercase, short, or known generic terms
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
      } catch (e) {
        logger.error({ sessionId, error: e.message }, 'Msg upsert error')
      }
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
  } catch (e) { logger.error({ sessionId, error: e.message }, 'Sync contacts error') }
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
  } catch (e) { logger.error({ sessionId, error: e.message }, 'Sync chats error') }
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
        const entry = sessions.get(dbS.id)
        if (entry.sock) { try { entry.sock.logout() } catch {} }
        entry.sock = null; if (entry.reconnectTimeout) { clearTimeout(entry.reconnectTimeout); entry.reconnectTimeout = null }
        try { fs.rmSync(entry.authDir, { recursive: true, force: true }) } catch {}; sessions.delete(dbS.id)
      }
    }
    if (latestConnecting && !sessions.has(latestConnecting.id)) { startSession(latestConnecting.id, latestConnecting.user_id, latestConnecting.company_id) }
  } catch (e) { logger.error({ error: e.message }, 'Poll error') }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  const url = new URL(req.url, 'http://localhost')
  const pathname = url.pathname

  // /health
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

  // /sessions
  if (pathname === '/sessions') {
    const active = []
    for (const [id, entry] of sessions) { active.push({ sessionId: id, status: entry.status, phone: entry.phone, hasQr: !!entry.qrCode }) }
    // Don't fallback to DB sessions that lost their socket — they need reconnect
    res.writeHead(200); res.end(JSON.stringify({ sessions: active })); return
  }

  // /qr 
  if (pathname === '/qr') {
    const sid = url.searchParams.get('sessionId')
    const entry = sid ? sessions.get(sid) : null
    res.writeHead(200); res.end(JSON.stringify({ qr_code: entry?.qrCode || null })); return
  }

  // /connect
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

  // /disconnect
  if (pathname === '/disconnect' && req.method === 'POST') {
    const sid = url.searchParams.get('sessionId')
    if (!sid) { res.writeHead(400); res.end(JSON.stringify({ error: 'sessionId required' })); return }
    await supabase.from('whatsapp_sessions').update({ status: 'disconnected' }).eq('id', sid)
    const entry = sessions.get(sid)
    if (entry) { if (entry.sock) try { entry.sock.logout() } catch {}; entry.sock = null; sessions.delete(sid) }
    res.writeHead(200); res.end(JSON.stringify({ ok: true })); return
  }

  // /contacts
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

  // /chats
  if (pathname === '/chats') {
    const sid = url.searchParams.get('sessionId')
    if (!sid) { res.writeHead(400); res.end(JSON.stringify({ error: 'sessionId required' })); return }
    const { data: chats } = await supabase.from('whatsapp_chats').select('*').not('last_message_at', 'is', null).order('last_message_at', { ascending: false }).limit(500)
    // Dedup by normalized phone
    const seenPhone = {}; const deduped = []
    if (chats) { for (const c of chats) { const p = normalizePhone(c.remote_jid?.split('@')[0] || ''); if (p && !seenPhone[p]) { seenPhone[p] = true; deduped.push(c) } else if (!p) { deduped.push(c) } } }
    // Update contact_name from contacts table if chat name is a label/phone
    const { data: dbContacts } = await supabase.from('contacts').select('phone,name')
    const nameByPhone = {}
    if (dbContacts) { for (const c of dbContacts) { if (c.name && !c.name.includes('@') && c.name !== c.phone && !/^\d+$/.test(c.name.replace(/\D/g, '') + 'x')) { nameByPhone[normalizePhone(c.phone)] = c.name } } }
    const labelNames = ['minha posse','meu imovel','casa','apartamento','reserva','trabalho','escritorio','comercial','recado','fax','secretaria','eletronica','vendas']
    for (const chat of deduped) {
      const phone = normalizePhone(chat.remote_jid?.split('@')[0] || '')
      const contactName = nameByPhone[phone]
      if (!contactName) continue
      const curName = (chat.contact_name || '').toLowerCase().trim()
      // Replace if current name is: phone number, short label, or all-lowercase generic phrase
      const isLabel = !chat.contact_name || chat.contact_name === phone || chat.contact_name === chat.remote_jid || curName.length < 3 || labelNames.includes(curName) || (curName === curName.replace(/[A-Z]/g, '') && curName.includes(' '))
      if (isLabel && contactName !== chat.contact_name) {
        chat.contact_name = contactName
        await supabase.from('whatsapp_chats').update({ contact_name: contactName }).eq('id', chat.id)
      }
    }
    res.writeHead(200); res.end(JSON.stringify({ chats: deduped || [] })); return
  }

  // /messages
  if (pathname === '/messages') {
    const cid = url.searchParams.get('chatId')
    if (!cid) { res.writeHead(400); res.end(JSON.stringify({ error: 'chatId required' })); return }
    const { data: messages } = await supabase.from('whatsapp_messages').select('*').eq('chat_id', cid).order('created_at', { ascending: false }).limit(500)
    if (messages) messages.reverse()
    res.writeHead(200); res.end(JSON.stringify({ messages: messages || [] })); return
  }

  // /db-contacts
  if (pathname === '/db-contacts') {
    const { data: dbAll } = await supabase.from('contacts').select('name,phone')
    const filtered = (dbAll || []).filter(c => c.name && c.name !== c.phone && !c.name.startsWith('{') && !c.name.includes('@') && !/^\d+$/.test(c.name.replace(/\D/g, '') + 'x'))
    const seen = {}; const final = []
    for (const c of filtered) { const np = normalizePhone(c.phone); if (np && !seen[np]) { seen[np] = true; final.push(c) } }
    res.writeHead(200); res.end(JSON.stringify({ contacts: final })); return
  }

  // /remove-lids
  if (pathname === '/remove-lids') {
    const { data: allC } = await supabase.from('contacts').select('id,name,phone')
    const toRemove = (allC || []).filter(c => { const p = normalizePhone(c.phone || ''); return p.length >= 14 })
    if (toRemove.length) { await supabase.from('contacts').delete().in('id', toRemove.map(c => c.id)) }
    res.writeHead(200); res.end(JSON.stringify({ ok: true, removed: toRemove.length })); return
  }

  // /deduplicate-contacts
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

  // /cleanup-chat-dups
  if (pathname === '/cleanup-chat-dups') {
    const { data: allChats } = await supabase.from('whatsapp_chats').select('id,remote_jid').order('created_at', { ascending: true })
    const seen = {}; let removed = 0
    if (allChats) { for (const c of allChats) { const norm = normalizePhone(c.remote_jid?.split('@')[0] || ''); if (norm && seen[norm]) { await supabase.from('whatsapp_chats').delete().eq('id', c.id); removed++ } else if (norm) { seen[norm] = true } } }
    res.writeHead(200); res.end(JSON.stringify({ ok: true, removed })); return
  }

  // /send-message
  if (pathname === '/send-message' && req.method === 'POST') {
    let body = ''
    req.on('data', chunk => body += chunk)
    req.on('end', async () => {
      try {
        const data = JSON.parse(body)
        if (!data.chatId || !data.text || !data.sessionId) { res.writeHead(400); res.end(JSON.stringify({ error: 'chatId, text, sessionId required' })); return }
        await supabase.from('whatsapp_messages').insert({ chat_id: data.chatId, session_id: data.sessionId, text: data.text.substring(0, 500), direction: 'sent', created_at: new Date().toISOString() })
        res.writeHead(200); res.end(JSON.stringify({ ok: true }))
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })) }
    })
    return
  }

  // /mark-read
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

  // /search-contact
  if (pathname === '/search-contact') {
    const q = url.searchParams.get('q') || ''
    const { data: nMatch } = await supabase.from('contacts').select('name,phone').ilike('name', '%' + q + '%')
    const { data: pMatch } = await supabase.from('contacts').select('name,phone').ilike('phone', '%' + q + '%')
    res.writeHead(200); res.end(JSON.stringify({ name: nMatch || [], phone: pMatch || [] })); return
  }

  // /debug
  if (pathname === '/debug') {
    const { data: mData } = await supabase.from('whatsapp_messages').select('id').limit(10000)
    const { data: cData } = await supabase.from('whatsapp_chats').select('id').limit(5000)
    res.writeHead(200); res.end(JSON.stringify({ chats: cData?.length || 0, messages: mData?.length || 0 })); return
  }

  // /media files
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
