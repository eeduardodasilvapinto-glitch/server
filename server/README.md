# Veltris WhatsApp Server

Backend de conexao WhatsApp usando Baileys (conexao nao-oficial via WebSocket).

## Stack

- **Baileys** v7 - WebSocket direto com WhatsApp
- **Supabase** - banco de dados e sync com o frontend
- **qrcode** - geracao de QR code para autenticacao
- **pino** - logging

## Quick Start

```bash
npm install
cp .env.example .env
# Preencha SUPABASE_SERVICE_KEY no .env
npm start
```

## Variaveis de Ambiente (.env)

| Variavel | Obrigatorio | Descricao |
|----------|-------------|-----------|
| `SUPABASE_URL` | Sim | URL do projeto Supabase |
| `SUPABASE_SERVICE_KEY` | Sim | Service role key (Supabase > Settings > API) |
| `WPP_SESSION_NAME` | Nao | Nome da sessao (default: "default") |
| `WPP_AUTH_DIR` | Nao | Pasta de autenticacao Baileys (default: "./auth") |
| `LOG_LEVEL` | Nao | Nivel de log: trace, debug, info, warn, error (default: "info") |

## Deploy (Railway / Render / Fly.io)

1. Suba este diretorio como um servico Node.js
2. Configure as variaveis de ambiente
3. Rode `npm install && npm start`
4. O servidor vai gerar um QR code no banco (tabela `whatsapp_sessions`)
5. O frontend exibe o QR code automaticamente
6. Escaneie com o WhatsApp para conectar

### Railway

Conecte o repo, selecione `server/` como root directory, defina as env vars.

### Render

Crie um Web Service, root directory = `server`, build command = `npm install`, start command = `npm start`.

## Schema do Banco

Execute `schema.sql` no SQL Editor do Supabase para criar as tabelas.
