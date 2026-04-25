# Metrovan AI Local Go-Live Notes

## Local paths
- Repo root: `C:\Users\zhouj\文档\网站制作\网站服务器接口`
- Runtime storage: `server-runtime`
- Frontend production API: `https://api.metrovanai.com`

## Start local backend
```powershell
pnpm --filter metrovan-ai-server dev
```

## Start frontend
```powershell
pnpm --filter metrovan-ai-client dev
```

## Build
```powershell
pnpm build
```

## Cloudflare tunnel
1. Copy `deployment/cloudflare-tunnel/config.template.yml` to `config.yml`
2. Replace the tunnel id placeholders
3. Run:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Start-CloudflareTunnel.ps1
```

## Local production config
`deployment/local-server.production.json` supports:

```json
{
  "adminApiKey": "",
  "googleClientId": "",
  "googleClientSecret": "",
  "googleRedirectUri": "https://api.metrovanai.com/api/auth/google/callback"
}
```

`adminApiKey` is optional for the public site, but required for the activation code admin API.

## Google OAuth env vars
To enable Google sign-in on the public domain, provide these environment variables before starting the backend:

```powershell
$env:GOOGLE_CLIENT_ID='your-google-client-id'
$env:GOOGLE_CLIENT_SECRET='your-google-client-secret'
$env:GOOGLE_REDIRECT_URI='https://api.metrovanai.com/api/auth/google/callback'
```

If `GOOGLE_REDIRECT_URI` is omitted, the server falls back to the current request origin and uses `/api/auth/google/callback`.

## Activation code admin API
Set an admin API key in `deployment/local-server.production.json`:

```json
{
  "adminApiKey": "replace-with-a-long-random-secret"
}
```

Available routes:

- `GET /api/admin/activation-codes`
- `POST /api/admin/activation-codes`
- `PATCH /api/admin/activation-codes/:id`

Send the key with either:

- `x-metrovan-admin-key: <your key>`
- or `Authorization: Bearer <your key>`

### List activation codes
```powershell
$headers = @{ 'x-metrovan-admin-key' = 'replace-with-a-long-random-secret' }
Invoke-RestMethod `
  -Uri 'http://127.0.0.1:8787/api/admin/activation-codes' `
  -Headers $headers
```

### Create an activation code
```powershell
$headers = @{
  'x-metrovan-admin-key' = 'replace-with-a-long-random-secret'
  'Content-Type' = 'application/json'
}

$body = @{
  code = 'BETA40'
  label = 'Beta 40 percent'
  active = $true
  packageId = 'recharge-2000'
  discountPercentOverride = 40
  bonusPoints = 0
  maxRedemptions = 50
  expiresAt = '2026-05-31T23:59:59Z'
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri 'http://127.0.0.1:8787/api/admin/activation-codes' `
  -Headers $headers `
  -Body $body
```

### Update an activation code
```powershell
$headers = @{
  'x-metrovan-admin-key' = 'replace-with-a-long-random-secret'
  'Content-Type' = 'application/json'
}

$body = @{
  active = $false
  maxRedemptions = 100
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Patch `
  -Uri 'http://127.0.0.1:8787/api/admin/activation-codes/<activation-code-id>' `
  -Headers $headers `
  -Body $body
```

## Current rebuild scope
- Project history
- Local-first photo import draft
- Manual groups
- Default/replacement color per group
- Activation code redemption and admin API
- Processing state shell

## Next rebuild step
- Add an authenticated internal admin page for activation code management
- Add a database-backed metadata provider
- Add a remote task executor provider for Runpod/serverless migration
