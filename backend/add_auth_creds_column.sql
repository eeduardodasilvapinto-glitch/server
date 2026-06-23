-- Adiciona coluna para armazenar credenciais do WhatsApp (persiste entre deploys do Railway)
ALTER TABLE whatsapp_sessions ADD COLUMN IF NOT EXISTS auth_creds JSONB;
