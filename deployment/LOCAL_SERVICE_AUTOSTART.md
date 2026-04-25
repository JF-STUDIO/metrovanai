# Metrovan AI Local Service

## Files
- `deployment/local-server.production.json`
- `launcher/MetrovanAI.Common.ps1`
- `launcher/MetrovanAI.Service.ps1`
- `launcher/Register-MetrovanAIAutostart.ps1`

## Build
```powershell
pnpm build
```

## Production config
Fill real values in `deployment/local-server.production.json`.

Important fields:
- `localServerPort`
- `metadataProvider`
- `storageProvider`
- `taskExecutor`
- `googleClientId`
- `googleClientSecret`
- `googleRedirectUri`
- `watchdog.pollSeconds`

If the Google fields stay empty, Google sign-in remains disabled.

## Run one health-check pass
```powershell
powershell -ExecutionPolicy Bypass -File .\launcher\MetrovanAI.Service.ps1 -SinglePass
```

## Run the watchdog continuously
```powershell
powershell -ExecutionPolicy Bypass -File .\launcher\MetrovanAI.Service.ps1
```

The watchdog:
- starts the backend if the local API health check fails and no backend is listening
- starts `cloudflared` if its process is missing
- restarts the backend if local health stays bad past the grace window
- restarts `cloudflared` if local health is good but public API health keeps failing

## Register Windows auto-start
```powershell
powershell -ExecutionPolicy Bypass -File .\launcher\Register-MetrovanAIAutostart.ps1 -StartNow
```

This registers:
- a startup shortcut: `MetrovanAI Watchdog.lnk`
- a scheduled task: `MetrovanAI Watchdog Recovery`

The service script uses a named mutex, so repeated launches do not create duplicate watchdog loops.

## Logs
- `server-runtime\logs\server.log`
- `server-runtime\logs\server.err.log`
- `server-runtime\logs\cloudflared.log`
- `server-runtime\logs\cloudflared.err.log`
- `server-runtime\logs\watchdog.log`
