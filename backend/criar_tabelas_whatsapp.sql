-- ============================================================
-- WHATSAPP - Criar tabelas para o WhatsApp CRM
-- Execute no SQL Editor do Supabase
-- ============================================================

ALTER TABLE whatsapp_sessions ADD COLUMN IF NOT EXISTS user_id TEXT;

CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  user_id TEXT,
  name TEXT,
  phone TEXT,
  status TEXT DEFAULT 'disconnected',
  qr_code TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS whatsapp_chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  remote_jid TEXT NOT NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  contact_name TEXT,
  last_message JSONB,
  last_message_at TIMESTAMPTZ,
  unread_count INTEGER DEFAULT 0,
  session_id UUID REFERENCES whatsapp_sessions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chats_jid ON whatsapp_chats(remote_jid);
CREATE INDEX IF NOT EXISTS idx_chats_contact ON whatsapp_chats(contact_id);

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID REFERENCES whatsapp_chats(id) ON DELETE CASCADE,
  session_id UUID REFERENCES whatsapp_sessions(id) ON DELETE SET NULL,
  text TEXT,
  direction TEXT DEFAULT 'received',
  status TEXT DEFAULT 'received',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_msg_chat ON whatsapp_messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_msg_status ON whatsapp_messages(session_id, direction, status);

CREATE TABLE IF NOT EXISTS whatsapp_auth (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES whatsapp_sessions(id) ON DELETE CASCADE,
  auth_data JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
