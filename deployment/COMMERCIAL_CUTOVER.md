# Metrovan AI Commercial Cutover

This is the switch plan for moving from the current local-computer test mode to a production stack that does not depend on this PC.

## Current Safe Mode

```text
metrovanai.com frontend
api.metrovanai.com -> local computer / Cloudflare Tunnel
Supabase Postgres JSON metadata
local disk photo storage
local RunningHub workflow bridge
```

This mode is valid for short functional testing only. If this computer is off, sleeping, disconnected, or the local process crashes, processing and API features can stop.

## Target Commercial Mode

```text
metrovanai.com frontend CDN
api.metrovanai.com -> Render backend
Supabase Postgres metadata
Cloudflare R2 or AWS S3 object storage
Runpod HTTP worker for photo processing
Stripe live payments
Resend verified email domain
```

## Cutover Order

1. Confirm GitHub main branch is current.
2. Keep Supabase metadata provider on Render:

```env
METROVAN_METADATA_PROVIDER=postgres-json
SUPABASE_DB_URL=<supabase-pooler-url>
METROVAN_METADATA_TABLE=metrovan_metadata
METROVAN_METADATA_DOCUMENT_ID=default
METROVAN_POSTGRES_SSL=true
```

3. Configure R2/S3 bucket and CORS.
4. Add object storage env to Render:

```env
METROVAN_DIRECT_UPLOAD_ENABLED=true
METROVAN_OBJECT_STORAGE_ENDPOINT=<r2-or-s3-endpoint>
METROVAN_OBJECT_STORAGE_BUCKET=<bucket>
METROVAN_OBJECT_STORAGE_ACCESS_KEY_ID=<key-id>
METROVAN_OBJECT_STORAGE_SECRET_ACCESS_KEY=<secret>
METROVAN_OBJECT_STORAGE_REGION=auto
METROVAN_OBJECT_STORAGE_FORCE_PATH_STYLE=false
METROVAN_OBJECT_STORAGE_INCOMING_PREFIX=incoming
METROVAN_OBJECT_STORAGE_PERSISTENT_PREFIX=projects
```

5. Deploy Runpod worker implementing `deployment/RUNPOD_WORKER_CONTRACT.md`.
6. Add Runpod env to Render:

```env
METROVAN_TASK_EXECUTOR=runpod-http
METROVAN_REMOTE_EXECUTOR_URL=<runpod-worker-url>
METROVAN_REMOTE_EXECUTOR_TOKEN=<shared-secret>
METROVAN_REMOTE_EXECUTOR_MAX_IN_FLIGHT=5
METROVAN_REMOTE_EXECUTOR_OBJECT_IO=true
```

7. Verify payments and email:

```env
METROVAN_STRIPE_SECRET_KEY=<stripe-live-secret>
METROVAN_STRIPE_WEBHOOK_SECRET=<stripe-live-webhook-secret>
PUBLIC_APP_URL=https://metrovanai.com
```

8. Run:

```powershell
node .\scripts\check-commercial-readiness.mjs
```

9. Point `api.metrovanai.com` DNS to the Render service only after checks pass.

## No-Data-Loss Rule

User/project/billing data stays in Supabase `metrovan_metadata/default`. Object storage keys are saved inside the same project records. Do not reset or replace this document during cutover.

## Rollback

If Runpod or R2 is not stable, switch only these Render env values back:

```env
METROVAN_TASK_EXECUTOR=local-runninghub
METROVAN_REMOTE_EXECUTOR_OBJECT_IO=false
METROVAN_DIRECT_UPLOAD_ENABLED=false
```

This returns large uploads and processing to the old local-compatible path while keeping the same users, billing, and projects.
