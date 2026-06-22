-- ================================================================
-- Veltris WhatsApp CRM - Database Schema (Supabase)
-- Execute este script no SQL Editor do Supabase
-- ================================================================

-- Sessoes do WhatsApp (gerenciamento de conexao)
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id BIGSERIAL PRIMARY KEY,
  name TEXT,
  phone TEXT,
  status TEXT DEFAULT 'disconnected',  -- connecting | connected | disconnected | expired
  qr_code TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Contatos (leads/clientes)
CREATE TABLE IF NOT EXISTS contacts (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  source TEXT DEFAULT 'manual',  -- whatsapp | manual | form
  stage TEXT DEFAULT 'novo',     -- novo | contato | qualificado | proposta | negociacao | fechado
  score INTEGER DEFAULT 0,
  tags JSONB DEFAULT '[]',
  notes TEXT,
  ai_insight TEXT,
  last_contacted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Conversas do WhatsApp
CREATE TABLE IF NOT EXISTS whatsapp_chats (
  id BIGSERIAL PRIMARY KEY,
  remote_jid TEXT NOT NULL,
  contact_id BIGINT REFERENCES contacts(id) ON DELETE SET NULL,
  contact_name TEXT,
  last_message JSONB,
  last_message_at TIMESTAMPTZ,
  unread_count INTEGER DEFAULT 0,
  session_id BIGINT REFERENCES whatsapp_sessions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chats_jid ON whatsapp_chats(remote_jid);
CREATE INDEX IF NOT EXISTS idx_chats_contact ON whatsapp_chats(contact_id);

-- Mensagens do WhatsApp
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id BIGSERIAL PRIMARY KEY,
  chat_id BIGINT REFERENCES whatsapp_chats(id) ON DELETE CASCADE,
  session_id BIGINT REFERENCES whatsapp_sessions(id) ON DELETE SET NULL,
  text TEXT,
  direction TEXT DEFAULT 'received',  -- sent | received
  status TEXT DEFAULT 'received',     -- queued | sent | received | failed
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_msg_chat ON whatsapp_messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_msg_status ON whatsapp_messages(session_id, direction, status);
CREATE INDEX IF NOT EXISTS idx_msg_created ON whatsapp_messages(created_at);

-- CadÃªncias (sequÃªncias de mensagens automatizadas)
CREATE TABLE IF NOT EXISTS cadences (
  id BIGSERIAL PRIMARY KEY,
  name TEXT DEFAULT 'Nova CadÃªncia',
  steps JSONB DEFAULT '[]',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- AÃ§Ãµes de cadÃªncia (mensagens agendadas)
CREATE TABLE IF NOT EXISTS cadence_actions (
  id BIGSERIAL PRIMARY KEY,
  cadence_id BIGINT REFERENCES cadences(id) ON DELETE CASCADE,
  contact_id BIGINT REFERENCES contacts(id) ON DELETE CASCADE,
  message TEXT,
  description TEXT,
  scheduled_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending',  -- pending | sent | done | cancelled
  contact_name TEXT,
  lead_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Autenticacao persistente do Baileys (opcional, para backup do auth)
CREATE TABLE IF NOT EXISTS whatsapp_auth (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT REFERENCES whatsapp_sessions(id) ON DELETE CASCADE,
  auth_data JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Triggers para updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sessions_updated') THEN
    CREATE TRIGGER trg_sessions_updated BEFORE UPDATE ON whatsapp_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_contacts_updated') THEN
    CREATE TRIGGER trg_contacts_updated BEFORE UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_cadences_updated') THEN
    CREATE TRIGGER trg_cadences_updated BEFORE UPDATE ON cadences FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_auth_updated') THEN
    CREATE TRIGGER trg_auth_updated BEFORE UPDATE ON whatsapp_auth FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END;
$$;
