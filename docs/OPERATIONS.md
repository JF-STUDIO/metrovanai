# Metrovan AI Operations

## Automated Checks

CI runs on every push and pull request:

- `pnpm test:critical`
- client lint
- server build
- client build

The production monitor runs hourly and can also be started manually from GitHub Actions. It checks:

- public frontend availability
- API health
- latest Render deployment status
- database connectivity and metadata table access
- R2 object storage list access
- commercial readiness endpoints

## GitHub Secrets For Production Monitor

Configure these repository secrets so the scheduled monitor can check the full stack:

- `METROVAN_CHECK_ADMIN_KEY`
- `METROVAN_RENDER_PRODUCTION_SERVICE_ID`
- `RENDER_API_KEY`
- `SUPABASE_DB_URL` or `DATABASE_URL` or `POSTGRES_URL`
- `METROVAN_METADATA_TABLE`
- `METROVAN_METADATA_DOCUMENT_ID`
- `METROVAN_POSTGRES_SSL`
- `METROVAN_OBJECT_STORAGE_ENDPOINT`
- `METROVAN_OBJECT_STORAGE_BUCKET`
- `METROVAN_OBJECT_STORAGE_ACCESS_KEY_ID`
- `METROVAN_OBJECT_STORAGE_SECRET_ACCESS_KEY`
- `METROVAN_OBJECT_STORAGE_REGION`
- `METROVAN_OBJECT_STORAGE_FORCE_PATH_STYLE`
- `METROVAN_OBJECT_STORAGE_INCOMING_PREFIX`
- `METROVAN_OBJECT_STORAGE_PERSISTENT_PREFIX`

If a secret is missing, the monitor skips only the related deep check and still runs public availability checks.

## Manual Checks

Run these before or after production deploys:

```bash
pnpm test:critical
pnpm --filter metrovan-ai-client lint
pnpm --filter metrovan-ai-server build
pnpm --filter metrovan-ai-client build
pnpm maintain:check
pnpm check:commercial
```
