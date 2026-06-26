-- Adiciona coluna de permissões por usuário
ALTER TABLE company_users ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{}';

-- Opcional: índice para consultas por permissões
CREATE INDEX IF NOT EXISTS idx_company_users_permissions ON company_users USING gin(permissions);
