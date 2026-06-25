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
// Daily send limits per company
const dailySent = {}
const DAILY_LIMIT_DEFAULT = 500
// Merge log storage (in-memory, persists per server restart)
const mergeLogs = {}

let msgUpsertCount = 0, msgSkippedNoMsg = 0, msgSkippedGroup = 0, msgSkippedNoText = 0, msgProcessed = 0, msgTypesSeen = '', msgNotifyCount = 0, msgNonNotifyTypes = '', msgErrors = ''
let msgJidsReceived = ''

function normalizePhone(raw) {
  if (!raw) return ''
  var p = raw.replace(/\D/g, '').replace(/^55/, '')
  // Brazilian mobile: add 9 after DDD only if number doesn't already start with 9
  if (p.length === 10 && p[2] !== '9') p = p.slice(0, 2) + '9' + p.slice(2)
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
async function findChat(jid, sessionId, companyId) {
  const phone = jid.split('@')[0]; const np = normalizePhone(phone)
  const variants = [jid, phone, phone + '@s.whatsapp.net', np, '55' + np, '55' + np + '@s.whatsapp.net', '55' + phone, '55' + phone + '@s.whatsapp.net']
  // Try with session id first
  let found = null
  for (const v of variants) {
    let q = supabase.from('whatsapp_chats').select('id,unread_count').eq('remote_jid', v)
    if (sessionId) q = q.eq('session_id', sessionId)
    const { data } = await q.limit(1)
    if (data?.length) { found = data[0]; break }
  }
  if (found) return found
  // If not found in current session, try across all sessions for the company
  if (companyId && sessionId) {
    const { data: sList } = await supabase.from('whatsapp_sessions').select('id').eq('company_id', companyId)
    const otherSids = (sList || []).map(s => s.id).filter(id => id !== sessionId)
    if (otherSids.length) {
      for (const v of variants) {
        let q = supabase.from('whatsapp_chats').select('id,unread_count').eq('remote_jid', v).in('session_id', otherSids)
        const { data } = await q.limit(1)
        if (data?.length) return data[0]
      }
    }
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

async function cleanupSessionData(sid) {
  try {
    const { data: chats } = await supabase.from('whatsapp_chats').select('id,remote_jid').eq('session_id', sid)
    const chatIds = (chats || []).map(c => c.id)
    const phones = new Set()
    if (chats) for (const ch of chats) {
      const np = normalizePhone(ch.remote_jid?.split('@')[0] || '')
      if (np) phones.add(np)
    }
    if (chatIds.length) await supabase.from('whatsapp_messages').delete().in('chat_id', chatIds)
    await supabase.from('whatsapp_chats').delete().eq('session_id', sid)
    if (phones.size) {
      const { data: remaining } = await supabase.from('whatsapp_chats').select('remote_jid').neq('session_id', sid)
      const stillActive = new Set()
      if (remaining) for (const ch of remaining) {
        const np = normalizePhone(ch.remote_jid?.split('@')[0] || '')
        if (np) stillActive.add(np)
      }
      for (const np of phones) {
        if (!stillActive.has(np)) {
          await supabase.from('contacts').delete().eq('phone', np).eq('source', 'whatsapp')
        }
      }
    }
  } catch (e) {}
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

  const entry = { sock: null, authDir, qrCode: null, outgoingInterval: null, outgoingRunning: false, reconnectTimeout: null, phone: null, status: 'connecting', userId, companyId, labels: {}, chatLabels: {}, syncingHistory: false, syncProgress: '', lastSentText: '', dailyLimit: DAILY_LIMIT_DEFAULT }
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

  function getDailyCount() {
    const today = new Date().toISOString().slice(0, 10)
    if (!dailySent[companyId] || dailySent[companyId].date !== today) {
      dailySent[companyId] = { date: today, count: 0 }
    }
    return dailySent[companyId].count
  }

  function getDailyLimit() { return entry.dailyLimit || DAILY_LIMIT_DEFAULT }

  async function pumpOne() {
    if (!entry.sock || entry.outgoingRunning) return
    entry.outgoingRunning = true
    try {
      // Check daily limit
      if (getDailyCount() >= getDailyLimit()) { entry.outgoingRunning = false; return }
      const { data: pending } = await supabase.from('whatsapp_messages').select('id,chat_id,text,media_url,message_type').eq('session_id', sessionId).eq('direction', 'sent').gte('created_at', new Date(Date.now() - 600000).toISOString()).order('created_at', { ascending: true }).limit(1)
      if (!pending?.length) { entry.outgoingRunning = false; return }
      const msg = pending[0]
      try {
        const { data: chats } = await supabase.from('whatsapp_chats').select('remote_jid').eq('id', msg.chat_id).limit(1)
        const jid = chats?.[0]?.remote_jid; if (!jid) { await supabase.from('whatsapp_messages').update({ direction: 'failed' }).eq('id', msg.id); entry.outgoingRunning = false; return }
        // Skip if text is same as last sent (anti-ban)
        if (msg.text && msg.text === entry.lastSentText) { await supabase.from('whatsapp_messages').update({ direction: 'outgoing' }).eq('id', msg.id); entry.outgoingRunning = false; return }
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
        entry.lastSentText = msg.text || ''
        dailySent[companyId].count++
      } catch (e) {
        if (e.message?.includes('Connection closed')) { entry.sock = null; clearInterval(entry.outgoingInterval); entry.outgoingInterval = null; entry.outgoingRunning = false; return }
        await supabase.from('whatsapp_messages').update({ direction: 'failed' }).eq('id', msg.id)
      }
    } catch (e) {}
    entry.outgoingRunning = false
    // Schedule next with random delay 8-20s
    if (entry.outgoingInterval) {
      const delay = 8000 + Math.random() * 12000
      entry.outgoingInterval = setTimeout(pumpOne, delay)
    }
  }

  function startOutgoingPump() {
    if (entry.outgoingInterval) clearTimeout(entry.outgoingInterval)
    entry.outgoingInterval = setTimeout(pumpOne, 3000)
  }
  function stopOutgoingPump() { if (entry.outgoingInterval) { clearTimeout(entry.outgoingInterval); entry.outgoingInterval = null } }

  sock.ev.on('connection.update', async ({ qr, connection, lastDisconnect }) => {
    if (qr) {
      entry.qrCode = await QRCode.toDataURL(qr)
      await supabase.from('whatsapp_sessions').update({ qr_code: entry.qrCode, status: 'connecting' }).eq('id', sessionId)
    }
    if (connection && entry.qrCode) { entry.qrCode = null; await supabase.from('whatsapp_sessions').update({ qr_code: null }).eq('id', sessionId) }
    if (connection === 'open') {
      entry.status = 'connected'; entry.phone = (sock.user?.id || '').split(':')[0] || ''
      // Disconnect any other sessions with the same phone number
      if (entry.phone) {
        for (const [otherId, otherEntry] of sessions) {
          if (otherId !== sessionId && otherEntry.phone === entry.phone && otherEntry.status === 'connected') {
            otherEntry.status = 'disconnected'; otherEntry.sock = null; stopOutgoingPump.call(otherEntry)
            if (otherEntry.outgoingInterval) { clearTimeout(otherEntry.outgoingInterval); otherEntry.outgoingInterval = null }
            supabase.from('whatsapp_sessions').update({ status: 'disconnected' }).eq('id', otherId).then(function(){}).catch(function(){})
            sessions.delete(otherId)
          }
        }
      }
      startOutgoingPump()
      await supabase.from('whatsapp_sessions').update({ status: 'connected', phone: entry.phone, qr_code: null }).eq('id', sessionId)
      setTimeout(() => syncContacts(sessionId, companyId), 5000)
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode; const reconnect = code !== DisconnectReason.loggedOut
      entry.status = reconnect ? 'connecting' : 'disconnected'; entry.qrCode = null; entry.sock = null; stopOutgoingPump()
      if (!reconnect) cleanupSessionData(sessionId)
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
        if (exC) { cid = exC.id } else { const p = { name: cn, phone: normalizePhone(phone), source: 'whatsapp', stage: 'novo', score: 0 }; if (companyId) p.company_id = companyId; const uEntry = sessions.get(sessionId); if (uEntry?.userId) p.notes = JSON.stringify({created_by: uEntry.userId}); const r = await supabase.from('contacts').insert(p).select().single(); if (r.data) cid = r.data.id }
        const exChat = await findChat(jid, sessionId, companyId)
        if (!exChat) { const cp = { remote_jid: jid, contact_id: cid, contact_name: cn, last_message_at: chat.conversationTimestamp ? new Date(chat.conversationTimestamp * 1000).toISOString() : null, session_id: sessionId }; if (companyId) cp.company_id = companyId; await supabase.from('whatsapp_chats').insert(cp) }
      }
    }
    if (messages) {
      // Build dedup set: chat_id → Set of recent message texts (first 100 chars)
      const dedup = {}
      for (let i = 0; i < messages.length; i += 100) {
        entry.syncProgress = `Baixando mensagens ${Math.min(i + 100, messages.length)}/${messages.length}...`
        const inserts = []
        for (const msg of messages.slice(i, i + 100)) {
          const jid = msg.key?.remoteJid; if (!jid || jid.includes('@g.us') || jid.includes('@broadcast') || jid.includes('@newsletter')) continue
          const phone = jid.split('@')[0]; if (normalizePhone(phone).length >= 14) continue
          const ec = await findChat(jid, sessionId, companyId); if (!ec) continue
          const txt = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || ''
          if (!txt) continue
          const tKey = txt.substring(0, 100)
          if (!dedup[ec.id]) dedup[ec.id] = new Set()
          if (dedup[ec.id].has(tKey)) continue
          dedup[ec.id].add(tKey)
          inserts.push({ chat_id: ec.id, session_id: sessionId, text: txt.substring(0, 500), direction: msg.key.fromMe ? 'outgoing' : 'received', created_at: msg.messageTimestamp ? new Date(msg.messageTimestamp * 1000).toISOString() : new Date().toISOString() })
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
    // Get all sessions for this company to update chat names everywhere
    const { data: sessList } = await supabase.from('whatsapp_sessions').select('id').eq('company_id', companyId)
    const allSids = [sessionId, ...(sessList || []).map(s => s.id).filter(id => id !== sessionId)]
    for (const c of contacts) {
      const jid = c.id; if (!jid || jid.includes('@g.us') || jid.includes('@broadcast') || jid === 'status@broadcast') continue
      if (!c.name && !c.notify) continue; const phone = jid.split('@')[0]
      if (normalizePhone(phone).length >= 14) continue
      const name = typeof c.name === 'string' ? c.name : (typeof c.notify === 'string' ? c.notify : phone)
      if (!name || /^\d+$/.test(name)) continue
      const ex = await findContactByNameOrPhone(phone, name, companyId)
      if (ex) {
        const existingIsNum = /^\d+$/.test(ex.name.replace(/\D/g, ''))
        if (existingIsNum && ex.name !== name) {
          await supabase.from('contacts').update({ name, phone: normalizePhone(phone) }).eq('id', ex.id)
          // Update chat name in ALL sessions for this company
          const np = normalizePhone(phone)
          const { data: chats } = await supabase.from('whatsapp_chats').select('id').in('session_id', allSids)
          if (chats) for (const ch of chats) {
            if (normalizePhone(ch.remote_jid?.split('@')[0] || '') === np) {
              await supabase.from('whatsapp_chats').update({ contact_name: name }).eq('id', ch.id)
            }
          }
        }
      } else {
        const p = { name, phone: normalizePhone(phone), source: 'whatsapp', stage: 'novo', score: 0 }; if (companyId) p.company_id = companyId; const uEntry = sessions.get(sessionId); if (uEntry?.userId) p.notes = JSON.stringify({created_by: uEntry.userId}); await supabase.from('contacts').insert(p)
      }
      // After creating/updating contact, try to link any LID chat with matching name
      const cleanName = name.replace(/[^a-zA-Z0-9À-ÿ ]/g, '').trim().split(/\s+/)[0]
      if (cleanName && cleanName.length > 1) {
        const { data: lidChats } = await supabase.from('whatsapp_chats').select('id,remote_jid,contact_name').like('remote_jid', '%@lid').is('contact_id', null)
        if (lidChats) for (const lc of lidChats) {
          // Get the contact_name from the chat
          if ((lc.contact_name || '').toLowerCase().startsWith(cleanName.toLowerCase())) {
            // Find the contact we just created/updated
            const { data: ct } = await supabase.from('contacts').select('id,name,phone').eq('company_id', companyId).ilike('name', cleanName + '%').limit(1)
            if (ct?.length) {
              await supabase.from('whatsapp_chats').update({ contact_id: ct[0].id, contact_name: ct[0].name }).eq('id', lc.id)
            }
          }
        }
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    msgUpsertCount++
    if (type !== 'notify') {
      if (msgNonNotifyTypes.length < 200) msgNonNotifyTypes += (msgNonNotifyTypes ? ',' : '') + (type || 'undefined')
      return
    }
    msgNotifyCount++
    for (const msg of messages) {
      try {
        if (!msg.message) { msgSkippedNoMsg++; continue }
        const jid = msg.key.remoteJid
        if (!jid || jid.includes('@g.us') || jid.includes('@broadcast') || jid.includes('@newsletter')) { msgSkippedGroup++; continue }
        // Extract text from nested message formats (ephemeral, viewOnce, edits)
        let m = msg.message
        if (m.ephemeralMessage?.message) m = m.ephemeralMessage.message
        if (m.viewOnceMessage?.message) m = m.viewOnceMessage.message
        if (m.editMessage?.message) m = m.editMessage.message
        if (m.protocolMessage) { msgSkippedNoMsg++; continue }
        const mp = jid.split('@')[0]; const np = normalizePhone(mp)
        let mediaUrl = null, mType = 'text'
        if (m.audioMessage) { mType = 'audio'; try { const buf = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }) }); if (buf) { const fn = sessionId + '_' + msg.key.id + '.ogg'; fs.writeFileSync(path.join(MEDIA_DIR, fn), buf); mediaUrl = '/media/' + fn } } catch (e) {} }
        if (m.imageMessage) { mType = 'image'; try { const buf = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }) }); if (buf) { const fn = sessionId + '_' + msg.key.id + '.jpg'; fs.writeFileSync(path.join(MEDIA_DIR, fn), buf); mediaUrl = '/media/' + fn } } catch (e) {} }
        const txt = mType === 'audio' ? 'Audio' : mType === 'image' ? 'Foto' : m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || ''
        if (!txt && !mediaUrl) { msgSkippedNoText++; const msgKeys = Object.keys(m); if (msgTypesSeen.length < 500) msgTypesSeen += (msgTypesSeen ? ',' : '') + msgKeys.join('|'); if (msgJidsReceived.length < 500) msgJidsReceived += (msgJidsReceived ? ',' : '') + jid; continue }
        const phone = jid.split('@')[0]
        const isMe = msg.key.fromMe
        // If message was SENT by the user (fromMe), don't create contacts
        if (isMe) {
          const exCh = await findChat(jid, sessionId, companyId)
          if (exCh) {
            const txtShort = txt.substring(0, 200)
            await supabase.from('whatsapp_chats').update({ remote_jid: jid, last_message: { text: txtShort, at: new Date().toISOString() }, last_message_at: new Date().toISOString(), contact_name: exCh.contact_name || dn }).eq('id', exCh.id)
            const { data: dup } = await supabase.from('whatsapp_messages').select('id').eq('chat_id', exCh.id).eq('text', txt.substring(0, 100)).gte('created_at', new Date(Date.now() - 600000).toISOString()).limit(1)
            if (!dup?.length) {
              await supabase.from('whatsapp_messages').insert({ chat_id: exCh.id, session_id: sessionId, text: txt, direction: 'outgoing', created_at: new Date(msg.messageTimestamp ? msg.messageTimestamp * 1000 : Date.now()).toISOString() })
              trimMessages(exCh.id); msgProcessed++
            }
          }
          continue
        }
        // Only for incoming messages: find or create contact
        const pn = msg.pushName || phone; const labelN = ['minha posse','meu imovel','casa','apartamento','reserva','trabalho']
        const clean = pn.toLowerCase().trim(); let dn = (clean.length < 3 || labelN.includes(clean)) ? phone : pn
        if (/^\d+$/.test(dn.replace(/\D/g, ''))) { var raw = dn.replace(/^55/, ''); var fmt = raw.replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3'); if (fmt !== raw) dn = fmt }
        let contactId = null; const exC = await findContactByPhone(phone, companyId)
        // Handle LID: try to link to existing contact by pushName instead of creating new
        if (jid.includes('@lid') && msg.pushName && !exC) {
          const cleanName = msg.pushName.replace(/[^a-zA-Z0-9À-ÿ ]/g, '').trim().substring(0, 30)
          const { data: lidMatch } = await supabase.from('contacts').select('id,name,phone').eq('company_id', companyId).ilike('name', cleanName + '%').limit(1)
          if (lidMatch?.length) {
            contactId = lidMatch[0].id  // REUSE existing contact
          }
        }
        if (exC) { contactId = exC.id; await supabase.from('contacts').update({ last_contacted_at: new Date().toISOString() }).eq('id', contactId) }
        else if (!contactId) {
          const p = { name: dn, phone: normalizePhone(phone), source: 'whatsapp', stage: 'novo', score: 0, last_contacted_at: new Date().toISOString() }; if (companyId) p.company_id = companyId; const uEntry = sessions.get(sessionId); if (uEntry?.userId) p.notes = JSON.stringify({created_by: uEntry.userId}); const r = await supabase.from('contacts').insert(p).select().single(); if (r.data) contactId = r.data.id
        }
        let chatId = null; const exCh = await findChat(jid, sessionId, companyId)
        if (exCh) {
          chatId = exCh.id; await supabase.from('whatsapp_chats').update({ remote_jid: jid, last_message: { text: txt.substring(0, 200), at: new Date().toISOString() }, last_message_at: new Date().toISOString(), unread_count: isMe ? (exCh.unread_count || 0) : (exCh.unread_count || 0) + 1, contact_name: dn }).eq('id', chatId)
        } else {
          const p = { remote_jid: jid, contact_id: contactId, contact_name: dn, last_message: { text: txt.substring(0, 200), at: new Date().toISOString() }, last_message_at: new Date().toISOString(), unread_count: isMe ? 0 : 1, session_id: sessionId }; if (companyId) p.company_id = companyId
          const r = await supabase.from('whatsapp_chats').insert(p).select().single(); if (r.data) chatId = r.data.id
        }
        if (chatId) {
          const { data: dup } = await supabase.from('whatsapp_messages').select('id').eq('chat_id', chatId).eq('text', txt.substring(0, 100)).gte('created_at', new Date(Date.now() - 600000).toISOString()).limit(1)
          if (!dup?.length) {
            const dir = isMe ? 'outgoing' : 'received'
            const mp2 = { chat_id: chatId, session_id: sessionId, text: txt, direction: dir, created_at: new Date(msg.messageTimestamp ? msg.messageTimestamp * 1000 : Date.now()).toISOString() }
            if (mediaUrl) { mp2.media_url = mediaUrl; mp2.message_type = mType }
            await supabase.from('whatsapp_messages').insert(mp2); trimMessages(chatId)
            msgProcessed++
          }
        }
      } catch (e) { if (msgErrors.length < 500) msgErrors += (msgErrors ? ';' : '') + (e.message || '').substring(0, 80); logger.error({ sessionId, error: e.message }, 'Msg error') }
    }
  })
}

async function syncContacts(sessionId, companyId) {
  const entry = sessions.get(sessionId)
  // Retry with backoff up to 5 min if store not ready
  if (!entry?.sock?.store?.contacts) {
    if (!entry?._syncRetries) entry._syncRetries = 0
    entry._syncRetries++
    if (entry._syncRetries < 30) { setTimeout(() => syncContacts(sessionId, companyId), 10000); return }
    return
  }
  entry._syncRetries = 0
  try {
    // Get all chats for this company to update names efficiently
    const { data: sessionsList } = await supabase.from('whatsapp_sessions').select('id').eq('company_id', companyId)
    const allSids = [sessionId, ...(sessionsList || []).map(s => s.id).filter(id => id !== sessionId)]
    const { data: allChats } = await supabase.from('whatsapp_chats').select('id,remote_jid,contact_name').in('session_id', allSids)
    const chatByNp = {}
    if (allChats) for (const ch of allChats) {
      const np = normalizePhone(ch.remote_jid?.split('@')[0] || '')
      if (np) chatByNp[np] = ch
    }
    for (const [jid, contact] of Object.entries(entry.sock.store.contacts)) {
      if (jid.includes('@g.us') || jid.includes('@broadcast') || jid.includes('@newsletter') || jid === 'status@broadcast') continue
      if (!contact.name && !contact.notify && !contact.verifiedName) continue
      const phone = jid.split('@')[0]; if (normalizePhone(phone).length >= 14) continue
      const name = contact.name || contact.notify || contact.verifiedName || phone
      if (!name || /^\d+$/.test(name)) continue
      const ex = await findContactByNameOrPhone(phone, name, companyId)
      if (ex) {
        // Only overwrite if existing name is a phone number (not a real name)
        const existingIsNum = /^\d+$/.test(ex.name.replace(/\D/g, ''))
        if (existingIsNum && ex.name !== name) {
          await supabase.from('contacts').update({ name, phone: normalizePhone(phone) }).eq('id', ex.id)
          // Update chat name in ANY session for this company
          const np = normalizePhone(phone)
          if (chatByNp[np] && chatByNp[np].contact_name !== name) {
            await supabase.from('whatsapp_chats').update({ contact_name: name }).eq('id', chatByNp[np].id)
          }
        }
      } else {
        const p = { name, phone: normalizePhone(phone), source: 'whatsapp', stage: 'novo', score: 0 }
        if (companyId) p.company_id = companyId
        const uEntry = sessions.get(sessionId); if (uEntry?.userId) p.notes = JSON.stringify({created_by: uEntry.userId})
        await supabase.from('contacts').insert(p)
        // Also update chat name if it exists
        if (chatByNp[normalizePhone(phone)]) {
          await supabase.from('whatsapp_chats').update({ contact_name: name }).eq('id', chatByNp[normalizePhone(phone)].id)
        }
      }
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
      else if (s.status === 'disconnected' && sessions.has(s.id)) { const e = sessions.get(s.id); if (e.sock) try { e.sock.logout() } catch {}; e.sock = null; if (e.reconnectTimeout) clearTimeout(e.reconnectTimeout); cleanupSessionData(s.id); try { fs.rmSync(e.authDir, { recursive: true, force: true }) } catch {}; sessions.delete(s.id) }
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
      let q = supabase.from('whatsapp_sessions').select('id,status,phone,user_id,company_id').eq('company_id', cid)
      if (uid) q = q.eq('user_id', uid)
      const { data: dbs } = await q
      if (dbs) for (const s of dbs) active.push({ sessionId: s.id, status: s.status === 'connected' ? 'connecting' : s.status, phone: s.phone, userId: s.user_id, companyId: s.company_id })
    }
    res.writeHead(200); res.end(JSON.stringify({ sessions: active })); return
  }

  if (pathname === '/qr') { const sid = url.searchParams.get('sessionId'); const e = sid ? sessions.get(sid) : null; res.writeHead(200); res.end(JSON.stringify({ qr_code: e?.qrCode || null })); return }
  if (pathname === '/sync-status') { const sid = url.searchParams.get('sessionId'); const e = sid ? sessions.get(sid) : null; res.writeHead(200); res.end(JSON.stringify({ syncing: e?.syncingHistory || false, progress: e?.syncProgress || '' })); return }
  if (pathname === '/pump-status') { const sid = url.searchParams.get('sessionId'); const e = sid ? sessions.get(sid) : null; const pump = !!e?.outgoingInterval; let p = []; if (sid) { const r = await supabase.from('whatsapp_messages').select('id,chat_id,text,direction,created_at').eq('session_id', sid).eq('direction', 'sent').gte('created_at', new Date(Date.now() - 120000).toISOString()).limit(10); p = r.data || [] }; const cid = e?.companyId; const dc = dailySent[cid] || { date: 'none', count: 0 }; res.writeHead(200); res.end(JSON.stringify({ pumpRunning: pump, pendingCount: p.length, pending: p, hasSocket: !!e?.sock, sessionStatus: e?.status, dailySent: dc.count, dailyLimit: e?.dailyLimit || DAILY_LIMIT_DEFAULT, dailyDate: dc.date, lastSentText: e?.lastSentText || '' })); return }
  if (pathname === '/sync-contacts-now') { const sid = url.searchParams.get('sessionId'); if (!sid || !sessions.get(sid)) { res.writeHead(400); res.end(JSON.stringify({ error: 'sessionId required or invalid' })); return }; const e = sessions.get(sid); if (e) e._syncRetries = 0; syncContacts(sid, e?.companyId); res.writeHead(200); res.end(JSON.stringify({ ok: true })); return }
  if (pathname === '/set-daily-limit') { const sid = url.searchParams.get('sessionId'); const limit = parseInt(url.searchParams.get('limit')) || DAILY_LIMIT_DEFAULT; const e = sid ? sessions.get(sid) : null; if (e) e.dailyLimit = limit; res.writeHead(200); res.end(JSON.stringify({ ok: true, dailyLimit: limit })); return }

  if (pathname === '/company-desc-status' && req.method === 'GET') {
    const companyId = url.searchParams.get('companyId')
    if (!companyId) { res.writeHead(400); res.end(JSON.stringify({ error: 'companyId required' })); return }
    const { data: company } = await supabase.from('companies').select('permissions').eq('id', companyId).limit(1)
    const perms = company?.[0]?.permissions || {}
    const completed = !!(perms.description_completed || perms.description_skipped)
    res.writeHead(200); res.end(JSON.stringify({ completed, descriptionSector: perms.description_sector || '', description: perms.description || '' })); return
  }

  if (pathname === '/company-desc-status' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', async () => {
      try {
        const { companyId, action, sector, description } = JSON.parse(body)
        if (!companyId || !action) { res.writeHead(400); res.end(JSON.stringify({ error: 'companyId and action required' })); return }
        const { data: company } = await supabase.from('companies').select('permissions').eq('id', companyId).limit(1)
        const perms = company?.[0]?.permissions || {}
        if (action === 'save') {
          perms.description_completed = true
          if (sector !== undefined) perms.description_sector = sector
          if (description !== undefined) perms.description = description
        } else if (action === 'skip') {
          perms.description_skipped = true
        }
        await supabase.from('companies').update({ permissions: perms }).eq('id', companyId)
        res.writeHead(200); res.end(JSON.stringify({ ok: true }))
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })) }
    })
    return
  }

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
    await cleanupSessionData(sid)
    await supabase.from('whatsapp_sessions').update({ status: 'disconnected' }).eq('id', sid)
    const e = sessions.get(sid); if (e) { if (e.sock) try { e.sock.logout() } catch {}; e.sock = null; sessions.delete(sid) }
    res.writeHead(200); res.end(JSON.stringify({ ok: true })); return
  }

  if (pathname === '/msg-stats') {
    res.writeHead(200); res.end(JSON.stringify({ msgUpsertCount, msgNotifyCount, msgNonNotifyTypes: msgNonNotifyTypes.slice(0,200), msgSkippedNoMsg, msgSkippedGroup, msgSkippedNoText, msgProcessed, msgTypesSeen: msgTypesSeen.slice(0,500), msgJidsReceived: msgJidsReceived.slice(0,500), msgErrors: msgErrors.slice(0,500) })); return
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
    // Check if session is connected (check DB as fallback for sessions not in memory)
    let entry = sessions.get(sid)
    if (!entry || entry.status !== 'connected') {
      const { data: dbEntry } = await supabase.from('whatsapp_sessions').select('status,company_id').eq('id', sid).limit(1)
      if (!dbEntry?.length || dbEntry[0].status !== 'connected') { res.writeHead(200); res.end(JSON.stringify({ chats: [] })); return }
    }
    const cid = entry?.companyId || (await getCompanyId(sid))
    // Get all sessions for this company (including past disconnected)
    const { data: companySessions } = await supabase.from('whatsapp_sessions').select('id').eq('company_id', cid)
    const sessionIds = [sid, ...(companySessions || []).map(function(s){ return s.id }).filter(function(id){ return id !== sid })]
    const { data: wa } = await supabase.from('whatsapp_chats').select('*').in('session_id', sessionIds).order('last_message_at', { ascending: false, nullsLast: true })
    let q = supabase.from('contacts').select('id,name,phone,stage,tags,source')
    if (cid) q = q.eq('company_id', cid)
    const { data: cont } = await q
    const byPhone = {}; const conByPhone = {}
    if (cont) for (const c of cont) { const np = normalizePhone(c.phone || ''); byPhone[np] = c.name || np; conByPhone[np] = c }
    const seen = {}; const result = []
    // Get session phone to filter out own LID
    const sessEntry = sessions.get(sid)
    const sessPhoneNormalized = normalizePhone(sessEntry?.phone || '')
    if (wa) { for (const ch of wa) { const jid = ch.remote_jid || ''; if (jid.includes('@g.us') || jid.includes('@broadcast') || jid.includes('@newsletter') || jid === 'status@broadcast') continue; const np = normalizePhone(jid.split('@')[0] || ''); if (!np || np.length >= 20 || seen[np] || (sessPhoneNormalized && np === sessPhoneNormalized)) continue; seen[np] = true; const ct = conByPhone[np]; result.push({ id: ch.id, remote_jid: ch.remote_jid, contact_id: ch.contact_id, contact_name: ct?.name || ch.contact_name, last_message: ch.last_message, last_message_at: ch.last_message_at, unread_count: ch.unread_count || 0, contact_phone: ct?.phone || np, contact_stage: ct?.stage || null, contact_tags: ct?.tags || null, session_id: sid }) } }
    if (cont) { for (const c of cont) { const np = normalizePhone(c.phone || ''); if (!np || np.length >= 20 || seen[np] || (sessPhoneNormalized && np === sessPhoneNormalized)) continue; seen[np] = true; if (c.source !== 'whatsapp' && !c.name) continue; result.push({ id: 'contact_' + c.id, remote_jid: np, contact_id: c.id, contact_name: c.name || np, last_message: null, last_message_at: null, unread_count: 0, contact_phone: c.phone || np, contact_stage: c.stage || null, contact_tags: c.tags || null, session_id: sid }) } }
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
    const sid = url.searchParams.get('sessionId'); const companyId = url.searchParams.get('companyId') || (sid ? await getCompanyId(sid) : null)
    // If no session or session is disconnected, return only non-whatsapp contacts
    if (!sid || !sessions.get(sid) || sessions.get(sid)?.status !== 'connected') {
      let q = supabase.from('contacts').select('id,name,phone,tags').neq('source', 'whatsapp')
      if (companyId) q = q.eq('company_id', companyId)
      const { data: all } = await q
      const filtered = (all || []).filter(c => c.name && c.name !== c.phone && !c.name.startsWith('{') && !c.name.includes('@') && !/^\d+$/.test(c.name.replace(/\D/g, '')))
      const seen = {}; const final = []
      for (const c of filtered) { const np = normalizePhone(c.phone); if (np && !seen[np]) { seen[np] = true; final.push({ id: c.id, name: c.name, phone: c.phone, tags: c.tags }) } }
      res.writeHead(200); res.end(JSON.stringify({ contacts: final })); return
    }
    const { data: chats } = await supabase.from('whatsapp_chats').select('remote_jid').eq('session_id', sid)
    const chatPhones = new Set()
    if (chats) for (const ch of chats) {
      const np = normalizePhone(ch.remote_jid?.split('@')[0] || '')
      if (np) chatPhones.add(np)
    }
    let q = supabase.from('contacts').select('id,name,phone,tags')
    if (companyId) q = q.eq('company_id', companyId)
    const { data: all } = await q
    const filtered = (all || []).filter(c => {
      const np = normalizePhone(c.phone || '')
      if (c.source === 'whatsapp' && np && !chatPhones.has(np)) return false
      return c.name && c.name !== c.phone && !c.name.startsWith('{') && !c.name.includes('@') && !/^\d+$/.test(c.name.replace(/\D/g, ''))
    })
    const seen = {}; const final = []
    for (const c of filtered) { const np = normalizePhone(c.phone); if (np && !seen[np]) { seen[np] = true; final.push({ id: c.id, name: c.name, phone: c.phone, tags: c.tags }) } }
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

  if (pathname === '/deduplicate-messages') {
    const sid = url.searchParams.get('sessionId')
    const companyId = sid ? await getCompanyId(sid) : null
    const { data: allC } = await supabase.from('whatsapp_chats').select('id,remote_jid')
    const chatIds = companyId && allC ? allC.filter(function(c){return c.remote_jid}).map(function(c){return c.id}) : (allC||[]).map(function(c){return c.id})
    let removed = 0
    for (const cid of chatIds) {
      const { data: msgs } = await supabase.from('whatsapp_messages').select('id,text,created_at').eq('chat_id', cid).order('created_at', { ascending: false })
      if (!msgs?.length) continue
      const seen = {}
      for (const m of msgs) {
        const key = (m.text || '').substring(0, 100)
        if (seen[key]) { await supabase.from('whatsapp_messages').delete().eq('id', m.id); removed++ }
        else seen[key] = true
      }
    }
    res.writeHead(200); res.end(JSON.stringify({ ok: true, removed })); return
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

  if (pathname === '/reset-whatsapp-data') {
    const sid = url.searchParams.get('sessionId')
    if (!sid) { res.writeHead(400); res.end(JSON.stringify({ error: 'sessionId required' })); return }
    // Disconnect socket
    const entry = sessions.get(sid)
    if (entry) {
      if (entry.sock) try { entry.sock.logout() } catch (e) {}
      if (entry.outgoingInterval) clearInterval(entry.outgoingInterval)
      if (entry.reconnectTimeout) clearTimeout(entry.reconnectTimeout)
      sessions.delete(sid)
    }
    // Clear auth directory
    const authDir = path.join(AUTH_BASE, sid)
    try { fs.rmSync(authDir, { recursive: true, force: true }) } catch (e) {}
    // Delete WhatsApp messages
    try { await supabase.from('whatsapp_messages').delete().neq('id', '00000000-0000-0000-0000-000000000000') } catch (e) {}
    // Delete WhatsApp chats
    try { await supabase.from('whatsapp_chats').delete().neq('id', '00000000-0000-0000-0000-000000000000') } catch (e) {}
    // Delete WhatsApp-sourced contacts
    try {
      const { data: waContacts } = await supabase.from('contacts').select('id').eq('source', 'whatsapp')
      const waIds = (waContacts || []).map(function(c){ return c.id })
      if (waIds.length) await supabase.from('contacts').delete().in('id', waIds)
    } catch (e) {}
    // Update session status
    try { await supabase.from('whatsapp_sessions').update({ status: 'disconnected', auth_creds: null }).eq('id', sid) } catch (e) {}
    res.writeHead(200); res.end(JSON.stringify({ ok: true })); return
  }

  if (pathname === '/test-jid' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', async () => {
      try {
        const { chatId, newJid, sessionId } = JSON.parse(body)
        if (!chatId || !newJid || !sessionId) { res.writeHead(400); res.end(JSON.stringify({ error: 'chatId, newJid, sessionId required' })); return }
        await supabase.from('whatsapp_chats').update({ remote_jid: newJid }).eq('id', chatId).eq('session_id', sessionId)
        // Try sending directly
        const entry = sessions.get(sessionId)
        var sendResult = 'not_attempted'
        if (entry?.sock) {
          try {
            await entry.sock.sendMessage(newJid, { text: 'teste jid ' + newJid })
            sendResult = 'ok'
          } catch (e) { sendResult = 'error: ' + e.message }
        }
        res.writeHead(200); res.end(JSON.stringify({ ok: true, sendResult }))
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })) }
    })
    return
  }

  if (pathname === '/diagnose') {
    const sid = url.searchParams.get('sessionId')
    if (!sid) { res.writeHead(400); res.end(JSON.stringify({ error: 'sessionId required' })); return }
    const entry = sessions.get(sid)
    // Check pump
    const pumpOk = !!entry?.outgoingInterval
    const sockOk = !!entry?.sock
    const statusOk = entry?.status === 'connected'
    // Check recent messages
    const { data: recentSent } = await supabase.from('whatsapp_messages').select('id,chat_id,direction,created_at').eq('session_id', sid).eq('direction', 'sent').gte('created_at', new Date(Date.now() - 600000).toISOString()).order('created_at', { ascending: false }).limit(5)
    const { data: recentOut } = await supabase.from('whatsapp_messages').select('id,chat_id,direction,created_at').eq('session_id', sid).eq('direction', 'outgoing').gte('created_at', new Date(Date.now() - 600000).toISOString()).order('created_at', { ascending: false }).limit(5)
    const { data: recentFail } = await supabase.from('whatsapp_messages').select('id,chat_id,direction,created_at').eq('session_id', sid).eq('direction', 'failed').gte('created_at', new Date(Date.now() - 600000).toISOString()).order('created_at', { ascending: false }).limit(5)
    // Check a sent message's chat JID
    var sampleJid = null, sampleJidOk = false
    if (recentOut?.length) {
      const { data: chat } = await supabase.from('whatsapp_chats').select('remote_jid').eq('id', recentOut[0].chat_id).limit(1)
      if (chat?.length) {
        sampleJid = chat[0].remote_jid
        const phone = sampleJid?.split('@')[0] || ''
        const np = normalizePhone(phone)
        sampleJidOk = np.length >= 11 && np.length <= 13
      }
    }
    res.writeHead(200); res.end(JSON.stringify({
      session: { id: sid, status: statusOk, hasSocket: sockOk, pumpRunning: pumpOk, phone: entry?.phone },
      messages: { pendingSent: recentSent?.length || 0, outgoing: recentOut?.length || 0, failed: recentFail?.length || 0 },
      sample: { lastOutgoingJid: sampleJid, jidValid: sampleJidOk },
      issues: [
        !statusOk ? 'Session not connected' : null,
        !sockOk ? 'No Baileys socket' : null,
        !pumpOk ? 'Pump not running' : null,
        recentSent?.length > 0 ? recentSent.length + ' messages stuck as sent' : null,
        sampleJid && !sampleJidOk ? 'JID format invalid: ' + sampleJid : null,
      ].filter(Boolean)
    })); return
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
            const companyId = await getCompanyId(d.sessionId)
            // Check if chat already exists for this JID across all sessions
            const existing = await findChat(jid, d.sessionId, companyId)
            if (existing) {
              chatId = existing.id
            } else {
              const { data: nc } = await supabase.from('whatsapp_chats').insert({ remote_jid: jid, contact_id: contactId, contact_name: ct[0].name, session_id: d.sessionId }).select().single()
              if (nc) chatId = nc.id
            }
          }
        } else if (chatId.includes('@')) {
          // JID format - find or create chat entry
          const ec = await findChat(chatId, d.sessionId)
          if (ec) { chatId = ec.id } else {
            const phone = chatId.split('@')[0]
            const { data: nc } = await supabase.from('whatsapp_chats').insert({ remote_jid: chatId, contact_name: phone, session_id: d.sessionId }).select().single()
            if (nc) chatId = nc.id
          }
        }
        const insertData = { chat_id: chatId, session_id: d.sessionId, text: d.text.substring(0, 500), direction: 'sent', created_at: new Date().toISOString() }
        if (d.mediaUrl) { insertData.media_url = d.mediaUrl; insertData.message_type = d.messageType || 'image' }
        const { data: inserted } = await supabase.from('whatsapp_messages').insert(insertData).select()
        trimMessages(chatId)
        // Direct send via Baileys socket (marks as outgoing so pump doesn't also send)
        const sendEntry = sessions.get(d.sessionId)
        if (sendEntry?.sock && inserted?.[0]?.id) {
          try {
            const { data: chatRow } = await supabase.from('whatsapp_chats').select('remote_jid').eq('id', chatId).limit(1)
            if (chatRow?.length) {
              await sendEntry.sock.sendMessage(chatRow[0].remote_jid, { text: d.text.substring(0, 500) })
              await supabase.from('whatsapp_messages').update({ direction: 'outgoing' }).eq('id', inserted[0].id)
              await supabase.from('whatsapp_chats').update({ last_message: { text: d.text.substring(0, 200), at: new Date().toISOString() }, last_message_at: new Date().toISOString() }).eq('id', chatId)
            }
          } catch (e) {
            // Leave as 'sent' for pump to retry
          }
        }
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

  if (pathname === '/debug') {
    const { data: mData } = await supabase.from('whatsapp_messages').select('id').limit(50000)
    const { data: cData } = await supabase.from('whatsapp_chats').select('id').limit(50000)
    res.writeHead(200); res.end(JSON.stringify({ chats: cData?.length || 0, messages: mData?.length || 0 })); return
  }

  if (pathname === '/check-msgs') {
    const sid = url.searchParams.get('sessionId')
    if (!sid) { res.writeHead(400); res.end(JSON.stringify({ error: 'sessionId required' })); return }
    const entry = sessions.get(sid)
    const { data: recent } = await supabase.from('whatsapp_messages').select('id,chat_id,direction,created_at,text').eq('session_id', sid).order('created_at', { ascending: false }).limit(10)
    const { data: sent } = await supabase.from('whatsapp_messages').select('id').eq('session_id', sid).eq('direction', 'sent').gte('created_at', new Date(Date.now() - 300000).toISOString())
    res.writeHead(200); res.end(JSON.stringify({ hasSocket: !!entry?.sock, pumpRunning: !!entry?.outgoingInterval, sessionStatus: entry?.status, recentMessages: recent || [], pendingSentCount: sent?.length || 0 })); return
  }

  if (pathname === '/check-chat') {
    const cid = url.searchParams.get('chatId')
    if (!cid) { res.writeHead(400); res.end(JSON.stringify({ error: 'chatId required' })); return }
    let chat = null, contact = null
    if (cid.startsWith('contact_')) {
      const contactId = cid.replace('contact_', '')
      const { data: c } = await supabase.from('contacts').select('id,name,phone').eq('id', contactId).limit(1)
      if (c?.length) {
        contact = c[0]
        chat = { id: cid, remote_jid: contact.phone, contact_id: contact.id, contact_name: contact.name }
      }
    } else {
      const { data: ch } = await supabase.from('whatsapp_chats').select('id,remote_jid,contact_name,contact_id').eq('id', cid).limit(1)
      if (ch?.length) {
        chat = ch[0]
        if (chat.contact_id) {
          const { data: c } = await supabase.from('contacts').select('name,phone').eq('id', chat.contact_id).limit(1)
          if (c?.length) contact = c[0]
        }
        if (!contact && chat.remote_jid) {
          const np = normalizePhone(chat.remote_jid.split('@')[0] || '')
          const { data: c } = await supabase.from('contacts').select('name,phone').eq('phone', np).limit(1)
          if (c?.length) contact = c[0]
        }
      }
    }
    const session = sessions.get(url.searchParams.get('sid') || '')
    res.writeHead(200); res.end(JSON.stringify({ chat, contact, hasSocket: !!session?.sock, sessionStatus: session?.status })); return
  }

  if (pathname === '/check-lids') {
    const sid = url.searchParams.get('sessionId')
    if (!sid) { res.writeHead(400); res.end(JSON.stringify({ error: 'sessionId required' })); return }
    const { data: wa } = await supabase.from('whatsapp_chats').select('id,remote_jid,contact_id,contact_name').eq('session_id', sid)
    const lids = (wa || []).filter(function(ch) { var np = normalizePhone(ch.remote_jid?.split('@')[0] || ''); return np.length >= 14 })
    const noContact = (wa || []).filter(function(ch) { var np = normalizePhone(ch.remote_jid?.split('@')[0] || ''); return np.length < 14 && !ch.contact_id })
    res.writeHead(200); res.end(JSON.stringify({ total: wa?.length || 0, lids: lids.length, lidsSample: lids.slice(0, 5), noContact: noContact.length, noContactSample: noContact.slice(0, 5) })); return
  }

  if (pathname === '/fix-chat-contacts') {
    const sid = url.searchParams.get('sessionId')
    if (!sid) { res.writeHead(400); res.end(JSON.stringify({ error: 'sessionId required' })); return }
    const companyId = await getCompanyId(sid)
    const { data: chats } = await supabase.from('whatsapp_chats').select('id,remote_jid,contact_id,contact_name,session_id').eq('session_id', sid)
    const { data: contacts } = await supabase.from('contacts').select('id,name,phone').eq('company_id', companyId)
    const contactByNp = {}
    if (contacts) for (const c of contacts) { const np = normalizePhone(c.phone || ''); if (np) contactByNp[np] = c }
    let linked = 0, nameFixed = 0
    if (chats) for (const ch of chats) {
      const np = normalizePhone(ch.remote_jid?.split('@')[0] || '')
      if (!np) continue
      const ct = contactByNp[np]
      if (ct) {
        if (!ch.contact_id || ch.contact_id !== ct.id) {
          await supabase.from('whatsapp_chats').update({ contact_id: ct.id }).eq('id', ch.id)
          linked++
        }
        if (ct.name && ct.name !== ch.contact_name && !/^\d+$/.test(ct.name)) {
          await supabase.from('whatsapp_chats').update({ contact_name: ct.name }).eq('id', ch.id)
          nameFixed++
        }
      } else {
        // Create contact for this chat
        const dn = ch.contact_name || np
        if (!/^\d+$/.test(dn)) {
          const p = { name: dn, phone: np, source: 'whatsapp', stage: 'novo', score: 0, company_id: companyId }
          const r = await supabase.from('contacts').insert(p).select().single()
          if (r.data) {
            await supabase.from('whatsapp_chats').update({ contact_id: r.data.id }).eq('id', ch.id)
            linked++
          }
        }
      }
    }
    res.writeHead(200); res.end(JSON.stringify({ ok: true, linked, nameFixed })); return
  }

  if (pathname === '/fix-lid-chats') {
    const sid = url.searchParams.get('sessionId')
    if (!sid) { res.writeHead(400); res.end(JSON.stringify({ error: 'sessionId required' })); return }
    const companyId = await getCompanyId(sid)
    const { data: lidChats } = await supabase.from('whatsapp_chats').select('id,remote_jid,contact_id,contact_name').like('remote_jid', '%@lid')
    const { data: contacts } = await supabase.from('contacts').select('id,name,phone').eq('company_id', companyId)
    let linked = 0, created = 0
    if (lidChats) for (const ch of lidChats) {
      if (ch.contact_id) continue
      const np = normalizePhone(ch.remote_jid.split('@')[0] || '')
      // Try to find contact by phone first
      let match = null
      if (contacts) match = contacts.find(c => normalizePhone(c.phone || '') === np)
      // Try by name if no phone match
      if (!match && ch.contact_name) {
        const cleanName = ch.contact_name.replace(/[^a-zA-Z0-9À-ÿ ]/g, '').trim().split(/\s+/)[0]
        if (cleanName) {
          const { data: byName } = await supabase.from('contacts').select('id,name,phone').eq('company_id', companyId).ilike('name', cleanName + '%').limit(1)
          if (byName?.length) match = byName[0]
        }
      }
      if (match) {
        await supabase.from('whatsapp_chats').update({ contact_id: match.id, contact_name: match.name }).eq('id', ch.id)
        linked++
      } else if (ch.contact_name && !/^\d+$/.test(ch.contact_name.replace(/\D/g, ''))) {
        // Create contact for this LID
        const p = { name: ch.contact_name, phone: np, source: 'whatsapp', stage: 'novo', score: 0, company_id: companyId }
        const r = await supabase.from('contacts').insert(p).select().single()
        if (r.data) {
          await supabase.from('whatsapp_chats').update({ contact_id: r.data.id }).eq('id', ch.id)
          created++
        }
      }
    }
    res.writeHead(200); res.end(JSON.stringify({ ok: true, linked, created })); return
  }

  if (pathname === '/restore-contact-name' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', async () => {
      try {
        const { sessionId, contactId, name } = JSON.parse(body)
        if (!sessionId || !contactId || !name) { res.writeHead(400); res.end(JSON.stringify({ error: 'sessionId, contactId, name required' })); return }
        const companyId = await getCompanyId(sessionId)
        await supabase.from('contacts').update({ name }).eq('id', contactId).eq('company_id', companyId)
        // Update chat names too
        const { data: chats } = await supabase.from('whatsapp_chats').select('id').eq('contact_id', contactId)
        if (chats) for (const ch of chats) await supabase.from('whatsapp_chats').update({ contact_name: name }).eq('id', ch.id)
        res.writeHead(200); res.end(JSON.stringify({ ok: true })); return
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })) }
    })
    return
  }

  if (pathname === '/sync-names-from-chats' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', async () => {
      try {
        const { sessionId } = JSON.parse(body)
        if (!sessionId) { res.writeHead(400); res.end(JSON.stringify({ error: 'sessionId required' })); return }
        const companyId = await getCompanyId(sessionId)
        const { data: contacts } = await supabase.from('contacts').select('id,name,phone').eq('company_id', companyId)
        const { data: chats } = await supabase.from('whatsapp_chats').select('id,remote_jid,contact_name,contact_id')
        // Build map: contact_id → most authoritative name from phone normalization
        const phoneToName = {}
        if (contacts) for (const c of contacts) { const np = normalizePhone(c.phone || ''); if (np && c.name && !/^\d+$/.test(c.name)) phoneToName[np] = c.name }
        let fixed = 0
        if (chats) for (const ch of chats) {
          if (!ch.contact_id) continue
          const np = normalizePhone(ch.remote_jid?.split('@')[0] || '')
          if (!np || !phoneToName[np]) continue
          const dbName = phoneToName[np]
          if (dbName && dbName !== ch.contact_name) {
            await supabase.from('whatsapp_chats').update({ contact_name: dbName }).eq('id', ch.id)
            await supabase.from('contacts').update({ name: dbName }).eq('id', ch.contact_id)
            fixed++
          }
        }
        res.writeHead(200); res.end(JSON.stringify({ ok: true, fixed })); return
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })) }
    })
    return
  }

  if (pathname === '/fix-lid-mess' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', async () => {
      try {
        const { sessionId } = JSON.parse(body)
        if (!sessionId) { res.writeHead(400); res.end(JSON.stringify({ error: 'sessionId required' })); return }
        const companyId = await getCompanyId(sessionId)
        const entry = sessions.get(sessionId)
        const sessionPhone = entry?.phone || ''
        const { data: lidChats } = await supabase.from('whatsapp_chats').select('id,remote_jid,contact_id,contact_name').like('remote_jid', '%@lid')
        const { data: contacts } = await supabase.from('contacts').select('id,name,phone').eq('company_id', companyId)
        let renamed = 0, linked = 0, deleted = 0
        // Build phone-to-contact map
        const contactByPhone = {}
        if (contacts) for (const c of contacts) { const np = normalizePhone(c.phone || ''); if (np) contactByPhone[np] = c }
        if (lidChats) for (const ch of lidChats) {
          const np = normalizePhone(ch.remote_jid.split('@')[0] || '')
          // Skip if this LID is the user's own phone
          if (sessionPhone && normalizePhone(sessionPhone) === np) {
            await supabase.from('whatsapp_chats').delete().eq('id', ch.id)
            // Also delete the contact if it's a whatsapp-only orphan
            if (ch.contact_id) { const { data: orphan } = await supabase.from('contacts').select('id').eq('id', ch.contact_id).eq('source', 'whatsapp').limit(1); if (orphan?.length) await supabase.from('contacts').delete().eq('id', ch.contact_id) }
            deleted++; continue
          }
          // If chat has no contact_id, try to link
          if (!ch.contact_id) {
            // Find by phone first
            let match = contactByPhone[np]
            // Then by name
            if (!match && ch.contact_name) {
              const cleanName = ch.contact_name.replace(/[^a-zA-Z0-9À-ÿ ]/g, '').trim()
              match = (contacts || []).find(c => c.name.toLowerCase().startsWith(cleanName.substring(0, 15).toLowerCase()))
            }
            if (match) {
              await supabase.from('whatsapp_chats').update({ contact_id: match.id, contact_name: match.name }).eq('id', ch.id)
              linked++
            } else if (ch.contact_name && !/^\d+$/.test(ch.contact_name)) {
              // Create contact for this LID with the chat's name
              const p = { name: ch.contact_name, phone: np, source: 'whatsapp', stage: 'novo', score: 0, company_id: companyId }
              const r = await supabase.from('contacts').insert(p).select().single()
              if (r.data) { await supabase.from('whatsapp_chats').update({ contact_id: r.data.id }).eq('id', ch.id); linked++ }
            }
          } else if (ch.contact_name && /^\d+$/.test(ch.contact_name.replace(/\D/g, ''))) {
            // Chat has contact_id but name is numeric: rename from contact
            const ct = (contacts || []).find(c => c.id === ch.contact_id)
            if (ct && ct.name && !/^\d+$/.test(ct.name)) {
              await supabase.from('whatsapp_chats').update({ contact_name: ct.name }).eq('id', ch.id)
              renamed++
            }
          }
        }
        res.writeHead(200); res.end(JSON.stringify({ ok: true, deleted, linked, renamed })); return
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })) }
    })
    return
  }

  if (pathname === '/fix-name-bug' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', async () => {
      try {
        const { sessionId } = JSON.parse(body)
        if (!sessionId) { res.writeHead(400); res.end(JSON.stringify({ error: 'sessionId required' })); return }
        const companyId = await getCompanyId(sessionId)
        const entry = sessions.get(sessionId)
        const sessionPhone = normalizePhone(entry?.phone || '')
        const { data: contacts } = await supabase.from('contacts').select('id,name,phone').eq('company_id', companyId)
        const { data: chats } = await supabase.from('whatsapp_chats').select('id,remote_jid,contact_id,contact_name')
        // Build phone-to-contact map for lookup
        const contactByPhone = {}
        if (contacts) for (const c of contacts) { const np = normalizePhone(c.phone || ''); if (np) contactByPhone[np] = c }
        let fixed = 0, deleted = 0
        // Detect contacts named like a phone number (overwritten by sync)
        if (contacts) for (const c of contacts) {
          if (/^\d+$/.test(c.name.replace(/\D/g, ''))) {
            // Name is numeric: try to restore from chats
            const np = normalizePhone(c.phone || '')
            const ch = (chats || []).find(ch => ch.remote_jid && normalizePhone(ch.remote_jid.split('@')[0] || '') === np)
            if (ch && ch.contact_name && !/^\d+$/.test(ch.contact_name)) {
              await supabase.from('contacts').update({ name: ch.contact_name }).eq('id', c.id)
              fixed++
            } else if (contactByPhone[np] && contactByPhone[np].id !== c.id && !/^\d+$/.test(contactByPhone[np].name)) {
              // Another contact has the right name for this phone: delete this one
              await supabase.from('contacts').delete().eq('id', c.id)
              deleted++
            }
          }
        }
        res.writeHead(200); res.end(JSON.stringify({ ok: true, fixed, deleted })); return
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })) }
    })
    return
  }

  if (pathname === '/fix-eduardos' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', async () => {
      try {
        const { sessionId } = JSON.parse(body)
        if (!sessionId) { res.writeHead(400); res.end(JSON.stringify({ error: 'sessionId required' })); return }
        const companyId = await getCompanyId(sessionId)
        if (!companyId || companyId === 'NO_COMPANY') { res.writeHead(200); res.end(JSON.stringify({ error: 'No company' })); return }
        const { data: contacts } = await supabase.from('contacts').select('id,name,phone,notes').eq('company_id', companyId)
        const { data: chats } = await supabase.from('whatsapp_chats').select('id,remote_jid,contact_id,contact_name,session_id')
        const { data: msgs } = await supabase.from('whatsapp_messages').select('chat_id,text').eq('direction', 'received')
        const { data: sessions } = await supabase.from('whatsapp_sessions').select('id,phone,user_id').eq('company_id', companyId)
        // Get session phones to detect own number
        const sessionPhones = new Set()
        if (sessions) for (const s of sessions) { const np = normalizePhone(s.phone || ''); if (np) sessionPhones.add(np) }
        // Build chat_id → received pushName map from messages
        const pushNameByChat = {}
        if (msgs) for (const m of msgs) {
          if (!pushNameByChat[m.chat_id] && m.text && m.text.length < 50) pushNameByChat[m.chat_id] = m.text
        }
        // Build phone-to-contact map
        const contactByPhone = {}
        if (contacts) for (const c of contacts) { const np = normalizePhone(c.phone || ''); if (np) contactByPhone[np] = c }
        let renamed = 0, deleted = 0, total = 0
        // Find all "Eduardo Silva" contacts OR name === phone (LID numeric)
        if (contacts) for (const c of contacts) {
          if (c.name !== 'Eduardo Silva' && c.name !== c.phone && !/^\d+$/.test(c.name.replace(/\D/g, ''))) continue
          total++
          const np = normalizePhone(c.phone || '')
          // 1. Skip if it's the session owner's phone
          if (sessionPhones.has(np)) {
            await supabase.from('contacts').delete().eq('id', c.id)
            await supabase.from('whatsapp_chats').update({ contact_id: null }).eq('contact_id', c.id)
            deleted++; continue
          }
          // 2. Try to find a better name from chats (original contact_name)
          let newName = null
          const chat = (chats || []).find(ch => ch.contact_id === c.id || normalizePhone(ch.remote_jid?.split('@')[0] || '') === np)
          if (chat) {
            // 2a. Try pushName from received messages
            const pushNameMsg = pushNameByChat[chat.id]
            if (pushNameMsg && !/^\d+$/.test(pushNameMsg) && !sessionPhones.has(normalizePhone(pushNameMsg))) {
              newName = pushNameMsg
            }
            // 2b. Try contact_name from chat
            if (!newName && chat.contact_name && chat.contact_name !== 'Eduardo Silva' && !/^\d+$/.test(chat.contact_name)) {
              newName = chat.contact_name
            }
            // 2c. Try matching by phone with another contact
            if (!newName) {
              const other = (contacts || []).find(o => normalizePhone(o.phone || '') === np && o.name !== 'Eduardo Silva' && !/^\d+$/.test(o.name))
              if (other) newName = other.name
            }
          }
          // 3. If still no name, format the phone number
          if (!newName) {
            const raw = np.replace(/^55/, '')
            const fmt = raw.replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3')
            newName = fmt !== raw ? fmt : np
          }
          // 4. Update contact and chat names
          await supabase.from('contacts').update({ name: newName }).eq('id', c.id)
          if (chat) await supabase.from('whatsapp_chats').update({ contact_name: newName }).eq('id', chat.id)
          renamed++
        }
        res.writeHead(200); res.end(JSON.stringify({ ok: true, total, renamed, deleted })); return
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })) }
    })
    return
  }

  if (pathname === '/fix-lid-links' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', async () => {
      try {
        const { sessionId } = JSON.parse(body)
        if (!sessionId) { res.writeHead(400); res.end(JSON.stringify({ error: 'sessionId required' })); return }
        const companyId = await getCompanyId(sessionId)
        if (!companyId || companyId === 'NO_COMPANY') { res.writeHead(200); res.end(JSON.stringify({ error: 'No company' })); return }
        // Paginate all chats
        let allChats = []; let offset = 0; const batchSize = 1000
        while (true) {
          const { data: batch } = await supabase.from('whatsapp_chats').select('id,remote_jid,contact_id,contact_name').range(offset, offset + batchSize - 1)
          if (!batch?.length) break
          allChats = allChats.concat(batch)
          if (batch.length < batchSize) break
          offset += batchSize
        }
        const lidChats = allChats.filter(function(ch) { return ch.remote_jid?.includes('@lid') })
        const { data: contacts } = await supabase.from('contacts').select('id,name,phone').eq('company_id', companyId)
        let unlinked = 0, relinked = 0
        for (const ch of lidChats) {
          if (!ch.contact_id) continue
          const contact = (contacts || []).find(function(c) { return c.id === ch.contact_id })
          if (!contact) {
            // Contact was deleted — unlink
            await supabase.from('whatsapp_chats').update({ contact_id: null }).eq('id', ch.id)
            unlinked++; continue
          }
          // Check if this LID's phone matches the contact's phone
          const lidNp = normalizePhone(ch.remote_jid.split('@')[0] || '')
          const contactNp = normalizePhone(contact.phone || '')
          if (lidNp === contactNp) continue // Correct match
          // Unlink suspect LID (phone doesn't match)
          const newContactName = ch.contact_name && !/^\d+$/.test(ch.contact_name) ? ch.contact_name : ('LID-' + lidNp.slice(-6))
          await supabase.from('whatsapp_chats').update({ contact_id: null, contact_name: newContactName }).eq('id', ch.id)
          unlinked++
        }
        // Also handle orphan LID chats (no contact_id)
        for (const ch of lidChats) {
          if (ch.contact_id) continue
          const jid = ch.remote_jid || ''
          const np = normalizePhone(jid.split('@')[0] || '')
          if (sessionPhones.has(np)) continue
          if (ch.contact_name && !/^\d+$/.test(ch.contact_name.replace(/\D/g, '')) && ch.contact_name.length > 1) {
            const cleanName = ch.contact_name.replace(/[^a-zA-Z0-9À-ÿ ]/g, '').trim().split(/\s+/)[0]
            const match = (contacts || []).find(function(c) { return c.name && c.name.toLowerCase().startsWith(cleanName.toLowerCase()) })
            if (match) {
              await supabase.from('whatsapp_chats').update({ contact_id: match.id, contact_name: match.name }).eq('id', ch.id)
              relinked++
            }
          }
        }
        res.writeHead(200); res.end(JSON.stringify({ ok: true, unlinked, relinked })); return
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })) }
    })
    return
  }

  if (pathname === '/fix-orphan-lids' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', async () => {
      try {
        const { sessionId } = JSON.parse(body)
        if (!sessionId) { res.writeHead(400); res.end(JSON.stringify({ error: 'sessionId required' })); return }
        const companyId = await getCompanyId(sessionId)
        if (!companyId || companyId === 'NO_COMPANY') { res.writeHead(200); res.end(JSON.stringify({ error: 'No company' })); return }
        const entry = sessions.get(sessionId)
        const sessionPhone = normalizePhone(entry?.phone || '')
        // Load all data (use larger limit to avoid Supabase 1000-row cap)
        const { data: contacts } = await supabase.from('contacts').select('id,name,phone,source').eq('company_id', companyId).limit(10000)
        // Load chats in batches to avoid Supabase 1000-row cap
        let allChats = []; let offset = 0; const batchSize = 1000
        while (true) {
          const { data: batch } = await supabase.from('whatsapp_chats').select('id,remote_jid,contact_id,contact_name,session_id').range(offset, offset + batchSize - 1)
          if (!batch?.length) break
          allChats = allChats.concat(batch)
          if (batch.length < batchSize) break
          offset += batchSize
        }
        const chats = allChats
        const { data: sessionsList } = await supabase.from('whatsapp_sessions').select('id,phone').eq('company_id', companyId)
        const sessionPhones = new Set()
        if (sessionsList) for (const s of sessionsList) { const np = normalizePhone(s.phone || ''); if (np) sessionPhones.add(np) }
        // Build phone → contact map
        const contactByPhone = {}
        if (contacts) for (const c of contacts) { const np = normalizePhone(c.phone || ''); if (np) contactByPhone[np] = c }
        // Track results
        let deletedLids = 0, relinked = 0, mergedChats = 0, formatted = 0
        // Step 1: Find LID contacts (name === phone or name all digits AND phone >= 13 digits)
        const lidContacts = (contacts || []).filter(function(c) {
          if (c.source !== 'whatsapp') return false
          const np = normalizePhone(c.phone || '')
          if (np.length < 13) return false
          const nameIsNum = /^\d+$/.test(c.name.replace(/\D/g, ''))
          return nameIsNum || c.name === c.phone
        })
        for (const lid of lidContacts) {
          const np = normalizePhone(lid.phone || '')
          // 1a. Skip if it's the session owner's phone
          if (sessionPhones.has(np)) {
            await supabase.from('contacts').delete().eq('id', lid.id)
            await supabase.from('whatsapp_chats').update({ contact_id: null }).eq('contact_id', lid.id)
            deletedLids++; continue
          }
          // 1b. Find the chat linked to this LID
          const lidChat = (chats || []).find(function(ch) {
            return ch.contact_id === lid.id || normalizePhone(ch.remote_jid?.split('@')[0] || '') === np
          })
          // 1c. Try to find a real contact to link to
          let realContact = null
          // By pushName from chat contact_name
          if (!realContact && lidChat && lidChat.contact_name && lidChat.contact_name !== lid.name && !/^\d+$/.test(lidChat.contact_name)) {
            realContact = (contacts || []).find(function(c) { return c.name === lidChat.contact_name && c.id !== lid.id })
          }
          // By another contact with the same normalized phone
          if (!realContact) {
            realContact = (contacts || []).find(function(c) { return normalizePhone(c.phone || '') === np && c.id !== lid.id && !/^\d+$/.test(c.name) })
          }
          // By pushName from chat contact_name (fuzzy)
          if (!realContact && lidChat && lidChat.contact_name) {
            const cleanName = lidChat.contact_name.replace(/[^a-zA-Z0-9À-ÿ ]/g, '').trim().split(/\s+/)[0]
            if (cleanName && cleanName.length > 1) {
              realContact = (contacts || []).find(function(c) { return c.name && c.name.toLowerCase().startsWith(cleanName.toLowerCase()) && c.id !== lid.id })
            }
          }
          if (realContact) {
            // Relink LID chat to real contact
            if (lidChat) {
              await supabase.from('whatsapp_chats').update({ contact_id: realContact.id, contact_name: realContact.name }).eq('id', lidChat.id)
              // Check if there's another chat linked to the same real contact (merge)
              const otherChat = (chats || []).find(function(ch) { return ch.contact_id === realContact.id && ch.id !== lidChat.id })
              if (otherChat) {
                // Move messages from other chat to LID chat
                await supabase.from('whatsapp_messages').update({ chat_id: lidChat.id }).eq('chat_id', otherChat.id)
                await supabase.from('whatsapp_chats').delete().eq('id', otherChat.id)
                mergedChats++
              }
            } else {
              // No chat for LID — just update any chat that had this contact_id
              const anyChat = (chats || []).find(function(ch) { return ch.contact_id === realContact.id })
              if (anyChat) {
                await supabase.from('whatsapp_chats').update({ remote_jid: lidChat?.remote_jid || lid.phone }).eq('id', anyChat.id)
              }
            }
            await supabase.from('contacts').delete().eq('id', lid.id)
            relinked++
          } else {
            // Could not find real contact — format phone as name
            const raw = np.replace(/^55/, '')
            const fmt = raw.replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3')
            let newName = fmt !== raw ? fmt : ''
            if (!newName) {
              // LID or international number — show last 8 digits
              const short = raw.length > 8 ? raw.slice(-8) : raw
              newName = 'LID-' + short
            }
            await supabase.from('contacts').update({ name: newName }).eq('id', lid.id)
            if (lidChat) await supabase.from('whatsapp_chats').update({ contact_name: newName }).eq('id', lidChat.id)
            formatted++
          }
        }
        // Step 2: Find chats with LID-like remote_jid that have contact_id pointing to a deleted/empty contact
        if (chats) for (const ch of chats) {
          const jid = ch.remote_jid || ''
          if (!jid.includes('@lid')) continue
          if (ch.contact_id) {
            // Check if the contact still exists
            const ctExists = (contacts || []).find(function(c) { return c.id === ch.contact_id })
            if (!ctExists) {
              // Contact was deleted — find or create a replacement
              const np = normalizePhone(jid.split('@')[0] || '')
              let replacement = contactByPhone[np]
              if (!replacement) {
                replacement = (contacts || []).find(function(c) { return c.name === ch.contact_name && c.id !== ch.contact_id })
              }
              if (replacement) {
                await supabase.from('whatsapp_chats').update({ contact_id: replacement.id, contact_name: replacement.name }).eq('id', ch.id)
              }
            }
          }
        }
        // Step 3: Find chats with @lid that have NO contact_id (orphan LID chats)
        let orphanedLinked = 0, orphanedRenamed = 0
        if (chats) for (const ch of chats) {
          const jid = ch.remote_jid || ''
          if (!jid.includes('@lid')) continue
          if (ch.contact_id) continue // already linked
          const np = normalizePhone(jid.split('@')[0] || '')
          // Skip own session phone
          if (sessionPhones.has(np)) { continue }
          let match = null
          // 3a. Try by contact_name if it's not numeric
          if (ch.contact_name && !/^\d+$/.test(ch.contact_name.replace(/\D/g, '')) && ch.contact_name.length > 1) {
            const cleanName = ch.contact_name.replace(/[^a-zA-Z0-9À-ÿ ]/g, '').trim().split(/\s+/)[0]
            if (cleanName && cleanName.length > 1) {
              match = (contacts || []).find(function(c) { return c.name && c.name.toLowerCase().startsWith(cleanName.toLowerCase()) })
            }
          }
          // 3b. Try by phone number match in contacts (if we have the number)
          if (!match && contactByPhone[np]) {
            match = contactByPhone[np]
          }
          // 3c. Try by chat contact_name exact match (first name)
          if (!match && ch.contact_name && !/^\d+$/.test(ch.contact_name.replace(/\D/g, ''))) {
            match = (contacts || []).find(function(c) { return c.name === ch.contact_name })
          }
          if (match) {
            // Check if this contact already has another chat (merge)
            const existingChat = (chats || []).find(function(oc) { return oc.contact_id === match.id && oc.id !== ch.id })
            if (existingChat) {
              await supabase.from('whatsapp_messages').update({ chat_id: ch.id }).eq('chat_id', existingChat.id)
              await supabase.from('whatsapp_chats').delete().eq('id', existingChat.id)
              mergedChats++
            }
            await supabase.from('whatsapp_chats').update({ contact_id: match.id, contact_name: match.name }).eq('id', ch.id)
            orphanedLinked++
          } else {
            // No match — rename chat contact_name to formatted phone
            const raw = np.replace(/^55/, '')
            const fmt = raw.replace(/^(\d{2})(\d{4,5})(\d{4})$/, '($1) $2-$3')
            const newName = fmt !== raw ? fmt : np
            await supabase.from('whatsapp_chats').update({ contact_name: newName }).eq('id', ch.id)
            orphanedRenamed++
          }
        }
        res.writeHead(200); res.end(JSON.stringify({ ok: true, deletedLids, relinked, mergedChats, formatted, orphanedLinked, orphanedRenamed })); return
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })) }
    })
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

  if (pathname === '/fix-jids') {
    const sid = url.searchParams.get('sessionId')
    if (!sid) { res.writeHead(400); res.end(JSON.stringify({ error: 'sessionId required' })); return }
    const { data: chats } = await supabase.from('whatsapp_chats').select('id,remote_jid,contact_id').eq('session_id', sid)
    const { data: contacts } = await supabase.from('contacts').select('id,phone')
    const phoneById = {}
    if (contacts) for (const c of contacts) phoneById[c.id] = c.phone
    let fixed = 0
    if (chats) {
      for (const ch of chats) {
        var contactPhone = ch.contact_id ? phoneById[ch.contact_id] : null
        if (contactPhone) {
          var np = normalizePhone(contactPhone)
          var correctJid = '55' + np + '@s.whatsapp.net'
          if (ch.remote_jid !== correctJid) { await supabase.from('whatsapp_chats').update({ remote_jid: correctJid }).eq('id', ch.id); fixed++ }
        } else {
          // Fallback: use the current remote_jid
          var part = ch.remote_jid?.split('@')[0] || ''
          var np = normalizePhone(part)
          if (np && np.length >= 10 && ch.remote_jid !== '55' + np + '@s.whatsapp.net') {
            var correctJid2 = '55' + np + '@s.whatsapp.net'
            await supabase.from('whatsapp_chats').update({ remote_jid: correctJid2 }).eq('id', ch.id); fixed++
          }
        }
      }
    }
    res.writeHead(200); res.end(JSON.stringify({ ok: true, fixed })); return
  }

  if (pathname === '/fix-contact-names') {
    const sid = url.searchParams.get('sessionId')
    if (!sid) { res.writeHead(400); res.end(JSON.stringify({ error: 'sessionId required' })); return }
    const companyId = await getCompanyId(sid)
    const { data: companySessions } = await supabase.from('whatsapp_sessions').select('id').eq('company_id', companyId)
    const sids = [sid, ...(companySessions || []).map(function(s){ return s.id }).filter(function(id){ return id !== sid })]
    const { data: chats } = await supabase.from('whatsapp_chats').select('id,remote_jid,contact_name,contact_id').in('session_id', sids)
    const { data: contacts } = await supabase.from('contacts').select('id,name,phone').eq('company_id', companyId)
    const byNp = {}
    if (contacts) for (const c of contacts) { const np = normalizePhone(c.phone || ''); if (np && c.name && !/^\d+$/.test(c.name)) byNp[np] = c.name }
    let fixed = 0
    if (chats) for (const ch of chats) {
      const np = normalizePhone(ch.remote_jid?.split('@')[0] || '')
      if (np && byNp[np] && byNp[np] !== ch.contact_name) {
        await supabase.from('whatsapp_chats').update({ contact_name: byNp[np] }).eq('id', ch.id)
        fixed++
      }
    }
    res.writeHead(200); res.end(JSON.stringify({ ok: true, fixed })); return
  }

  if (pathname === '/migrate-created-by') {
    const sid = url.searchParams.get('sessionId')
    if (!sid) { res.writeHead(400); res.end(JSON.stringify({ error: 'sessionId required' })); return }
    const entry = sessions.get(sid)
    const companyId = await getCompanyId(sid)
    const { data: sessionsList } = await supabase.from('whatsapp_sessions').select('id,user_id').eq('company_id', companyId)
    const userIdBySession = {}
    if (sessionsList) for (const s of sessionsList) userIdBySession[s.id] = s.user_id
    const sids = Object.keys(userIdBySession)
    if (!entry?.userId) sids.push(sid)
    const { data: chats } = await supabase.from('whatsapp_chats').select('id,remote_jid,contact_id,contact_name,session_id').in('session_id', sids.length ? sids : [sid])
    const { data: contacts } = await supabase.from('contacts').select('id,phone,notes').eq('company_id', companyId)
    const contactByNp = {}
    if (contacts) for (const c of contacts) { const np = normalizePhone(c.phone || ''); if (np) contactByNp[np] = c }
    let updated = 0
    if (chats) for (const ch of chats) {
      const np = normalizePhone(ch.remote_jid?.split('@')[0] || '')
      if (!np || !contactByNp[np]) continue
      const ct = contactByNp[np]
      let hasCreator = false
      try { var n = typeof ct.notes === 'string' ? JSON.parse(ct.notes) : (ct.notes || {}); if (n.created_by) hasCreator = true } catch(e) {}
      if (hasCreator) continue
      const uid = userIdBySession[ch.session_id] || entry?.userId
      if (uid) {
        const oldNotes = ct.notes ? (typeof ct.notes === 'string' ? (() => { try { return JSON.parse(ct.notes) } catch(e) { return { _: ct.notes } } })() : ct.notes) : {}
        oldNotes.created_by = uid
        await supabase.from('contacts').update({ notes: JSON.stringify(oldNotes) }).eq('id', ct.id)
        updated++
      }
    }
    res.writeHead(200); res.end(JSON.stringify({ ok: true, updated })); return
  }

  if (pathname === '/find-dup-contacts') {
    const sid = url.searchParams.get('sessionId')
    if (!sid) { res.writeHead(400); res.end(JSON.stringify({ error: 'sessionId required' })); return }
    const companyId = await getCompanyId(sid)
    if (!companyId || companyId === 'NO_COMPANY') { res.writeHead(200); res.end(JSON.stringify({ dups: [] })); return }
    const { data: all } = await supabase.from('contacts').select('id,name,phone,source,stage,created_at').eq('company_id', companyId)
    const byPhone = {}
    if (all) for (const c of all) {
      const np = normalizePhone(c.phone || '')
      if (!np) continue
      if (!byPhone[np]) byPhone[np] = []
      byPhone[np].push(c)
    }
    const dups = []
    for (const [np, list] of Object.entries(byPhone)) {
      if (list.length < 2) continue
      list.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
      const keep = list[0]
      dups.push({ phone: np, contacts: list, suggestedKeepId: keep.id, suggestedKeepName: keep.name })
    }
    res.writeHead(200); res.end(JSON.stringify({ dups })); return
  }

  if (pathname === '/merge-dup-contacts' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', async () => {
      try {
        const { sessionId, merges } = JSON.parse(body)
        if (!sessionId || !merges?.length) { res.writeHead(400); res.end(JSON.stringify({ error: 'sessionId and merges required' })); return }
        const companyId = await getCompanyId(sessionId)
        if (!companyId || companyId === 'NO_COMPANY') { res.writeHead(200); res.end(JSON.stringify({ merged: 0, errors: [] })); return }
        const log = []
        const errors = []
        for (const m of merges) {
          try {
            const keepId = m.keepId, removeId = m.removeId, finalName = m.name
            if (!keepId || !removeId) continue
            // Transfer chats to kept contact
            const { data: chats } = await supabase.from('whatsapp_chats').select('id').eq('contact_id', removeId)
            if (chats?.length) {
              await supabase.from('whatsapp_chats').update({ contact_id: keepId, contact_name: finalName }).eq('contact_id', removeId)
            }
            // Transfer cadence actions
            const { data: actions } = await supabase.from('cadence_actions').select('id').eq('contact_id', removeId)
            if (actions?.length) await supabase.from('cadence_actions').update({ contact_id: keepId }).eq('contact_id', removeId)
            // Update kept contact name
            await supabase.from('contacts').update({ name: finalName }).eq('id', keepId)
            // Delete the duplicate
            const { data: removed } = await supabase.from('contacts').select('name,phone').eq('id', removeId).limit(1)
            await supabase.from('contacts').delete().eq('id', removeId)
            log.push({ date: new Date().toISOString(), keepId, removeId, phone: m.phone, oldName: removed?.[0]?.name || '', newName: finalName })
          } catch (e) { errors.push({ removeId: m.removeId, error: e.message }) }
        }
        // Store log
        if (!mergeLogs[companyId]) mergeLogs[companyId] = []
        mergeLogs[companyId].push(...log)
        res.writeHead(200); res.end(JSON.stringify({ ok: true, merged: log.length, errors })); return
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })) }
    })
    return
  }

  if (pathname === '/merge-log') {
    const sid = url.searchParams.get('sessionId')
    if (!sid) { res.writeHead(400); res.end(JSON.stringify({ error: 'sessionId required' })); return }
    const companyId = await getCompanyId(sid)
    res.writeHead(200); res.end(JSON.stringify({ log: mergeLogs[companyId] || [] })); return
  }

  if (pathname === '/revert-merge' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', async () => {
      try {
        const { sessionId, index } = JSON.parse(body)
        if (!sessionId || index === undefined) { res.writeHead(400); res.end(JSON.stringify({ error: 'sessionId and index required' })); return }
        const companyId = await getCompanyId(sessionId)
        const logs = mergeLogs[companyId]
        if (!logs?.length || index >= logs.length) { res.writeHead(200); res.end(JSON.stringify({ ok: false, error: 'No log entry at index' })); return }
        const entry = logs[index]
        // Restore removed contact
        const { data: existing } = await supabase.from('contacts').select('id').eq('phone', entry.phone).limit(1)
        if (existing?.length) { res.writeHead(200); res.end(JSON.stringify({ ok: false, error: 'Contact already exists, cannot revert' })); return }
        const { data: restored } = await supabase.from('contacts').insert({ id: entry.removeId, name: entry.oldName, phone: entry.phone, source: 'manual', stage: 'novo', score: 0, company_id: companyId }).select().single()
        // Transfer chats back
        if (restored) {
          await supabase.from('whatsapp_chats').update({ contact_id: entry.removeId, contact_name: entry.oldName }).eq('contact_id', entry.keepId)
          await supabase.from('cadence_actions').update({ contact_id: entry.removeId }).eq('contact_id', entry.keepId)
        }
        logs.splice(index, 1)
        res.writeHead(200); res.end(JSON.stringify({ ok: true })); return
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })) }
    })
    return
  }

  if (pathname === '/cleanup-all') {
    const sid = url.searchParams.get('sessionId')
    if (!sid) { res.writeHead(400); res.end(JSON.stringify({ error: 'sessionId required' })); return }
    const companyId = await getCompanyId(sid)
    if (!companyId || companyId === 'NO_COMPANY') { res.writeHead(200); res.end(JSON.stringify({ error: 'No company' })); return }
    const results = {}
    // Define sids at function scope for reuse
    let sids = [sid]
    try {
      const { data: companySessions } = await supabase.from('whatsapp_sessions').select('id').eq('company_id', companyId)
      if (companySessions?.length) sids = [sid, ...companySessions.map(s => s.id).filter(id => id !== sid)]
    } catch (e) {}
    try {
      // 1. Remove LIDs
      let q = supabase.from('contacts').select('id,name,phone')
      if (companyId) q = q.eq('company_id', companyId)
      const { data: allContacts } = await q
      const lids = (allContacts || []).filter(c => { const p = normalizePhone(c.phone || ''); return p.length >= 14 })
      if (lids.length) await supabase.from('contacts').delete().in('id', lids.map(c => c.id))
      results.lidsRemoved = lids.length
    } catch (e) { results.lidsError = e.message }
    try {
      // 2. Deduplicate messages (keep first by created_at)
      const { data: allC } = await supabase.from('whatsapp_chats').select('id').in('session_id', [sid])
      let removed = 0
      if (allC) for (const ch of allC) {
        const { data: msgs } = await supabase.from('whatsapp_messages').select('id,text,created_at').eq('chat_id', ch.id).order('created_at', { ascending: true })
        if (!msgs?.length) continue
        const seen = {}
        for (const m of msgs) {
          const key = (m.text || '').substring(0, 100)
          if (seen[key]) { await supabase.from('whatsapp_messages').delete().eq('id', m.id); removed++ }
          else seen[key] = true
        }
      }
      results.msgsDeduplicated = removed
    } catch (e) { results.msgsError = e.message }
    try {
      // 3. Fix contact names from DB contacts
      const { data: chats } = await supabase.from('whatsapp_chats').select('id,remote_jid,contact_name').in('session_id', sids)
      const { data: contacts } = await supabase.from('contacts').select('id,name,phone').eq('company_id', companyId)
      const byNp = {}
      if (contacts) for (const c of contacts) { const np = normalizePhone(c.phone || ''); if (np && c.name && !/^\d+$/.test(c.name)) byNp[np] = c.name }
      let fixed = 0
      if (chats) for (const ch of chats) {
        const np = normalizePhone(ch.remote_jid?.split('@')[0] || '')
        if (np && byNp[np] && byNp[np] !== ch.contact_name) {
          await supabase.from('whatsapp_chats').update({ contact_name: byNp[np] }).eq('id', ch.id); fixed++
        }
      }
      results.contactNamesFixed = fixed
    } catch (e) { results.contactNamesError = e.message }
    try {
      // 4. Fix JIDs
      const { data: chats2 } = await supabase.from('whatsapp_chats').select('id,remote_jid,contact_id').in('session_id', sids)
      const { data: contacts2 } = await supabase.from('contacts').select('id,phone')
      const phoneById = {}
      if (contacts2) for (const c of contacts2) phoneById[c.id] = c.phone
      let jidFixed = 0
      if (chats2) for (const ch of chats2) {
        var contactPhone = ch.contact_id ? phoneById[ch.contact_id] : null
        if (contactPhone) {
          var np = normalizePhone(contactPhone)
          var correctJid = '55' + np + '@s.whatsapp.net'
          if (ch.remote_jid !== correctJid) { await supabase.from('whatsapp_chats').update({ remote_jid: correctJid }).eq('id', ch.id); jidFixed++ }
        } else {
          var part = ch.remote_jid?.split('@')[0] || ''
          var np2 = normalizePhone(part)
          if (np2 && np2.length >= 10 && ch.remote_jid !== '55' + np2 + '@s.whatsapp.net') {
            await supabase.from('whatsapp_chats').update({ remote_jid: '55' + np2 + '@s.whatsapp.net' }).eq('id', ch.id); jidFixed++
          }
        }
      }
      results.jidsFixed = jidFixed
    } catch (e) { results.jidsError = e.message }
    try {
      // 5. Deduplicate contacts
      const { data: all3 } = await supabase.from('contacts').select('id,name,phone').eq('company_id', companyId).order('created_at', { ascending: true })
      const seen = {}; const toDelete = []
      if (all3) for (const c of all3) { const key = normalizePhone(c.phone) + '|' + ((c.name || '').toLowerCase().replace(/[^a-z0-9]/g, '')); if (seen[key]) toDelete.push(c.id); else seen[key] = true }
      if (toDelete.length) await supabase.from('contacts').delete().in('id', toDelete)
      results.contactsDeduplicated = toDelete.length
    } catch (e) { results.contactsError = e.message }
    try {
      // 6. Migrate created_by for existing contacts
      const { data: sessionsList } = await supabase.from('whatsapp_sessions').select('id,user_id').eq('company_id', companyId)
      const userIdBySession = {}
      if (sessionsList) for (const s of sessionsList) userIdBySession[s.id] = s.user_id
      const { data: chats3 } = await supabase.from('whatsapp_chats').select('id,remote_jid,session_id').in('session_id', sids)
      const { data: contacts3 } = await supabase.from('contacts').select('id,phone,notes').eq('company_id', companyId)
      const contactByNp = {}
      if (contacts3) for (const c of contacts3) { const np = normalizePhone(c.phone || ''); if (np) contactByNp[np] = c }
      let migrated = 0
      if (chats3) for (const ch of chats3) {
        const np = normalizePhone(ch.remote_jid?.split('@')[0] || '')
        if (!np || !contactByNp[np]) continue
        const ct = contactByNp[np]
        let hasCreator = false
        try { var n = typeof ct.notes === 'string' ? JSON.parse(ct.notes) : (ct.notes || {}); if (n.created_by) hasCreator = true } catch(e) {}
        if (hasCreator) continue
        const uid = userIdBySession[ch.session_id]
        if (uid) {
          const oldNotes = ct.notes ? (typeof ct.notes === 'string' ? (() => { try { return JSON.parse(ct.notes) } catch(e) { return { _: ct.notes } } })() : ct.notes) : {}
          oldNotes.created_by = uid
          await supabase.from('contacts').update({ notes: JSON.stringify(oldNotes) }).eq('id', ct.id); migrated++
        }
      }
      results.createdByMigrated = migrated
    } catch (e) { results.createdByError = e.message }
    res.writeHead(200); res.end(JSON.stringify({ ok: true, results })); return
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

  if (pathname === '/add-webhook-column') {
    try {
      // Use Supabase REST to run raw SQL
      const resp = await fetch(SUPABASE_URL + '/rest/v1/', {
        method: 'POST',
        headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({})
      })
      // Try via pg_dump approach - just return error with instructions
      res.writeHead(200); res.end(JSON.stringify({ ok: false, hint: 'Rode manualmente no SQL Editor do Supabase: ALTER TABLE companies ADD COLUMN IF NOT EXISTS webhook_code TEXT;' }))
    } catch (e) {
      res.writeHead(200); res.end(JSON.stringify({ ok: false, error: e.message }))
    }
    return
  }

  if (pathname === '/get-webhook-code' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', async () => {
      try {
        const { sessionId } = JSON.parse(body)
        const companyId = await getCompanyId(sessionId)
        if (!companyId || companyId === 'NO_COMPANY') { res.writeHead(200); res.end(JSON.stringify({ error: 'No company' })); return }
        const shortCode = companyId.split('-')[0].toUpperCase()
        res.writeHead(200); res.end(JSON.stringify({ company_code: shortCode, company_id: companyId }))
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })) }
    })
    return
  }

  if (pathname === '/webhook-lead' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', async () => {
      try {
        const d = JSON.parse(body)
        const rawCode = (d.company_code || d.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
        const rawId = d.company_id || ''
        let cid = null
        if (rawId) {
          const { data: comp } = await supabase.from('companies').select('id').eq('id', rawId).limit(1)
          if (comp?.[0]) cid = comp[0].id
        }
        if (!cid && rawCode) {
          // Match by first segment of UUID (company_code = first 8 hex chars uppercase)
          const { data: comps } = await supabase.from('companies').select('id').limit(500)
          if (comps) {
            for (const comp of comps) {
              if (comp.id.split('-')[0].toUpperCase() === rawCode) { cid = comp.id; break }
            }
          }
        }
        if (!cid) { res.writeHead(200); res.end(JSON.stringify({ error: 'Invalid company' })); return }
        const insertData = {
          name: d.name || d.nome || '',
          phone: normalizePhone(d.phone || d.telefone || d.celular || d.whatsapp || d.contato || d.tel || ''),
          email: d.email || d.mail || '',
          source: d.source || 'webhook',
          stage: d.stage || 'novo',
          score: 0,
          company_id: cid,
          campaign: d.campaign || d.campanha || '',
          description: d.description || d.descricao || d.msg || d.mensagem || '',
          project_value: d.project_value || d.valor || null,
          notes: d.notes || d.obs || ''
        }
        const r = await supabase.from('contacts').insert(insertData).select().single()
        if (r.error) { res.writeHead(500); res.end(JSON.stringify({ error: r.error.message })); return }
        res.writeHead(201); res.end(JSON.stringify({ ok: true, id: r.data?.id }))
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
          const uEntry = sessions.get(sessionId); const createdBy = uEntry?.userId || null
          var insertData = Object.assign({}, data, { company_id: companyId, source: 'manual' })
          if (createdBy) { var oldNotes = insertData.notes || {}; if (typeof oldNotes === 'string') try { oldNotes = JSON.parse(oldNotes) } catch(e) { oldNotes = {} }; oldNotes.created_by = createdBy; insertData.notes = JSON.stringify(oldNotes) }
          const r = await supabase.from('contacts').insert(insertData).select().single()
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
        const entry = sessions.get(sessionId)
        // Get or create chats for each row and insert messages as 'sent' (goes through pump)
        let inserted = 0
        for (const row of rows) {
          try {
            const personalized = text.replace(/\{nome\}/g, row.name)
            const phoneNum = normalizePhone(row.phone)
            if (!phoneNum) continue
            const jid = '55' + phoneNum + '@s.whatsapp.net'
            let chatId = null
            const exCh = await findChat(jid, sessionId, companyId)
            if (exCh) { chatId = exCh.id } else {
              const p = { remote_jid: jid, contact_name: row.name || phoneNum, session_id: sessionId }; if (companyId) p.company_id = companyId
              const r = await supabase.from('whatsapp_chats').insert(p).select().single()
              if (r.data) chatId = r.data.id
            }
            if (chatId) {
              const mp2 = { chat_id: chatId, session_id: sessionId, text: personalized, direction: 'sent', message_type: mediaUrl && messageType === 'image' ? 'image' : mediaUrl && messageType === 'audio' ? 'audio' : 'text', created_at: new Date().toISOString() }
              if (mediaUrl) mp2.media_url = mediaUrl
              await supabase.from('whatsapp_messages').insert(mp2); inserted++
            }
          } catch (e) {}
        }
        res.writeHead(200); res.end(JSON.stringify({ ok: true, inserted, total: rows.length }))
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: e.message })) }
    })
    return
  }

  if (pathname === '/link-tag' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', async () => {
      try {
        const { contactId, tag, add, sessionId } = JSON.parse(body)
        if (!contactId || !tag || !sessionId) { res.writeHead(400); res.end(JSON.stringify({ error: 'contactId, tag, sessionId required' })); return }
        const companyId = await getCompanyId(sessionId)
        if (!companyId || companyId === 'NO_COMPANY') { res.writeHead(200); res.end(JSON.stringify({ ok: false })); return }
        // Get current contact tags
        const { data: contact } = await supabase.from('contacts').select('tags').eq('id', contactId).eq('company_id', companyId).limit(1)
        if (!contact?.length) { res.writeHead(200); res.end(JSON.stringify({ ok: false, error: 'Contact not found' })); return }
        var tags = contact[0].tags || []
        if (add) { if (!tags.includes(tag)) tags.push(tag) }
        else { tags = tags.filter(function(t) { return t !== tag }) }
        await supabase.from('contacts').update({ tags }).eq('id', contactId).eq('company_id', companyId)
        res.writeHead(200); res.end(JSON.stringify({ ok: true, tags }))
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
        let companyId = sid ? await getCompanyId(sid) : null
        // Fallback: use company_id from filters if no session (for tag linking etc.)
        if (!companyId && params?.filters?.company_id) companyId = params.filters.company_id
        const isConnected = sid && sessions.get(sid)?.status === 'connected'
        logger.info('Proxy: ' + operation + ' ' + table + ' sid=' + (sid || 'null') + ' cid=' + (companyId || 'null') + ' filters=' + JSON.stringify(params?.filters || {}))
        const scoped = ['tasks','kanban_columns','kanban_cards','documents','contacts','cadence_actions','cadences','whatsapp_chats','whatsapp_messages','whatsapp_sessions','app_checklist','app_kanban','app_conversations','app_suggestions','app_analyses','app_feedback']
        if (scoped.includes(table) && (!companyId || companyId === 'NO_COMPANY')) { res.writeHead(200); res.end(JSON.stringify({ data: [] })); return }
        if (operation === 'select') {
          let q = supabase.from(table).select(params?.select || '*')
          if (scoped.includes(table)) q = q.eq('company_id', companyId)
          if (params?.filters) for (const [k, v] of Object.entries(params.filters)) if (k !== 'company_id') q = q.eq(k, v)
          if (params?.order) { const d = params.order.endsWith('.desc'); q = q.order(params.order.replace(/\.(desc|asc)$/, ''), { ascending: !d }) }
          if (params?.limit) q = q.limit(parseInt(params.limit))
          if (params?.offset) q = q.range(parseInt(params.offset), parseInt(params.offset) + (parseInt(params.limit) || 100) - 1)
          const r = await q; res.writeHead(200); res.end(JSON.stringify(r))
        } else if (operation === 'insert') {
          const uEntry = sid ? sessions.get(sid) : null
          const insertBody = Object.assign({}, reqBody || {}, { company_id: companyId })
          if (uEntry?.userId && table === 'contacts') { try { var nb = insertBody.notes || {}; if (typeof nb === 'string') nb = JSON.parse(nb); nb.created_by = uEntry.userId; insertBody.notes = JSON.stringify(nb) } catch(e) {} }
          const r = await supabase.from(table).insert(insertBody).select()
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


