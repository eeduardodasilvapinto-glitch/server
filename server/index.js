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
    markOnlineOnConnect: false,
    syncFullHistory: false,
  })

  entry.sock = sock
  entry.labels = {}
  entry.chatLabels = {}

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async ({ qr, connection, lastDisconnect }) => {
    if (qr) {
      const qrDataUrl = await QRCode.toDataURL(qr)
      entry.qrCode = qrDataUrl
      logger.info({ sessionId }, 'QR Code available')
      await supabase.from('whatsapp_sessions').update({ qr_code: qrDataUrl, status: 'connecting' }).eq('id', sessionId)
    }
    if (connection && entry.qrCode) {
      entry.qrCode = null
      await supabase.from('whatsapp_sessions').update({ qr_code: null }).eq('id', sessionId)
    }

    if (connection === 'open') {
      logger.info({ sessionId }, 'WhatsApp connected')
      entry.status = 'connected'
      entry.qrCode = null
      const rawId = sock.user?.id || ''
      const phone = rawId.split(':')[0] || ''
      entry.phone = phone
      await supabase.from('whatsapp_sessions').update({ status: 'connected', phone, qr_code: null }).eq('id', sessionId)
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut
      logger.info({ sessionId, code: statusCode, shouldReconnect }, 'Connection closed')
      entry.status = shouldReconnect ? 'connecting' : 'disconnected'
      entry.qrCode = null
      entry.sock = null
      await supabase.from('whatsapp_sessions').update({ status: entry.status }).eq('id', sessionId)
      if (shouldReconnect) {
        entry.reconnectTimeout = setTimeout(() => startSession(sessionId, userId, companyId), 5000)
      } else {
        try { fs.rmSync(authDir, { recursive: true, force: true }) } catch {}
        sessions.delete(sessionId)
      }
    }
  })
}

async function pollSessions() {
  try {
    const { data: dbSessions } = await supabase
      .from('whatsapp_sessions')
      .select('id,status,user_id,company_id')
      .in('status', ['connecting', 'disconnected', 'connected'])
      .order('created_at', { ascending: false })

    if (!dbSessions) return

    let latestConnecting = null
    for (const dbS of dbSessions) {
      if (dbS.status === 'connected') {
        if (!sessions.has(dbS.id)) {
          startSession(dbS.id, dbS.user_id, dbS.company_id)
        }
      } else if (dbS.status === 'connecting' && !sessions.has(dbS.id)) {
        if (!latestConnecting) latestConnecting = dbS
      } else if (dbS.status === 'disconnected' && sessions.has(dbS.id)) {
        const entry = sessions.get(dbS.id)
        if (entry.sock) { try { entry.sock.logout() } catch {} }
        entry.sock = null
        if (entry.reconnectTimeout) { clearTimeout(entry.reconnectTimeout); entry.reconnectTimeout = null }
        try { fs.rmSync(entry.authDir, { recursive: true, force: true }) } catch {}
        sessions.delete(dbS.id)
      }
    }
    if (latestConnecting && !sessions.has(latestConnecting.id)) {
      startSession(latestConnecting.id, latestConnecting.user_id, latestConnecting.company_id)
    }
  } catch (e) {
    logger.error({ error: e.message }, 'Error polling sessions')
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  const url = new URL(req.url, 'http://localhost')
  const pathname = url.pathname

  // /health — always responds immediately
  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', pid: process.pid }))
    return
  }

  // /sessions
  if (pathname === '/sessions') {
    const active = []
    for (const [id, entry] of sessions) {
      active.push({ sessionId: id, status: entry.status, phone: entry.phone, hasQr: !!entry.qrCode })
    }
    if (active.length === 0) {
      const { data: dbSessions } = await supabase.from('whatsapp_sessions').select('id,status,phone')
      if (dbSessions) {
        for (const s of dbSessions) active.push({ sessionId: s.id, status: s.status, phone: s.phone })
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ sessions: active }))
    return
  }

  // /qr
  if (pathname === '/qr') {
    const sid = url.searchParams.get('sessionId')
    const entry = sid ? sessions.get(sid) : null
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ qr_code: entry?.qrCode || null }))
    return
  }

  // /connect?user_id=xx
  if (pathname === '/connect') {
    try {
      const userId = url.searchParams.get('user_id') || null
      const { data: newSession, error } = await supabase.from('whatsapp_sessions').insert({
        status: 'connecting', user_id: userId,
      }).select().single()
      if (error) { res.writeHead(500); res.end(JSON.stringify({ error: error.message })); return }
      if (newSession) {
        startSession(newSession.id, newSession.user_id, newSession.company_id)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ sessionId: newSession.id }))
      } else {
        res.writeHead(500); res.end(JSON.stringify({ error: 'No session returned' }))
      }
    } catch (e) {
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }))
    }
    return
  }

  res.writeHead(404); res.end('Not found')
})

server.listen(HTTP_PORT, () => logger.info({ port: HTTP_PORT }, 'HTTP server listening'))

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  logger.fatal('SUPABASE_URL and SUPABASE_SERVICE_KEY required')
  process.exit(1)
}

setInterval(pollSessions, 10000)
pollSessions()

logger.info('Veltris WPP Server (multi-session) is running.')

process.on('SIGINT', () => { logger.info('Shutting down...'); process.exit(0) })
process.on('SIGTERM', () => { logger.info('Shutting down...'); process.exit(0) })
