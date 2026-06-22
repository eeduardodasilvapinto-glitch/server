-- ============================================================
-- VELTRIS — Schema Completo do Banco
-- Execute no SQL Editor do Supabase
-- ============================================================

-- ============================================================
-- MULTI-TENANT
-- ============================================================
CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  active BOOLEAN DEFAULT true,
  permissions JSONB DEFAULT '{}',
  phone TEXT,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS company_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  password TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id, name)
);

CREATE TABLE IF NOT EXISTS company_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES company_users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- CONFIGURAÇÕES E SETTINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS app_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id, key)
);

CREATE TABLE IF NOT EXISTS settings (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- TASKS / CHECKLIST
-- ============================================================
CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  sector TEXT,
  title TEXT,
  done BOOLEAN DEFAULT false,
  score INTEGER DEFAULT 50,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_checklist (
  id SERIAL PRIMARY KEY,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- KANBAN
-- ============================================================
CREATE TABLE IF NOT EXISTS kanban_columns (
  id SERIAL PRIMARY KEY,
  sector TEXT,
  title TEXT,
  ord INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kanban_cards (
  id SERIAL PRIMARY KEY,
  column_id INTEGER REFERENCES kanban_columns(id) ON DELETE CASCADE,
  title TEXT,
  description TEXT,
  ord INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_kanban (
  id SERIAL PRIMARY KEY,
  data JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- IA / CONVERSATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS app_conversations (
  id SERIAL PRIMARY KEY,
  user_id TEXT,
  title TEXT,
  messages JSONB DEFAULT '[]',
  type TEXT DEFAULT 'main',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_suggestions (
  id SERIAL PRIMARY KEY,
  titulo TEXT,
  descricao TEXT,
  categoria TEXT,
  impacto TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_analyses (
  id SERIAL PRIMARY KEY,
  user_id TEXT,
  title TEXT,
  content JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_feedback (
  id SERIAL PRIMARY KEY,
  user_id TEXT,
  message TEXT,
  rating INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- DOCUMENTOS / KNOWLEDGE BASE
-- ============================================================
CREATE TABLE IF NOT EXISTS documents (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  content_text TEXT,
  sector TEXT,
  min_role TEXT DEFAULT 'colaborador',
  file_path TEXT,
  file_name TEXT,
  file_size BIGINT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- CRM / LEADS
-- ============================================================
CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  source TEXT DEFAULT 'manual',
  stage TEXT DEFAULT 'novo',
  score INTEGER DEFAULT 0,
  tags JSONB DEFAULT '[]',
  notes TEXT,
  ai_insight TEXT,
  last_contacted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- WHATSAPP
-- ============================================================
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
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

-- ============================================================
-- CADÊNCIAS
-- ============================================================
CREATE TABLE IF NOT EXISTS cadences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT DEFAULT 'Nova Cadência',
  steps JSONB DEFAULT '[]',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cadence_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  cadence_id UUID REFERENCES cadences(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  message TEXT,
  description TEXT,
  scheduled_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending',
  contact_name TEXT,
  lead_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- TRIGGERS
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY['companies','company_users','contacts','whatsapp_sessions','cadences','app_checklist','app_kanban','app_conversations'])
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_' || t || '_updated') THEN
      EXECUTE format('CREATE TRIGGER trg_%I_updated BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at()', t, t);
    END IF;
  END LOOP;
END;
$$;
