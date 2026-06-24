-- Adiciona coluna created_by na tabela contacts para isolar contatos por usuário
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES company_users(id) ON DELETE SET NULL;

-- Opcional: índice para consultas por created_by
CREATE INDEX IF NOT EXISTS idx_contacts_created_by ON contacts(created_by);
