-- Corrige registros existentes que têm active = NULL
-- Após adicionar a coluna active com DEFAULT true, registros antigos
-- criados antes da migração ficaram com NULL

UPDATE companies SET active = true WHERE active IS NULL;
UPDATE company_users SET active = true WHERE active IS NULL;

-- Garante que a coluna existe e tem default
ALTER TABLE companies ALTER COLUMN active SET DEFAULT true;
ALTER TABLE company_users ALTER COLUMN active SET DEFAULT true;
