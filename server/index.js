import WebSocket from 'ws'
import { makeWASocket, useMultiFileAuthState, DisconnectReason, downloadMediaMessage } from '@whiskeysockets/baileys'
import QRCode from 'qrcode'
import pino from 'pino'
import fs from 'fs'
import path from 'path'
import http from 'http'
import 'dotenv/config'
import { parse } from 'csv-parse/sync'
import * as XLSX from 'xlsx'

globalThis.WebSocket = WebSocket
const { createClient } = await import('@supabase/supabase-js')

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const AUTH_BASE = './auth'
const MEDIA_DIR = './media'
const SPREADSHEETS_DIR = './spreadsheets'
const PORT = 3123

const logger = pino({ level: process.env.LOG_LEVEL || 'info' })
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false }, realtime: { transport: WebSocket } })

if (!fs.existsSync(AUTH_BASE)) fs.mkdirSync(AUTH_BASE, { recursive: true })
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true })
if (!fs.existsSync(SPREADSHEETS_DIR)) fs.mkdirSync(SPREADSHEETS_DIR, { recursive: true })

const sessions = new Map()

function normalizePhone(raw) {
  if (!raw) return ''
  var p = raw.replace(/\D/g, '').replace(/^55/, '')
  return p
}
function phoneVariants(raw) {
  const p = normalizePhone(raw); if (!p) return []
  return [p, '55' + p]
}

async function findContactByPhone(phone, companyId) {
  for (const v of phoneVariants(phone)) {
    let q = supabase.from('contacts').select('id,name,phone').eq('phone', v)
    if (companyId) q = q.eq('company_id', companyId)
    const { data } = await q.limit(1)
    if (data?.length) return data[0]
  }
  return null
}
async function findContactByNameOrPhone(phone, name, companyId) {
  if (!name || name === phone) return findContactByPhone(phone, companyId)
  for (const v of phoneVariants(phone)) {
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
  const phone = jid.split('@')[0]; const np = normalizePhone(phone)
  const variants = [jid, phone, phone + '@s.whatsapp.net', np, '55' + np, '55' + np + '@s.whatsapp.net']
  for (const v of variants) {
    let q = supabase.from('whatsapp_chats').select('id,unread_count').eq('remote_jid', v)
    if (sessionId) q = q.eq('session_id', sessionId)
    const { data } = await q.limit(1)
    if (data?.length) return data[0]
  }
  return null
}
async function getCompanyId(sid) {
  if (!sid) return null
  const entry = sessions.get(sid)
  if (entry?.companyId) return entry.companyId
  try {
    const { data } = await supabase.from('whatsapp_sessions').select('company_id').eq('id', sid).limit(1)
    if (data?.[0]?.company_id) return data[0].company_id
    // If session has no company_id, return a sentinel to block queries
    return 'NO_COMPANY'
  } catch (e) {}
  return 'NO_COMPANY'
}
async function trimMessages(chatId, max = 200) {
  try {
    const { data: ids } = await supabase.from('whatsapp_messages').select('id').eq('chat_id', chatId).order('created_at', { ascending: false })
    if (ids?.length > max) {
      await supabase.from('whatsapp_messages').delete().in('id', ids.slice(max).map(m => m.id))
    }
  } catch (e) {}
}

async function startSession(sessionId, userId, companyId) {
  logger.info({ sessionId }, 'startSession')
  await supabase.from('whatsapp_sessions').update({ status: 'connecting' }).eq('id', sessionId)
  if (sessions.has(sessionId)) {
    if (sessions.get(sessionId).sock) return
  }
  const authDir = path.join(AUTH_BASE, sessionId)
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true })
  try {
    const { data: sd } = await supabase.from('whatsapp_sessions').select('auth_creds').eq('id', sessionId).limit(1)
    if (sd?.[0]?.auth_creds) {
      fs.writeFileSync(path.join(authDir, 'creds.json'), JSON.stringify(sd[0].auth_creds))
      logger.info({ sessionId }, 'Auth restored')
    }
  } catch (e) {}

  const entry = { sock: null, authDir, qrCode: null, outgoingInterval: null, reconnectTimeout: null, phone: null, status: 'connecting', userId, companyId, labels: {}, chatLabels: {}, syncingHistory: false, syncProgress: '' }
  sessions.set(sessionId, entry)

  const { state, saveCreds } = await useMultiFileAuthState(authDir)
  let ver = [2, 3000, 0]
  try { const f = await import('@whiskeysockets/baileys'); ver = (await f.fetchLatestBaileysVersion()).version } catch (e) {}

  const sock = makeWASocket({
    version: ver, auth: state, printQRInTerminal: false,
    browser: ['Veltris CRM', 'Chrome', '1.0.0'],
    logger: pino({ level: 'silent' }), markOnlineOnConnect: false, syncFullHistory: true,
  })
  entry.sock = sock

  sock.ev.on('creds.update', async () => {
    await saveCreds()
    try {
      const p = path.join(authDir, 'creds.json')
      if (fs.existsSync(p)) {
        await supabase.from('whatsapp_sessions').update({ auth_creds: JSON.parse(fs.readFileSync(p, 'utf-8')) }).eq('id', sessionId)
      }
    } catch (e) {}
  })

  function startOutgoingPump() {
    if (entry.outgoingInterval) clearInterval(entry.outgoingInterval)
    entry.outgoingInterval = setInterval(async () => {
      if (!entry.sock) return
      try {
        const { data: pending } = await supabase.from('whatsapp_messages').select('id,chat_id,text,media_url,message_type').eq('session_id', sessionId).eq('direction', 'sent').gte('created_at', new Date(Date.now() - 120000).toISOString()).order('created_at', { ascending: true }).limit(20)
        if (!pending?.length) return
        for (const msg of pending) {
          try {
            const { data: chats } = await supabase.from('whatsapp_chats').select('remote_jid').eq('id', msg.chat_id).limit(1)
            const jid = chats?.[0]?.remote_jid; if (!jid) { await supabase.from('whatsapp_messages').update({ direction: 'failed' }).eq('id', msg.id); continue }
            if (msg.message_type === 'image' && msg.media_url) {
              const fp = path.join(MEDIA_DIR, msg.media_url.replace('/media/', ''))
              if (fs.existsSync(fp)) { await entry.sock.sendMessage(jid, { image: fs.readFileSync(fp), caption: msg.text || '' }) }
              else { await entry.sock.sendMessage(jid, { text: msg.text }) }
            } else if (msg.message_type === 'audio' && msg.media_url) {
              const fp = path.join(MEDIA_DIR, msg.media_url.replace('/media/', ''))
              if (fs.existsSync(fp)) { await entry.sock.sendMessage(jid, { audio: fs.readFileSync(fp), mimetype: 'audio/ogg' }) }
              else { await entry.sock.sendMessage(jid, { text: msg.text }) }
            } else {
              await entry.sock.sendMessage(jid, { text: msg.text })
            }
            await supabase.from('whatsapp_messages').update({ direction: 'outgoing' }).eq('id', msg.id)
          } catch (e) {
            if (e.message?.includes('Connection closed')) { entry.sock = null; clearInterval(entry.outgoingInterval); entry.outgoingInterval = null; return }
            await supabase.from('whatsapp_messages').update({ direction: 'failed' }).eq('id', msg.id)
          }
        }
      } catch (e) {}
    }, 3000)
  }
  function stopOutgoingPump() { if (entry.outgoingInterval) { clearInterval(entry.outgoingInterval); entry.outgoingInterval = null } }

  sock.ev.on('connection.update', async ({ qr, connection, lastDisconnect }) => {
    if (qr) {
      entry.qrCode = await QRCode.toDataURL(qr)
      await supabase.from('whatsapp_sessions').update({ qr_code: entry.qrCode, status: 'connecting' }).eq('id', sessionId)
    }
    if (connection && entry.qrCode) { entry.qrCode = null; await supabase.from('whatsapp_sessions').update({ qr_code: null }).eq('id', sessionId) }
    if (connection === 'open') {
      entry.status = 'connected'; entry.phone = (sock.user?.id || '').split(':')[0] || ''
      startOutgoingPump()
      await supabase.from('whatsapp_sessions').update({ status: 'connected', phone: entry.phone, qr_code: null }).eq('id', sessionId)
      setTimeout(() => syncContacts(sessionId, companyId), 5000)
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode; const reconnect = code !== DisconnectReason.loggedOut
      entry.status = reconnect ? 'connecting' : 'disconnected'; entry.qrCode = null; entry.sock = null; stopOutgoingPump()
      await supabase.from('whatsapp_sessions').update({ status: entry.status }).eq('id', sessionId)
      if (reconnect) { entry.reconnectTimeout = setTimeout(() => startSession(sessionId, userId, companyId), 5000) }
      else { try { fs.rmSync(authDir, { recursive: true, force: true }) } catch {}; sessions.delete(sessionId) }
    }
  })

  sock.ev.on('messaging-history.set', async ({ chats, contacts: hc, messages }) => {
    entry.syncingHistory = true; entry.syncProgress = 'Processando historico...'
    if (!chats?.length && !hc?.length && !messages?.length) { entry.syncingHistory = false; entry.syncProgress = ''; return }
    const nameMap = {}
    if (hc) { for (const c of hc) { const j = c.id; if (!j || j.includes('@g.us') || j.includes('@broadcast') || j.includes('@newsletter')) continue; const n = typeof c.name === 'string' ? c.name : (typeof c.notify === 'string' ? c.notify : ''); if (n) nameMap[j] = n } }
    if (chats) {
      entry.syncProgress = `Sincronizando ${chats.length} conversas...`
      for (const chat of chats) {
        const jid = chat.id; if (!jid || jid.includes('@g.us') || jid.includes('@broadcast') || jid.includes('@newsletter') || jid === 'status@broadcast') continue
        const phone = jid.split('@')[0]; if (normalizePhone(phone).length >= 14) continue
        const cn = nameMap[jid] || (typeof chat.name === 'string' ? chat.name : (typeof chat.notify === 'string' ? chat.notify : null)) || phone
        let cid = null; const exC = await findContactByPhone(phone, companyId)
        if (exC) { cid = exC.id } else { const p = { name: cn, phone: normalizePhone(phone), source: 'whatsapp', stage: 'novo', score: 0 }; if (companyId) p.company_id = companyId; const r = await supabase.from('contacts').insert(p).select().single(); if (r.data) cid = r.data.id }
        const exChat = await findChat(jid, sessionId)
        if (!exChat) { await supabase.from('whatsapp_chats').insert({ remote_jid: jid, contact_id: cid, contact_name: cn, last_message_at: chat.conversationTimestamp ? new Date(chat.conversationTimestamp * 1000).toISOString() : null, session_id: sessionId }) }
      }
    }
    if (messages) {
      for (let i = 0; i < messages.length; i += 100) {
        entry.syncProgress = `Baixando mensagens ${Math.min(i + 100, messages.length)}/${messages.length}...`
        const inserts = []
        for (const msg of messages.slice(i, i + 100)) {
          const jid = msg.key?.remoteJid; if (!jid || jid.includes('@g.us') || jid.includes('@broadcast') || jid.includes('@newsletter')) continue
          const phone = jid.split('@')[0]; if (normalizePhone(phone).length >= 14) continue
          const ec = await findChat(jid, sessionId); if (!ec) continue
          const txt = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || ''
          if (!txt) continue
          inserts.push({ chat_id: ec.id, session_id: sessionId, text: txt.substring(0, 500), direction: msg.key.fromMe ? 'sent' : 'received', created_at: msg.messageTimestamp ? new Date(msg.messageTimestamp * 1000).toISOString() : new Date().toISOString() })
        }
        if (inserts.length) {
          await supabase.from('whatsapp_messages').insert(inserts)
          const trimmed = new Set(inserts.map(m => m.chat_id))
          for (const t of trimmed) trimMessages(t)
        }
      }
    }
    entry.syncingHistory = false; entry.syncProgress = 'Sincronizacao concluida!'
  })

  sock.ev.on('contacts.upsert', async (contacts) => {
    for (const c of contacts) {
      const jid = c.id; if (!jid || jid.includes('@g.us') || jid.includes('@broadcast') || jid === 'status@broadcast') continue
      if (!c.name && !c.notify) continue; const phone = jid.split('@')[0]
      if (normalizePhone(phone).length >= 14) continue
      const name = typeof c.name === 'string' ? c.name : (typeof c.notify === 'string' ? c.notify : phone)
      const ex = await findContactByNameOrPhone(phone, name, companyId)
      if (ex) { await supabase.from('contacts').update({ name, phone: normalizePhone(phone) }).eq('id', ex.id) }
      else { const p = { name, phone: normalizePhone(phone), source: 'whatsapp', stage: 'novo', score: 0 }; if (companyId) p.company_id = companyId; await supabase.from('contacts').insert(p) }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify' && type !== 'append') return
    for (const msg of messages) {
      try {
        if (!msg.message) continue; const jid = msg.key.remoteJid
        if (!jid || jid.includes('@g.us') || jid.includes('@broadcast') || jid.includes('@newsletter')) continue
        const mp = jid.split('@')[0]; if (normalizePhone(mp).length >= 14) continue
        let mediaUrl = null, mType = 'text'
        if (msg.message?.audioMessage) { mType = 'audio'; try { const buf = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }) }); if (buf) { const fn = sessionId + '_' + msg.key.id + '.ogg'; fs.writeFileSync(path.join(MEDIA_DIR, fn), buf); mediaUrl = '/media/' + fn } } catch (e) {} }
        if (msg.message?.imageMessage) { mType = 'image'; try { const buf = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }) }); if (buf) { const fn = sessionId + '_' + msg.key.id + '.jpg'; fs.writeFileSync(path.join(MEDIA_DIR, fn), buf); mediaUrl = '/media/' + fn } } catch (e) {} }
        const txt = mType === 'audio' ? 'Audio' : mType === 'image' ? 'Foto' : msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || ''
        if (!txt && !mediaUrl) continue; const phone = jid.split('@')[0]
        if (normalizePhone(phone).length >= 14) continue
        const pn = msg.pushName || phone; const labelN = ['minha posse','meu imovel','casa','apartamento','reserva','trabalho']
        const clean = pn.toLowerCase().trim(); const dn = (clean.length < 3 || labelN.includes(clean)) ? phone : pn
        const isMe = msg.key.fromMe
        let contactId = null; const exC = await findContactByPhone(phone, companyId)
        if (exC) { contactId = exC.id; await supabase.from('contacts').update({ last_contacted_at: new Date().toISOString() }).eq('id', contactId) }
        else { const p = { name: dn, phone: normalizePhone(phone), source: 'whatsapp', stage: 'novo', score: 0, last_contacted_at: new Date().toISOString() }; if (companyId) p.company_id = companyId; const r = await supabase.from('contacts').insert(p).select().single(); if (r.data) contactId = r.data.id }
        let chatId = null; const exCh = await findChat(jid, sessionId)
        if (exCh) {
          chatId = exCh.id; await supabase.from('whatsapp_chats').update({ remote_jid: jid, last_message: { text: txt.substring(0, 200), at: new Date().toISOString() }, last_message_at: new Date().toISOString(), unread_count: isMe ? (exCh.unread_count || 0) : (exCh.unread_count || 0) + 1, contact_name: dn }).eq('id', chatId)
        } else {
          const p = { remote_jid: jid, contact_id: contactId, contact_name: dn, last_message: { text: txt.substring(0, 200), at: new Date().toISOString() }, last_message_at: new Date().toISOString(), unread_count: isMe ? 0 : 1, session_id: sessionId }; if (companyId) p.company_id = companyId
          const r = await supabase.from('whatsapp_chats').insert(p).select().single(); if (r.data) chatId = r.data.id
        }
        if (chatId) {
          const { data: dup } = await supabase.from('whatsapp_messages').select('id').eq('chat_id', chatId).eq('text', txt.substring(0, 100)).gte('created_at', new Date(Date.now() - 30000).toISOString()).limit(1)
          if (!dup?.length) {
            const dir = isMe ? 'outgoing' : 'received'
            const mp2 = { chat_id: chatId, session_id: sessionId, text: txt, direction: dir, created_at: new Date(msg.messageTimestamp ? msg.messageTimestamp * 1000 : Date.now()).toISOString() }
            if (mediaUrl) { mp2.media_url = mediaUrl; mp2.message_type = mType }
            await supabase.from('whatsapp_messages').insert(mp2); trimMessages(chatId)
          }
        }
      } catch (e) { logger.error({ sessionId, error: e.message }, 'Msg error') }
    }
  })
}

async function syncContacts(sessionId, companyId) {
  const entry = sessions.get(sessionId)
  if (!entry?.sock?.store?.contacts) { setTimeout(() => syncContacts(sessionId, companyId), 10000); return }
  try {
    for (const [jid, contact] of Object.entries(entry.sock.store.contacts)) {
      if (jid.includes('@g.us') || jid.includes('@broadcast') || jid.includes('@newsletter') || jid === 'status@broadcast') continue
      if (!contact.name && !contact.notify && !contact.verifiedName) continue
      const phone = jid.split('@')[0]; if (normalizePhone(phone).length >= 14) continue
      const name = contact.name || contact.notify || contact.verifiedName || phone
      const ex = await findContactByNameOrPhone(phone, name, companyId)
      if (!ex) { const p = { name, phone: normalizePhone(phone), source: 'whatsapp', stage: 'novo', score: 0 }; if (companyId) p.company_id = companyId; await supabase.from('contacts').insert(p) }
    }
  } catch (e) {}
}

async function pollSessions() {
  try {
    const { data: dbS } = await supabase.from('whatsapp_sessions').select('id,status,user_id,company_id').in('status', ['connecting', 'disconnected', 'connected']).order('created_at', { ascending: false })
    if (!dbS) return; let latestConnecting = null
    for (const s of dbS) {
      if (s.status === 'connected' && !sessions.has(s.id)) { startSession(s.id, s.user_id, s.company_id) }
      else if (s.status === 'connecting' && !sessions.has(s.id)) { if (!latestConnecting) latestConnecting = s }
      else if (s.status === 'disconnected' && sessions.has(s.id)) { const e = sessions.get(s.id); if (e.sock) try { e.sock.logout() } catch {}; e.sock = null; if (e.reconnectTimeout) clearTimeout(e.reconnectTimeout); try { fs.rmSync(e.authDir, { recursive: true, force: true }) } catch {}; sessions.delete(s.id) }
    }
    if (latestConnecting && !sessions.has(latestConnecting.id)) { startSession(latestConnecting.id, latestConnecting.user_id, latestConnecting.company_id) }
  } catch (e) {}
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  const url = new URL(req.url, 'http://localhost'); const pathname = url.pathname

  if (pathname === '/health') {
    let sid = url.searchParams.get('sessionId'); let e = sid ? sessions.get(sid) : null
    if (e) { res.writeHead(200); res.end(JSON.stringify({ sessionId: sid, connected: e.status === 'connected', status: e.status, phone: e.phone })); return }
    if (sid) { const { data: d } = await supabase.from('whatsapp_sessions').select('status,phone').eq('id', sid).limit(1); res.writeHead(200); res.end(JSON.stringify({ sessionId: sid, connected: d?.[0]?.status === 'connected', status: d?.[0]?.status || 'unknown', phone: d?.[0]?.phone || null })); return }
    res.writeHead(200); res.end(JSON.stringify({ status: 'ok', pid: process.pid, cwd: process.cwd(), publicExists: fs.existsSync(path.join(process.cwd(), 'public')) })); return
  }

  if (pathname === '/sessions') {
    const uid = url.searchParams.get('user_id') || null; const cid = url.searchParams.get('company_id') || null
    const active = []
    for (const [id, e] of sessions) {
      if (cid && e.companyId && e.companyId !== cid) continue
      if (uid && e.userId && e.userId !== uid) continue
      active.push({ sessionId: id, status: e.status, phone: e.phone, hasQr: !!e.qrCode, userId: e.userId, companyId: e.companyId })
    }
    if (!active.length && cid) {
      const { data: dbs } = await supabase.from('whatsapp_sessions').select('id,status,phone,user_id,company_id').eq('company_id', cid)
      if (dbs) for (const s of dbs) active.push({ sessionId: s.id, status: s.status === 'connected' ? 'connecting' : s.status, phone: s.phone, userId: s.user_id, companyId: s.company_id })
    }
    res.writeHead(200); res.end(JSON.stringify({ sessions: active })); return
  }

  if (pathname === '/qr') { const sid = url.searchParams.get('sessionId'); const e = sid ? sessions.get(sid) : null; res.writeHead(200); res.end(JSON.stringify({ qr_code: e?.qrCode || null })); return }
  if (pathname === '/sync-status') { const sid = url.searchParams.get('sessionId'); const e = sid ? sessions.get(sid) : null; res.writeHead(200); res.end(JSON.stringify({ syncing: e?.syncingHistory || false, progress: e?.syncProgress || '' })); return }
  if (pathname === '/pump-status') { const sid = url.searchParams.get('sessionId'); const e = sid ? sessions.get(sid) : null; const pump = !!e?.outgoingInterval; let p = []; if (sid) { const r = await supabase.from('whatsapp_messages').select('id,chat_id,text,direction,created_at').eq('session_id', sid).eq('direction', 'sent').gte('created_at', new Date(Date.now() - 120000).toISOString()).limit(10); p = r.data || [] }; res.writeHead(200); res.end(JSON.stringify({ pumpRunning: pump, pendingCount: p.length, pending: p, hasSocket: !!e?.sock, sessionStatus: e?.status })); return }

  if (pathname === '/connect') {
    try {
      const userId = url.searchParams.get('user_id') || null; const companyId = url.searchParams.get('company_id') || null
      const insertData = { status: 'connecting', user_id: userId }; if (companyId) insertData.company_id = companyId
      const { data: ns, error } = await supabase.from('whatsapp_sessions').insert(insertData).select().single()
      if (error) { res.writeHead(500); res.end(JSON.stringify({ error: error.message })); return }
      if (ns) { startSession(ns.id, ns.user_id, ns.company_id); res.writeHead(200); res.end(JSON.stringify({ sessionId: ns.id })) }
      else { res.writeHead(500); res.end(JSON.stringify({ error: 'No session' })) }
    } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })) }
    return
  }

  if (pathname === '/disconnect' && req.method === 'POST') {
    const sid = url.searchParams.get('sessionId')
    if (!sid) { res.writeHead(400); res.end(JSON.stringify({ error: 'sessionId required' })); return }
    await supabase.from('whatsapp_sessions').update({ status: 'disconnected' }).eq('id', sid)
    const e = sessions.get(sid); if (e) { if (e.sock) try { e.sock.logout() } catch {}; e.sock = null; sessions.delete(sid) }
    res.writeHead(200); res.end(JSON.stringify({ ok: true })); return
  }

  if (pathname === '/contacts') {
    const sid = url.searchParams.get('sessionId'); const e = sid ? sessions.get(sid) : null
    const store = e?.sock?.store?.contacts || {}; const list = []
    for (const [jid, c] of Object.entries(store)) {
      if (jid.includes('@g.us') || jid.includes('@broadcast') || jid.includes('@newsletter') || jid === 'status@broadcast') continue
      const n = typeof c.name === 'string' ? c.name : (typeof c.notify === 'string' ? c.notify : (typeof c.verifiedName === 'string' ? c.verifiedName : ''))
      if (n) list.push({ jid, name: n, phone: jid.split('@')[0] })
    }
    res.writeHead(200); res.end(JSON.stringify({ contacts: list })); return
  }

  if (pathname === '/chats') {
    const sid = url.searchParams.get('sessionId')
    if (!sid) { res.writeHead(400); res.end(JSON.stringify({ error: 'sessionId required' })); return }
    const cid = await getCompanyId(sid)
    const { data: wa } = await supabase.from('whatsapp_chats').select('*').eq('session_id', sid).order('last_message_at', { ascending: false, nullsLast: true })
    let q = supabase.from('contacts').select('id,name,phone,stage,tags,source')
    if (cid) q = q.eq('company_id', cid)
    const { data: cont } = await q
    const byPhone = {}; const conByPhone = {}
    if (cont) for (const c of cont) { const np = normalizePhone(c.phone || ''); byPhone[np] = c.name || np; conByPhone[np] = c }
    const seen = {}; const result = []
    if (wa) { for (const ch of wa) { const np = normalizePhone(ch.remote_jid?.split('@')[0] || ''); if (!np || np.length >= 14 || seen[np]) continue; seen[np] = true; const ct = conByPhone[np]; result.push({ id: ch.id, remote_jid: ch.remote_jid, contact_id: ch.contact_id, contact_name: ct?.name || ch.contact_name, last_message: ch.last_message, last_message_at: ch.last_message_at, unread_count: ch.unread_count || 0, contact_phone: ct?.phone || np, contact_stage: ct?.stage || null, contact_tags: ct?.tags || null, session_id: sid }) } }
    if (cont) { for (const c of cont) { const np = normalizePhone(c.phone || ''); if (!np || np.length >= 14 || seen[np]) continue; seen[np] = true; if (c.source !== 'whatsapp' && !c.name) continue; result.push({ id: 'contact_' + c.id, remote_jid: np, contact_id: c.id, contact_name: c.name || np, last_message: null, last_message_at: null, unread_count: 0, contact_phone: c.phone || np, contact_stage: c.stage || null, contact_tags: c.tags || null, session_id: sid }) } }
    res.writeHead(200); res.end(JSON.stringify({ chats: result })); return
  }

  if (pathname === '/messages') {
    const cid = url.searchParams.get('chatId')
    if (!cid) { res.writeHead(400); res.end(JSON.stringify({ error: 'chatId required' })); return }
    let msgs = []
    if (cid.startsWith('contact_')) {
      const contactId = cid.replace('contact_', '')
      const { data: ct } = await supabase.from('contacts').select('phone').eq('id', contactId).limit(1)
      if (ct?.length) {
        const np = normalizePhone(ct[0].phone || '')
        const { data: allC } = await supabase.from('whatsapp_chats').select('id,remote_jid')
        const ids = []; if (allC) for (const ch of allC) { if (normalizePhone(ch.remote_jid?.split('@')[0] || '') === np) ids.push(ch.id) }
        if (ids.length) { const r = await supabase.from('whatsapp_messages').select('*').in('chat_id', ids).order('created_at', { ascending: false }).range(0, 199); if (r.data?.length) msgs = r.data }
      }
    } else {
      const r = await supabase.from('whatsapp_messages').select('*').eq('chat_id', cid).order('created_at', { ascending: false }).range(0, 199); msgs = r.data || []
      const { data: chat } = await supabase.from('whatsapp_chats').select('remote_jid').eq('id', cid).limit(1)
      if (chat?.length) {
        const np = normalizePhone(chat[0].remote_jid?.split('@')[0] || '')
        const { data: allC } = await supabase.from('whatsapp_chats').select('id,remote_jid'); const ids = [cid]
        if (allC) for (const ch of allC) { if (normalizePhone(ch.remote_jid?.split('@')[0] || '') === np && ch.id !== cid) ids.push(ch.id) }
        if (ids.length > 1) { const r2 = await supabase.from('whatsapp_messages').select('*').in('chat_id', ids).order('created_at', { ascending: false }).range(0, 199); if (r2.data?.length) { msgs = r2.data; for (const id of ids) { if (id !== cid) { await supabase.from('whatsapp_messages').update({ chat_id: cid }).eq('chat_id', id); await supabase.from('whatsapp_chats').delete().eq('id', id) } } } }
      }
    }
    if (msgs?.length) msgs.reverse()
    res.writeHead(200); res.end(JSON.stringify({ messages: msgs || [] })); return
  }

  if (pathname === '/db-contacts') {
    const sid = url.searchParams.get('sessionId'); const companyId = sid ? await getCompanyId(sid) : null
    let q = supabase.from('contacts').select('id,name,phone,tags')
    if (companyId) q = q.eq('company_id', companyId)
    const { data: all } = await q
    const filtered = (all || []).filter(c => c.name && c.name !== c.phone && !c.name.startsWith('{') && !c.name.includes('@') && !/^\d+$/.test(c.name.replace(/\D/g, '') + 'x'))
    const seen = {}; const final = []
    for (const c of filtered) { const np = normalizePhone(c.phone); if (np && !seen[np]) { seen[np] = true; final.push(c) } }
    res.writeHead(200); res.end(JSON.stringify({ contacts: final })); return
  }

  if (pathname === '/remove-lids') {
    const sid = url.searchParams.get('sessionId'); const companyId = sid ? await getCompanyId(sid) : null
    let q = supabase.from('contacts').select('id,name,phone')
    if (companyId) q = q.eq('company_id', companyId)
    const { data: all } = await q
    const toRemove = (all || []).filter(c => { const p = normalizePhone(c.phone || ''); return p.length >= 14 })
    if (toRemove.length) await supabase.from('contacts').delete().in('id', toRemove.map(c => c.id))
    res.writeHead(200); res.end(JSON.stringify({ ok: true, removed: toRemove.length })); return
  }

  if (pathname === '/deduplicate-contacts') {
    const sid = url.searchParams.get('sessionId'); const companyId = sid ? await getCompanyId(sid) : null
    let q = supabase.from('contacts').select('id,name,phone').order('created_at', { ascending: true })
    if (companyId) q = q.eq('company_id', companyId)
    const { data: all } = await q; const seen = {}; const toDelete = []
    if (all) { for (const c of all) { const key = normalizePhone(c.phone) + '|' + ((c.name || '').toLowerCase().replace(/[^a-z0-9]/g, '')); if (seen[key]) { toDelete.push(c.id) } else { seen[key] = true } } }
    if (toDelete.length) await supabase.from('contacts').delete().in('id', toDelete)
    res.writeHead(200); res.end(JSON.stringify({ ok: true, removed: toDelete.length })); return
  }

  if (pathname === '/cleanup-chat-dups') {
    const { data: allC } = await supabase.from('whatsapp_chats').select('id,remote_jid')
    const { data: allM } = await supabase.from('whatsapp_messages').select('chat_id').limit(50000)
    const counts = {}; if (allM) for (const m of allM) counts[m.chat_id] = (counts[m.chat_id] || 0) + 1
    const phones = {}; let removed = 0
    if (allC) { for (const c of allC) { const norm = normalizePhone(c.remote_jid?.split('@')[0] || ''); if (!norm) continue; if (phones[norm]) { const ex = phones[norm]; const exC = counts[ex] || 0; const curC = counts[c.id] || 0; if (curC > exC) { await supabase.from('whatsapp_messages').update({ chat_id: c.id }).eq('chat_id', ex); await supabase.from('whatsapp_chats').delete().eq('id', ex); phones[norm] = c.id } else { await supabase.from('whatsapp_messages').update({ chat_id: ex }).eq('chat_id', c.id); await supabase.from('whatsapp_chats').delete().eq('id', c.id) }; removed++ } else { phones[norm] = c.id } } }
    res.writeHead(200); res.end(JSON.stringify({ ok: true, removed })); return
  }

  if (pathname === '/send-message' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', async () => {
      try {
        const d = JSON.parse(body)
        if (!d.chatId || !d.text || !d.sessionId) { res.writeHead(400); res.end(JSON.stringify({ error: 'chatId, text, sessionId required' })); return }
        let chatId = d.chatId
        if (chatId.startsWith('contact_')) {
          const contactId = chatId.replace('contact_', '')
          const { data: ct } = await supabase.from('contacts').select('phone,name').eq('id', contactId).limit(1)
          if (ct?.length) {
            const jid = '55' + normalizePhone(ct[0].phone || '') + '@s.whatsapp.net'
            const { data: nc } = await supabase.from('whatsapp_chats').insert({ remote_jid: jid, contact_id: contactId, contact_name: ct[0].name, session_id: d.sessionId }).select().single()
            if (nc) chatId = nc.id
          }
        }
        const insertData = { chat_id: chatId, session_id: d.sessionId, text: d.text.substring(0, 500), direction: 'sent', created_at: new Date().toISOString() }
        if (d.mediaUrl) { insertData.media_url = d.mediaUrl; insertData.message_type = d.messageType || 'image' }
        await supabase.from('whatsapp_messages').insert(insertData)
        trimMessages(chatId)
        res.writeHead(200); res.end(JSON.stringify({ ok: true }))
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })) }
    })
    return
  }

  if (pathname === '/mark-read' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', async () => {
      try {
        const d = JSON.parse(body)
        if (!d.chatId) { res.writeHead(400); res.end(JSON.stringify({ error: 'chatId required' })); return }
        await supabase.from('whatsapp_chats').update({ unread_count: 0 }).eq('id', d.chatId)
        res.writeHead(200); res.end(JSON.stringify({ ok: true }))
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })) }
    })
    return
  }

  if (pathname === '/search-contact') {
    const sid = url.searchParams.get('sessionId'); const companyId = sid ? await getCompanyId(sid) : null
    const q = url.searchParams.get('q') || ''
    let nq = supabase.from('contacts').select('name,phone').ilike('name', '%' + q + '%')
    if (companyId) nq = nq.eq('company_id', companyId)
    const { data: nM } = await nq
    let pq = supabase.from('contacts').select('name,phone').ilike('phone', '%' + q + '%')
    if (companyId) pq = pq.eq('company_id', companyId)
    const { data: pM } = await pq
    res.writeHead(200); res.end(JSON.stringify({ name: nM || [], phone: pM || [] })); return
  }

  if (pathname === '/labels') {
    const sid = url.searchParams.get('sessionId'); const e = sid ? sessions.get(sid) : null
    res.writeHead(200); res.end(JSON.stringify({ labels: e?.labels ? Object.values(e.labels) : [] })); return
  }
  if (pathname === '/chat-labels') {
    const sid = url.searchParams.get('sessionId'); const cid = url.searchParams.get('chatId') || ''; const e = sid ? sessions.get(sid) : null
    const lids = e?.chatLabels?.[cid] || []; const r = lids.map(l => { const lb = e?.labels?.[l]; return lb ? { id: l, name: lb.name, color: lb.hexColor } : null }).filter(Boolean)
    res.writeHead(200); res.end(JSON.stringify({ labels: r })); return
  }

  if (pathname === '/add-auth-column') {
    try { const { error } = await supabase.rpc('exec_sql', { sql: "ALTER TABLE whatsapp_sessions ADD COLUMN IF NOT EXISTS auth_creds JSONB;" }); res.writeHead(200); res.end(JSON.stringify({ ok: !error, error: error?.message || null })) }
    catch (e) { res.writeHead(200); res.end(JSON.stringify({ ok: false, error: e.message, hint: 'Rode: ALTER TABLE whatsapp_sessions ADD COLUMN IF NOT EXISTS auth_creds JSONB;' })) }
    return
  }

  if (pathname.startsWith('/media/')) {
    let fp = path.join(MEDIA_DIR, pathname.replace('/media/', '').replace(/[^a-zA-Z0-9\-_\.\/]/g, ''))
    if (!fs.existsSync(fp)) {
      // Try common extensions
      for (const ext of ['.jpg', '.jpeg', '.png', '.ogg', '.mp3', '.mp4']) { const fp2 = fp + ext; if (fs.existsSync(fp2)) { fp = fp2; break } }
    }
    if (fs.existsSync(fp)) { const ext = path.extname(fp).toLowerCase(); const ct = ext === '.ogg' ? 'audio/ogg' : ext === '.mp3' ? 'audio/mpeg' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.png' ? 'image/png' : ext === '.mp4' ? 'video/mp4' : 'application/octet-stream'; res.writeHead(200, { 'Content-Type': ct }); fs.createReadStream(fp).pipe(res) }
    else { res.writeHead(404); res.end('Not found') }
    return
  }

  if (pathname === '/diag') {
    const tables = ['tasks','kanban_columns','kanban_cards','documents','contacts','cadence_actions','cadences','whatsapp_chats','whatsapp_messages','whatsapp_sessions','app_checklist','app_kanban','app_conversations','app_suggestions','app_analyses','app_feedback']
    const result = {}
    for (const t of tables) {
      try {
        const { data } = await supabase.from(t).select('company_id')
        const counts = {}
        if (data) for (const r of data) { const cid = r.company_id || 'NULL'; counts[cid] = (counts[cid] || 0) + 1 }
        result[t] = counts
      } catch (e) { result[t] = { error: e.message } }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result, null, 2)); return
  }

  if (pathname === '/fix-null-company') {
    const targetCid = url.searchParams.get('company_id')
    if (!targetCid) { res.writeHead(400); res.end(JSON.stringify({ error: 'company_id required' })); return }
    const tables = ['contacts','whatsapp_chats','whatsapp_messages','whatsapp_sessions']
    let total = 0
    for (const t of tables) {
      try {
        const { data: nullRows } = await supabase.from(t).select('id').is('company_id', null)
        if (nullRows?.length) {
          await supabase.from(t).update({ company_id: targetCid }).is('company_id', null)
          total += nullRows.length
        }
      } catch (e) {}
    }
    res.writeHead(200); res.end(JSON.stringify({ ok: true, updated: total, company_id: targetCid })); return
  }

  if (pathname === '/list-tags') {
    const sid = url.searchParams.get('sessionId')
    if (!sid) { res.writeHead(200); res.end(JSON.stringify({ tags: [] })); return }
    const companyId = await getCompanyId(sid)
    if (!companyId || companyId === 'NO_COMPANY') { res.writeHead(200); res.end(JSON.stringify({ tags: [] })); return }
    // Get tags from contacts table
    const { data: contacts } = await supabase.from('contacts').select('tags').eq('company_id', companyId)
    const tagSet = new Set()
    if (contacts) for (const c of contacts) if (c.tags) for (const t of c.tags) tagSet.add(t)
    // Also get defined tags from session auth_creds
    const { data: sess } = await supabase.from('whatsapp_sessions').select('auth_creds').eq('company_id', companyId).limit(1)
    if (sess?.[0]?.auth_creds?.definedTags) for (const t of sess[0].auth_creds.definedTags) tagSet.add(t)
    res.writeHead(200); res.end(JSON.stringify({ tags: [...tagSet].sort() })); return
  }

  if (pathname === '/create-tag' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', async () => {
      try {
        const { tag, sessionId } = JSON.parse(body)
        if (!tag || !sessionId) { res.writeHead(400); res.end(JSON.stringify({ error: 'tag and sessionId required' })); return }
        const companyId = await getCompanyId(sessionId)
        if (!companyId || companyId === 'NO_COMPANY') { res.writeHead(200); res.end(JSON.stringify({ ok: true })); return }
        // Store in first session's auth_creds for this company
        const { data: sessions } = await supabase.from('whatsapp_sessions').select('id,auth_creds').eq('company_id', companyId).limit(1)
        if (sessions?.length) {
          const creds = sessions[0].auth_creds || {}
          const definedTags = creds.definedTags || []
          if (!definedTags.includes(tag)) definedTags.push(tag)
          await supabase.from('whatsapp_sessions').update({ auth_creds: { ...creds, definedTags } }).eq('id', sessions[0].id)
        }
        res.writeHead(200); res.end(JSON.stringify({ ok: true }))
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })) }
    })
    return
  }

  if (pathname === '/delete-tag' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', async () => {
      try {
        const { tag, sessionId } = JSON.parse(body)
        if (!tag || !sessionId) { res.writeHead(400); res.end(JSON.stringify({ error: 'tag and sessionId required' })); return }
        const companyId = await getCompanyId(sessionId)
        if (!companyId || companyId === 'NO_COMPANY') { res.writeHead(200); res.end(JSON.stringify({ ok: true })); return }
        // Remove from defined tags
        const { data: sessions } = await supabase.from('whatsapp_sessions').select('id,auth_creds').eq('company_id', companyId).limit(1)
        if (sessions?.length) {
          const creds = sessions[0].auth_creds || {}
          const definedTags = (creds.definedTags || []).filter(t => t !== tag)
          await supabase.from('whatsapp_sessions').update({ auth_creds: { ...creds, definedTags } }).eq('id', sessions[0].id)
        }
        // Remove from all contacts - fetch and update
        const { data: toUpdate } = await supabase.from('contacts').select('id,tags').eq('company_id', companyId)
        if (toUpdate) {
          for (const c of toUpdate) {
            if (c.tags?.includes(tag)) {
              await supabase.from('contacts').update({ tags: c.tags.filter(t => t !== tag) }).eq('id', c.id)
            }
          }
        }
        res.writeHead(200); res.end(JSON.stringify({ ok: true }))
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })) }
    })
    return
  }

  if (pathname === '/manage-leads' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', async () => {
      try {
        const { action, data, sessionId } = JSON.parse(body)
        if (!sessionId) { res.writeHead(200); res.end(JSON.stringify([])); return }
        const companyId = await getCompanyId(sessionId)
        if (!companyId || companyId === 'NO_COMPANY') { res.writeHead(200); res.end(JSON.stringify([])); return }
        // Verify session is actually connected
        const entry = sessions.get(sessionId)
        if (!entry || entry.status !== 'connected') { res.writeHead(200); res.end(JSON.stringify([])); return }
        if (action === 'list') {
          let q = supabase.from('contacts').select('*').eq('company_id', companyId)
          if (data?.excludeWhatsApp) q = q.neq('source', 'whatsapp')
          const { data: leads } = await q
          res.writeHead(200); res.end(JSON.stringify(leads || []))
        } else if (action === 'create') {
          const r = await supabase.from('contacts').insert(Object.assign({}, data, { company_id: companyId, source: 'manual' })).select().single()
          res.writeHead(200); res.end(JSON.stringify(r.data || {}))
        } else if (action === 'update') {
          await supabase.from('contacts').update(data).eq('id', data.id).eq('company_id', companyId)
          res.writeHead(200); res.end(JSON.stringify({ ok: true }))
        } else if (action === 'delete') {
          await supabase.from('contacts').delete().eq('id', data.id).eq('company_id', companyId)
          res.writeHead(200); res.end(JSON.stringify({ ok: true }))
        } else { res.writeHead(400); res.end(JSON.stringify({ error: 'Unknown action' })) }
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })) }
    })
    return
  }

  // ── Spreadsheet endpoints ──
  if (pathname === '/upload-spreadsheet' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', async () => {
      try {
        const { name, content, sessionId } = JSON.parse(body)
        if (!content || !sessionId) { res.writeHead(400); res.end(JSON.stringify({ error: 'content and sessionId required' })); return }
        const companyId = await getCompanyId(sessionId)
        if (!companyId || companyId === 'NO_COMPANY') { res.writeHead(200); res.end(JSON.stringify({ error: 'No company' })); return }
        const companyDir = path.join(SPREADSHEETS_DIR, companyId)
        if (!fs.existsSync(companyDir)) fs.mkdirSync(companyDir, { recursive: true })
        const fileId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
        const ext = name?.endsWith('.xlsx') ? '.xlsx' : '.csv'
        const fp = path.join(companyDir, fileId + ext)
        // Parse rows
        function extractRow(r) {
          var entries = Object.entries(r)
          var name = '', phone = ''
          for (var i = 0; i < entries.length; i++) {
            var k = entries[i][0].toLowerCase().replace(/[^a-z0-9]/g, '')
            var v = String(entries[i][1] ?? '').trim()
            if (k === 'nome' || k === 'name' || k === 'nomedocliente' || k === 'cliente' || k === 'contato' && !phone) name = v
            else if (k === 'contato' || k === 'phone' || k === 'telefone' || k === 'celular' || k === 'numero' || k === 'whatsapp' || k === 'tel' || k === 'fone' || k === 'movel') phone = v
          }
          if (!phone && entries.length <= 3) {
            var phoneCandidates = entries.filter(function(e) { var np = normalizePhone(String(e[1] ?? '')); return np && np.length >= 8 })
            if (phoneCandidates.length === 1) {
              phone = String(phoneCandidates[0][1] ?? '')
              if (!name) name = String(entries.filter(function(e) { return e[0] !== phoneCandidates[0][0] })[0]?.[1] ?? '')
            }
          }
          return { name, phone: normalizePhone(phone) }
        }
        let rows = []
        if (ext === '.csv') {
          const records = parse(content, { columns: true, skip_empty_lines: true, relax_column_count: true })
          rows = records.map(extractRow).filter(r => r.phone && r.phone.length >= 2)
          if (rows.length < records.length) logger.info({ sessionId, total: records.length, valid: rows.length, skipped: records.map(extractRow).filter(r => !r.phone || r.phone.length < 2).map(function(r){return r}).slice(0, 3) }, 'Spreadsheet row filter')
        } else {
          const wb = XLSX.read(content, { type: 'base64' })
          const ws = wb.Sheets[wb.SheetNames[0]]
          const rawData = XLSX.utils.sheet_to_json(ws, { header: 1 }).filter(function(row){ return row.some(function(cell){ return cell !== undefined && cell !== null && cell !== '' }) })
          // Check if first row looks like headers (contains known column names)
          var firstRow = rawData[0] || []
          var hasHeaders = firstRow.some(function(cell) { var s = String(cell).toLowerCase().replace(/[^a-z0-9]/g, ''); return ['nome','name','contato','phone','telefone','celular','numero','whatsapp','cliente'].includes(s) })
          var data
          if (hasHeaders) {
            // Use first row as headers
            data = rawData.slice(1).map(function(row) {
              var obj = {}
              for (var i = 0; i < firstRow.length; i++) obj[String(firstRow[i])] = row[i]
              return obj
            })
          } else {
            // No headers - try to auto-detect columns (first column = name, second = phone)
            data = rawData.map(function(row) {
              var obj = {}
              if (row.length >= 2) { obj['nome'] = String(row[0] ?? ''); obj['contato'] = String(row[1] ?? '') }
              else obj['contato'] = String(row[0] ?? '')
              return obj
            })
          }
          rows = data.map(extractRow).filter(r => r.phone && r.phone.length >= 2)
        }
        // Save metadata
        const meta = { fileId, name: name || fileId, ext, rowCount: rows.length, createdAt: new Date().toISOString() }
        fs.writeFileSync(fp, JSON.stringify({ meta, rows }))
        res.writeHead(200); res.end(JSON.stringify({ ok: true, ...meta }))
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })) }
    })
    return
  }

  if (pathname === '/list-spreadsheets') {
    const sid = url.searchParams.get('sessionId')
    if (!sid) { res.writeHead(200); res.end(JSON.stringify({ files: [] })); return }
    const companyId = await getCompanyId(sid)
    if (!companyId || companyId === 'NO_COMPANY') { res.writeHead(200); res.end(JSON.stringify({ files: [] })); return }
    const companyDir = path.join(SPREADSHEETS_DIR, companyId)
    const files = []
    if (fs.existsSync(companyDir)) {
      for (const f of fs.readdirSync(companyDir)) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(companyDir, f), 'utf-8'))
          if (data.meta) files.push(data.meta)
        } catch (e) {}
      }
    }
    files.sort((a, b) => b.createdAt?.localeCompare(a.createdAt || ''))
    res.writeHead(200); res.end(JSON.stringify({ files })); return
  }

  if (pathname === '/delete-spreadsheet' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', async () => {
      try {
        const { fileId, sessionId } = JSON.parse(body)
        if (!fileId || !sessionId) { res.writeHead(400); res.end(JSON.stringify({ error: 'fileId and sessionId required' })); return }
        const companyId = await getCompanyId(sessionId)
        if (!companyId || companyId === 'NO_COMPANY') { res.writeHead(200); res.end(JSON.stringify({ ok: false })); return }
        const companyDir = path.join(SPREADSHEETS_DIR, companyId)
        if (fs.existsSync(companyDir)) {
          for (const f of fs.readdirSync(companyDir)) {
            if (f.startsWith(fileId)) { fs.unlinkSync(path.join(companyDir, f)); break }
          }
        }
        res.writeHead(200); res.end(JSON.stringify({ ok: true }))
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })) }
    })
    return
  }

  if (pathname === '/upload-media' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', async () => {
      try {
        const { data, ext, sessionId } = JSON.parse(body)
        if (!data || !sessionId) { res.writeHead(400); res.end(JSON.stringify({ error: 'data and sessionId required' })); return }
        const companyId = await getCompanyId(sessionId)
        if (!companyId || companyId === 'NO_COMPANY') { res.writeHead(200); res.end(JSON.stringify({ mediaUrl: null })); return }
        const companyMediaDir = path.join(MEDIA_DIR, companyId)
        if (!fs.existsSync(companyMediaDir)) fs.mkdirSync(companyMediaDir, { recursive: true })
        const fileId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + '.' + (ext || 'jpg')
        const fp = path.join(companyMediaDir, fileId)
        fs.writeFileSync(fp, Buffer.from(data, 'base64'))
        const mediaUrl = '/media/' + companyId + '/' + fileId
        res.writeHead(200); res.end(JSON.stringify({ ok: true, mediaUrl }))
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })) }
    })
    return
  }

  if (pathname === '/send-spreadsheet-disparo' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', async () => {
      try {
        const { fileId, text, mediaUrl, messageType, sessionId } = JSON.parse(body)
        if (!fileId || !text || !sessionId) { res.writeHead(400); res.end(JSON.stringify({ error: 'fileId, text, sessionId required' })); return }
        const companyId = await getCompanyId(sessionId)
        if (!companyId || companyId === 'NO_COMPANY') { res.writeHead(200); res.end(JSON.stringify({ sent: 0, failed: 0 })); return }
        // Read spreadsheet
        const companyDir = path.join(SPREADSHEETS_DIR, companyId)
        let rows = []
        if (fs.existsSync(companyDir)) {
          for (const f of fs.readdirSync(companyDir)) {
            if (f.startsWith(fileId)) {
              const data = JSON.parse(fs.readFileSync(path.join(companyDir, f), 'utf-8'))
              rows = data.rows || []; break
            }
          }
        }
        let sent = 0, failed = 0
        const entry = sessions.get(sessionId)
        const sock = entry?.sock
        for (const row of rows) {
          try {
            const personalized = text.replace(/\{nome\}/g, row.name)
            const jid = '55' + row.phone + '@s.whatsapp.net'
            // Send directly via Baileys socket (bypasses pump, avoids echo duplicates)
            if (sock) {
              if (mediaUrl && messageType === 'image') {
                const fp = path.join(MEDIA_DIR, mediaUrl.replace('/media/', ''))
                if (fs.existsSync(fp)) await sock.sendMessage(jid, { image: fs.readFileSync(fp), caption: personalized || '' })
                else await sock.sendMessage(jid, { text: personalized })
              } else if (mediaUrl && messageType === 'audio') {
                const fp = path.join(MEDIA_DIR, mediaUrl.replace('/media/', ''))
                if (fs.existsSync(fp)) await sock.sendMessage(jid, { audio: fs.readFileSync(fp), mimetype: 'audio/ogg' })
                else await sock.sendMessage(jid, { text: personalized })
              } else {
                await sock.sendMessage(jid, { text: personalized })
              }
            }
            sent++
          } catch (e) { failed++ }
        }
        res.writeHead(200); res.end(JSON.stringify({ ok: true, sent, failed, total: rows.length }))
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })) }
    })
    return
  }

  if (pathname === '/api-proxy' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', async () => {
      try {
        const { operation, table, params, body: reqBody } = JSON.parse(body)
        const sid = params?.sessionId || url.searchParams.get('sessionId')
        const companyId = sid ? await getCompanyId(sid) : null
        const isConnected = sid && sessions.get(sid)?.status === 'connected'
        logger.info('Proxy: ' + operation + ' ' + table + ' sid=' + (sid || 'null') + ' cid=' + (companyId || 'null') + ' filters=' + JSON.stringify(params?.filters || {}))
        const scoped = ['tasks','kanban_columns','kanban_cards','documents','contacts','cadence_actions','cadences','whatsapp_chats','whatsapp_messages','whatsapp_sessions','app_checklist','app_kanban','app_conversations','app_suggestions','app_analyses','app_feedback']
        if (scoped.includes(table) && (!companyId || companyId === 'NO_COMPANY' || !isConnected)) { res.writeHead(200); res.end(JSON.stringify({ data: [] })); return }
        if (operation === 'select') {
          let q = supabase.from(table).select(params?.select || '*')
          if (scoped.includes(table)) q = q.eq('company_id', companyId)
          if (params?.filters) for (const [k, v] of Object.entries(params.filters)) if (k !== 'company_id') q = q.eq(k, v)
          if (params?.order) { const d = params.order.endsWith('.desc'); q = q.order(params.order.replace(/\.(desc|asc)$/, ''), { ascending: !d }) }
          if (params?.limit) q = q.limit(parseInt(params.limit))
          if (params?.offset) q = q.range(parseInt(params.offset), parseInt(params.offset) + (parseInt(params.limit) || 100) - 1)
          const r = await q; res.writeHead(200); res.end(JSON.stringify(r))
        } else if (operation === 'insert') {
          const r = await supabase.from(table).insert(Object.assign({}, reqBody || {}, { company_id: companyId })).select()
          res.writeHead(200); res.end(JSON.stringify(r))
        } else if (operation === 'update') {
          let q = supabase.from(table).update(reqBody || {}).eq('company_id', companyId)
          if (params?.filters) for (const [k, v] of Object.entries(params.filters)) if (k !== 'company_id') q = q.eq(k, v)
          await q; res.writeHead(200); res.end(JSON.stringify({ data: [] }))
        } else if (operation === 'delete') {
          let q = supabase.from(table).delete().eq('company_id', companyId)
          if (params?.filters) for (const [k, v] of Object.entries(params.filters)) if (k !== 'company_id') q = q.eq(k, v)
          await q; res.writeHead(200); res.end(JSON.stringify({ data: [] }))
        } else { res.writeHead(400); res.end(JSON.stringify({ error: 'Unknown operation' })) }
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })) }
    })
    return
  }

  // Try static files from public/ fallback
  const publicDir = path.join(process.cwd(), 'public')
  if (req.method === 'GET') {
    let fp = path.join(publicDir, pathname === '/' ? 'index.html' : pathname.substring(1))
    if (fp.startsWith(publicDir) && fs.existsSync(fp) && !fs.statSync(fp).isDirectory()) {
      const ext = path.extname(fp).toLowerCase(); const ct = { '.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png' }
      res.writeHead(200, { 'Content-Type': ct[ext] || 'application/octet-stream' }); fs.createReadStream(fp).pipe(res); return
    }
  }

  res.writeHead(404); res.end('Not found')
})

server.listen(PORT, () => logger.info({ port: PORT }, 'Listening'))
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { logger.fatal('Env vars missing'); process.exit(1) }
setInterval(pollSessions, 10000)
pollSessions()
logger.info('Veltris WPP Server (multi-session) is running.')
process.on('SIGINT', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))


