import WebSocket from 'ws'
globalThis.WebSocket = WebSocket

const { createClient } = await import('@supabase/supabase-js')

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false }, realtime: { transport: WebSocket } })

import http from 'http'

const PORT = 3123

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', pid: process.pid }))
    return
  }
  if (req.url === '/sessions') {
    supabase.from('whatsapp_sessions').select('id,status,phone').then(({ data }) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ sessions: data || [] }))
    }).catch(err => {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: err.message }))
    })
    return
  }
  res.writeHead(404)
  res.end('Not found')
})

server.listen(PORT, () => console.log('HTTP server listening on', PORT))
