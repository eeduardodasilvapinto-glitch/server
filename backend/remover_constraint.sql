-- Remove a constraint de status da tabela whatsapp_messages
-- Necessário para permitir inserção de mensagens com status 'queued' e outros
ALTER TABLE whatsapp_messages DROP CONSTRAINT IF EXISTS whatsapp_messages_status_check;
