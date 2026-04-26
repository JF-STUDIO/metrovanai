# Runpod Deploy Steps

This file is the short operational checklist for moving processing off the local computer without changing the current site first.

## 1. Local smoke test

```powershell
pnpm smoke:runpod-worker
```

This validates the worker command contract with a tiny JPG. It does not require Docker or R2.

## 2. Build Docker image with GitHub Actions

The repository includes `.github/workflows/runpod-worker-image.yml`.

After pushing this code to GitHub, open:

```text
GitHub repo -> Actions -> Runpod Worker Image -> Run workflow
```

The workflow will:

- Install Python dependencies.
- Run `pnpm smoke:runpod-worker`.
- Build `runpod-worker/Dockerfile`.
- Push the image to GitHub Container Registry.

The image name will be:

```text
ghcr.io/<github-owner>/<repo-name>-runpod-worker:latest
```

For your repo, it should be:

```text
ghcr.io/jf-studio/metrovanai-runpod-worker:latest
```

Use that image in Runpod Serverless.

## 3. Local Docker build fallback

Install Docker Desktop first, then run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Build-RunpodWorker.ps1 -ImageName metrovanai-runpod-worker -Tag local
```

The image includes:

- `rawtherapee-cli` for RAW rendering and lens auto-correction.
- `align_image_stack` and `enfuse` for HDR alignment/fusion.
- `metrovan_processor.py` for RAW/JPG processing and regeneration contract handling.

## 4. Manual push fallback

Push the image to your container registry, for example GitHub Container Registry or Docker Hub:

```powershell
docker tag metrovanai-runpod-worker:local <registry>/<name>:<tag>
docker push <registry>/<name>:<tag>
```

## 5. Create Runpod Serverless Endpoint

Use the pushed image and set these worker env vars:

```text
METROVAN_R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
METROVAN_R2_BUCKET=metrovanai-production
METROVAN_R2_ACCESS_KEY_ID=...
METROVAN_R2_SECRET_ACCESS_KEY=...
METROVAN_R2_REGION=auto
METROVAN_PROCESSOR_COMMAND=python /app/metrovan_processor.py
METROVAN_REGEN_COMMAND=python /app/metrovan_processor.py
```

## 6. Test on staging API only

Do not set this on the current production API until staging passes.

```text
METROVAN_TASK_EXECUTOR=runpod-native
METROVAN_RUNPOD_ENDPOINT_ID=<endpoint-id>
METROVAN_RUNPOD_API_KEY=<runpod-api-key>
METROVAN_RUNPOD_MAX_IN_FLIGHT=5
METROVAN_RUNPOD_TIMEOUT_SECONDS=3600
```

Current staging service:

```text
Render service: metrovan-ai-api-staging-runpod
Render service ID: srv-d7muks8g4nts73as4aog
URL: https://metrovan-ai-api-staging-runpod.onrender.com
Plan: free
Executor: runpod-native
Runpod endpoint ID: o6c6hpr520oxmi
Image: ghcr.io/jf-studio/metrovanai-runpod-worker:latest
```

Validation already completed on 2026-04-26:

```text
Runpod worker smoke job: passed
Staging deploy: live
Staging /api/health: passed
Staging direct R2 upload capability: enabled
Commercial readiness check against staging: 0 failed public checks
```

The staging API uses the same production database and R2 bucket. Keep full upload/process tests limited to a deliberate test account or a known disposable project so production user data is not accidentally changed.

## 7. Rollback

Remove `METROVAN_TASK_EXECUTOR` or set:

```text
METROVAN_TASK_EXECUTOR=local-runninghub
```

Restart the API. Existing users, billing, projects, and R2 files stay unchanged.
