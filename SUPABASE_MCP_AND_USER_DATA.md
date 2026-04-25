# Supabase MCP And User Data Setup

This project now supports switching metadata from local `server-runtime/db.json` to Supabase Postgres.

## 1. Supabase MCP

Codex does not currently have the Supabase MCP server mounted in this session. To add it to an MCP client, use Supabase's hosted MCP endpoint:

```json
{
  "mcpServers": {
    "supabase": {
      "url": "https://mcp.supabase.com/mcp?project_ref=YOUR_PROJECT_REF&read_only=true"
    }
  }
}
```

Use `read_only=true` for production. Use write access only on development projects.

## 2. Connect User Data To Supabase Postgres

In Supabase, copy the direct Postgres connection string from:

`Project Settings -> Database -> Connection string`

Use the URI format and replace `[YOUR-PASSWORD]`.

Then update:

`deployment/local-server.production.json`

```json
{
  "metadataProvider": "postgres-json",
  "supabaseDbUrl": "postgresql://postgres.xxx:YOUR_PASSWORD@aws-0-us-west-1.pooler.supabase.com:6543/postgres",
  "metadataTable": "metrovan_metadata",
  "metadataDocumentId": "default",
  "postgresSsl": true
}
```

Restart the backend:

```powershell
. .\launcher\MetrovanAI.Common.ps1
Stop-TrackedProcess -Key 'backendPid'
Start-Sleep -Seconds 2
Start-BackendProcess
```

On first start, if Supabase has no metadata row yet, the server automatically initializes Supabase from the existing local `server-runtime/db.json`.

The local `db.json` remains as a backup cache.

## 3. What Moves To Supabase

The Supabase-backed metadata document includes:

- users
- sessions
- password reset tokens
- email verification tokens
- projects
- billing entries
- activation codes

Storage files and generated images still remain on local disk until the storage provider is switched to S3.

## 4. Later Production Split

This is the safe bridge step. Later, when traffic grows, split the JSON document into proper relational tables:

- `users`
- `sessions`
- `projects`
- `project_assets`
- `billing_entries`
- `activation_codes`
- `auth_tokens`

At that point, move storage from local disk to S3 and task execution to Runpod.
