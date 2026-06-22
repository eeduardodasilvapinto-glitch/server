/* ================================================================
   Veltris WPP Server - WhatsApp Baileys Backend
   Conexao nao-oficial com WhatsApp Web via WebSocket
   Sincroniza sessoes, chats e mensagens com Supabase
   ================================================================ */

import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys'
import { createClient } from '@supabase/supabase-js'
import QRCode from 'qrcode'
import pino from 'pino'
import fs from 'fs'
import 'dotenv/config'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const SESSION_NAME = process.env.WPP_SESSION_NAME || 'default'
const AUTH_DIR = process.env.WPP_AUTH_DIR || './auth'

const logger = pino({ level: process.env.LOG_LEVEL || 'info' })
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }
})

if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true })

let sock = null
let sessionId = null
let outgoingInterval = null
let sessionPollInterval = null
let reconnectTimeout = null

async function getOrCreateSession() {
  const { data: sessions } = await supabase
    .from('whatsapp_sessions')
    .select('id,name,status,phone')
    .eq('name', SESSION_NAME)
    .order('created_at', { ascending: false })
    .limit(1)

  if (sessions && sessions.length > 0) return sessions[0]

  const { data: unnamed } = await supabase
    .from('whatsapp_sessions')
    .select('id,name,status,phone')
    .is('name', null)
    .order('created_at', { ascending: false })
    .limit(1)

  if (unnamed && unnamed.length > 0) {
    await supabase.from('whatsapp_sessions').update({ name: SESSION_NAME }).eq('id', unnamed[0].id)
    return { ...unnamed[0], name: SESSION_NAME }
  }

  const { data: newSession } = await supabase
    .from('whatsapp_sessions')
    .insert({ name: SESSION_NAME, status: 'disconnected' })
    .select()
    .single()

  return newSession
}

async function startSocket() {
  logger.info('Starting Baileys socket...')

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
  const { version } = await (async () => {
    try {
      const { fetchLatestBaileysVersion } = await import('@whiskeysockets/baileys')
      return await fetchLatestBaileysVersion()
    } catch {
      return { version: [2, 3000, 0] }
    }
  })()

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: ['Veltris CRM', 'Chrome', '1.0.0'],
    logger: pino({ level: 'silent' }),
    markOnlineOnConnect: true,
    syncFullHistory: false,
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async ({ qr, connection, lastDisconnect }) => {
    if (qr) {
      try {
        const qrDataUrl = await QRCode.toDataURL(qr)
        logger.info('QR Code generated')

        if (sessionId) {
          await supabase.from('whatsapp_sessions')
            .update({ qr_code: qrDataUrl, status: 'connecting' })
            .eq('id', sessionId)
        }
      } catch (e) {
        logger.error({ error: e.message }, 'Failed to save QR code')
      }
    }

    if (connection === 'open') {
      logger.info('WhatsApp connected successfully')

      const rawId = sock.user?.id || ''
      const phone = rawId.split(':')[0] || ''

      let sid = sessionId
      if (!sid) {
        const session = await getOrCreateSession()
        sid = session.id
        sessionId = sid
      }

      await supabase.from('whatsapp_sessions')
        .update({ status: 'connected', phone, qr_code: null })
        .eq('id', sid)

      startOutgoingPump()
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut

      logger.info({ code: statusCode }, `Connection closed. Will reconnect: ${shouldReconnect}`)

      if (sessionId) {
        await supabase.from('whatsapp_sessions')
          .update({ status: shouldReconnect ? 'connecting' : 'disconnected' })
          .eq('id', sessionId)
      }

      stopOutgoingPump()
      sock = null

      if (shouldReconnect) {
        reconnectTimeout = setTimeout(startSocket, 5000)
      } else {
        logger.warn('Logged out. Clear auth folder and create new session to reconnect.')
        try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }) } catch {}
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return

    for (const msg of messages) {
      try {
        if (!msg.message) continue
        if (msg.key.fromMe) continue

        const jid = msg.key.remoteJid
        if (!jid || jid.includes('@g.us') || jid.includes('@broadcast')) continue

        const msgContent = msg.message.conversation
          || msg.message.extendedTextMessage?.text
          || msg.message.imageMessage?.caption
          || msg.message.videoMessage?.caption
          || msg.message.documentMessage?.caption
          || ''
        if (!msgContent) continue

        const phone = jid.split('@')[0]
        const pushName = msg.pushName || phone

        // Find or create contact
        let contactId = null
        const { data: contacts } = await supabase.from('contacts').select('id').eq('phone', phone).limit(1)
        if (contacts && contacts.length > 0) {
          contactId = contacts[0].id
        } else {
          const { data: newC } = await supabase.from('contacts').insert({
            name: pushName,
            phone,
            source: 'whatsapp',
            stage: 'novo',
            score: 0
          }).select().single()
          if (newC) contactId = newC.id
        }

        // Find or create chat (try full JID first, then phone-only)
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
          await supabase.from('whatsapp_chats').update({
            remote_jid: jid,
            last_message: { text: msgContent.substring(0, 200), at: new Date().toISOString() },
            last_message_at: new Date().toISOString(),
            unread_count: (chats[0].unread_count || 0) + 1,
            contact_name: pushName
          }).eq('id', chatId)
        } else {
          const { data: newChat } = await supabase.from('whatsapp_chats').insert({
            remote_jid: jid,
            contact_id: contactId,
            contact_name: pushName,
            last_message: { text: msgContent.substring(0, 200), at: new Date().toISOString() },
            last_message_at: new Date().toISOString(),
            unread_count: 1,
            session_id: sessionId
          }).select().single()
          if (newChat) chatId = newChat.id
        }

        // Insert message
        if (chatId) {
          await supabase.from('whatsapp_messages').insert({
            chat_id: chatId,
            session_id: sessionId,
            text: msgContent,
            direction: 'received',
            status: 'received'
          })
        }
      } catch (e) {
        logger.error({ error: e.message }, 'Error handling incoming message')
      }
    }
  })
}

function startOutgoingPump() {
  stopOutgoingPump()
  outgoingInterval = setInterval(processOutgoing, 3000)
  logger.info('Outgoing message pump started')
}

function stopOutgoingPump() {
  if (outgoingInterval) {
    clearInterval(outgoingInterval)
    outgoingInterval = null
  }
}

function normalizeJid(raw) {
  if (!raw) return null
  if (raw.includes('@')) return raw
  let cleaned = raw.replace(/\D/g, '')
  if (cleaned.length <= 10) cleaned = '55' + cleaned
  return cleaned + '@s.whatsapp.net'
}

async function processOutgoing() {
  if (!sessionId || !sock) return

  try {
    const { data: messages } = await supabase
      .from('whatsapp_messages')
      .select('id,chat_id,text')
      .eq('session_id', sessionId)
      .eq('direction', 'sent')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(20)

    if (!messages || messages.length === 0) return

    for (const msg of messages) {
      try {
        const { data: chats } = await supabase.from('whatsapp_chats').select('remote_jid').eq('id', msg.chat_id).limit(1)
        let jid = chats?.[0]?.remote_jid
        const normalized = normalizeJid(jid)
        if (!normalized) {
          await supabase.from('whatsapp_messages').update({ status: 'failed' }).eq('id', msg.id)
          continue
        }
        if (normalized !== jid) {
          await supabase.from('whatsapp_chats').update({ remote_jid: normalized }).eq('id', msg.chat_id)
        }
        jid = normalized

        await sock.sendMessage(jid, { text: msg.text })

        await supabase.from('whatsapp_messages').update({ status: 'sent' }).eq('id', msg.id)

        // Update chat last message
        await supabase.from('whatsapp_chats').update({
          last_message: { text: msg.text.substring(0, 200), at: new Date().toISOString() },
          last_message_at: new Date().toISOString()
        }).eq('id', msg.chat_id)

        logger.info({ jid, msgId: msg.id }, 'Message sent')
      } catch (e) {
        logger.error({ error: e.message, msgId: msg.id }, 'Failed to send message')
        await supabase.from('whatsapp_messages').update({ status: 'failed' }).eq('id', msg.id)

        if (e.message?.includes('Connection closed')) {
          sock = null
          stopOutgoingPump()
          await supabase.from('whatsapp_sessions').update({ status: 'connecting' }).eq('id', sessionId)
          reconnectTimeout = setTimeout(startSocket, 5000)
          return
        }
      }
    }
  } catch (e) {
    logger.error({ error: e.message }, 'Error in outgoing pump')
  }
}

async function monitorDisconnect() {
  if (!sessionId) return

  try {
    const { data } = await supabase
      .from('whatsapp_sessions')
      .select('status')
      .eq('id', sessionId)
      .limit(1)

    if (data && data.length > 0 && data[0].status === 'disconnected' && sock) {
      logger.info('Session marked as disconnected by frontend, logging out')
      try { sock.logout() } catch {}
      sock = null
      stopOutgoingPump()
      try { fs.rmSync(AUTH_DIR, { recursive: true, force: true }) } catch {}
    }
  } catch {}
}

async function main() {
  logger.info({ supabase_url: SUPABASE_URL?.substring(0, 30) + '...' }, 'Veltris WPP Server starting')

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    logger.fatal('SUPABASE_URL and SUPABASE_SERVICE_KEY are required. Check your .env file.')
    process.exit(1)
  }

  const session = await getOrCreateSession()
  sessionId = session.id
  logger.info({ sessionId, status: session.status }, 'Session loaded')

  await startSocket()

  // Watch for disconnect requests from frontend
  sessionPollInterval = setInterval(monitorDisconnect, 10000)

  // Simple health check via process title
  logger.info('Veltris WPP Server is running. Press Ctrl+C to stop.')
}

process.on('SIGINT', () => {
  logger.info('Shutting down...')
  clearInterval(outgoingInterval)
  clearInterval(sessionPollInterval)
  clearTimeout(reconnectTimeout)
  if (sock) try { sock.end(undefined) } catch {}
  process.exit(0)
})

process.on('SIGTERM', () => {
  logger.info('Shutting down...')
  clearInterval(outgoingInterval)
  clearInterval(sessionPollInterval)
  clearTimeout(reconnectTimeout)
  if (sock) try { sock.end(undefined) } catch {}
  process.exit(0)
})

main().catch(err => {
  logger.fatal({ error: err.message }, 'Fatal error')
  process.exit(1)
})
