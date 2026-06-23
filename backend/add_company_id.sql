-- ============================================================
-- Adiciona coluna company_id nas tabelas para isolamento
-- multi-tenant
-- ============================================================

-- 1. Adicionar a coluna company_id em cada tabela
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE cadence_actions ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE whatsapp_chats ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE whatsapp_sessions ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE kanban_columns ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE kanban_cards ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS company_id uuid;

-- 2. Popular registros existentes com o company_id correto
-- Substitua 'ID-DA-EMPRESA-AQUI' pelo UUID da empresa admin/master
UPDATE tasks SET company_id = '97e4d986-dd80-480e-a8de-81ad19e91348'::uuid WHERE company_id IS NULL;
UPDATE contacts SET company_id = '97e4d986-dd80-480e-a8de-81ad19e91348'::uuid WHERE company_id IS NULL;
UPDATE cadence_actions SET company_id = '97e4d986-dd80-480e-a8de-81ad19e91348'::uuid WHERE company_id IS NULL;
UPDATE whatsapp_chats SET company_id = '97e4d986-dd80-480e-a8de-81ad19e91348'::uuid WHERE company_id IS NULL;
UPDATE whatsapp_sessions SET company_id = '97e4d986-dd80-480e-a8de-81ad19e91348'::uuid WHERE company_id IS NULL;
UPDATE kanban_columns SET company_id = '97e4d986-dd80-480e-a8de-81ad19e91348'::uuid WHERE company_id IS NULL;
UPDATE kanban_cards SET company_id = '97e4d986-dd80-480e-a8de-81ad19e91348'::uuid WHERE company_id IS NULL;
UPDATE documents SET company_id = '97e4d986-dd80-480e-a8de-81ad19e91348'::uuid WHERE company_id IS NULL;

-- 3. (Opcional) Índice para performance
CREATE INDEX IF NOT EXISTS idx_tasks_company_id ON tasks (company_id);
CREATE INDEX IF NOT EXISTS idx_contacts_company_id ON contacts (company_id);
CREATE INDEX IF NOT EXISTS idx_cadence_actions_company_id ON cadence_actions (company_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_chats_company_id ON whatsapp_chats (company_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_company_id ON whatsapp_sessions (company_id);
CREATE INDEX IF NOT EXISTS idx_kanban_columns_company_id ON kanban_columns (company_id);
CREATE INDEX IF NOT EXISTS idx_kanban_cards_company_id ON kanban_cards (company_id);
CREATE INDEX IF NOT EXISTS idx_documents_company_id ON documents (company_id);

-- 4. (Opcional) Row Level Security - descomente se quiser
-- ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS company_isolation ON tasks;
-- CREATE POLICY company_isolation ON tasks
--   USING (company_id = (SELECT (current_setting('request.jwt.claims', true)::json ->> 'company_id')::uuid));

-- ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS company_isolation ON contacts;
-- CREATE POLICY company_isolation ON contacts
--   USING (company_id = (SELECT (current_setting('request.jwt.claims', true)::json ->> 'company_id')::uuid));
