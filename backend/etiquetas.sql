-- Tabela de etiquetas do WhatsApp
CREATE TABLE IF NOT EXISTS whatsapp_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID,
  label_id TEXT UNIQUE,
  name TEXT,
  color TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Associação etiqueta ↔ chat
CREATE TABLE IF NOT EXISTS whatsapp_label_assocs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID,
  chat_jid TEXT,
  label_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(chat_jid, label_id, session_id)
);
