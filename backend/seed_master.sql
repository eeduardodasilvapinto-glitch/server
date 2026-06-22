-- ============================================================
-- VELTRIS — Seed Completo (Backend)
-- Execute no SQL Editor do Supabase
-- ============================================================

-- ============================================================
-- 1. ESTRUTURA (se ainda não existir)
-- ============================================================

CREATE TABLE IF NOT EXISTS companies (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  active BOOLEAN DEFAULT true,
  permissions JSONB DEFAULT '{}',
  phone TEXT,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS company_users (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  password TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id, name)
);

CREATE TABLE IF NOT EXISTS company_sessions (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT REFERENCES companies(id) ON DELETE CASCADE,
  user_id BIGINT REFERENCES company_users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_settings (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT REFERENCES companies(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id, key)
);

-- ============================================================
-- 2. EMPRESA MASTER (Admin)
-- ============================================================

INSERT INTO companies (name, active, permissions)
SELECT 'Admin', true, '{
  "dashboard": {"access": true},
  "conteudos": {"access": true},
  "financeiro": {"access": true},
  "ia": {"access": true},
  "crm": {"access": true},
  "metricas": {"access": true},
  "analise": {"access": true},
  "wpp": {"access": true},
  "empresas": {"access": true},
  "usuarios": {"access": true}
}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM companies WHERE name = 'Admin');

UPDATE companies SET active = true WHERE name = 'Admin';

-- ============================================================
-- 3. USUÁRIO MASTER (Eduardo Silva / 051627)
-- ============================================================
-- Hash SHA-256 de '051627' = 8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92

INSERT INTO company_users (company_id, name, password, role, active)
SELECT c.id, 'Eduardo Silva', '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92', 'admin', true
FROM companies c
WHERE c.name = 'Admin'
  AND NOT EXISTS (
    SELECT 1 FROM company_users cu
    WHERE cu.company_id = c.id AND cu.name = 'Eduardo Silva'
  );

-- ============================================================
-- 4. CONFIGURAÇÕES (OpenRouter IA)
-- ============================================================

INSERT INTO app_settings (company_id, key, value)
SELECT c.id, 'openrouter_api_key', ''
FROM companies c
WHERE c.name = 'Admin'
  AND NOT EXISTS (
    SELECT 1 FROM app_settings s
    WHERE s.company_id = c.id AND s.key = 'openrouter_api_key'
  );

INSERT INTO app_settings (company_id, key, value)
SELECT c.id, 'openrouter_model', 'openai/gpt-4o-mini'
FROM companies c
WHERE c.name = 'Admin'
  AND NOT EXISTS (
    SELECT 1 FROM app_settings s
    WHERE s.company_id = c.id AND s.key = 'openrouter_model'
  );

-- ============================================================
-- 5. CONFIRMAÇÃO
-- ============================================================

SELECT 
  c.name AS empresa,
  c.active AS empresa_ativa,
  cu.name AS usuario,
  cu.role,
  cu.active AS usuario_ativo
FROM companies c
JOIN company_users cu ON cu.company_id = c.id
WHERE c.name = 'Admin';

SELECT key, value FROM app_settings WHERE company_id = (SELECT id FROM companies WHERE name = 'Admin');

-- Seed completo! Acesse com: Empresa=Admin | Usuario=Eduardo Silva | Senha=051627
