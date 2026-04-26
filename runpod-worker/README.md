# Metrovan Runpod Worker

This is the production worker shell for moving photo processing off the local computer.
It is not enabled by default. The live site keeps using the current executor until Render env is switched.

## API contract

The API server submits jobs to Runpod Serverless using:

```text
POST https://api.runpod.ai/v2/{METROVAN_RUNPOD_ENDPOINT_ID}/run
GET  https://api.runpod.ai/v2/{METROVAN_RUNPOD_ENDPOINT_ID}/status/{jobId}
```

The job input contract is `metrovan.runpod.v1`.

Default processing jobs receive:

```json
{
  "contractVersion": "metrovan.runpod.v1",
  "workflowMode": "default",
  "exposures": [
    {
      "storageKey": "projects/user/project/originals/source.ARW",
      "downloadUrl": "https://signed-r2-url",
      "exposureCompensation": 0
    }
  ],
  "output": {
    "storageKey": "projects/user/project/results/result.jpg",
    "fileName": "result.jpg",
    "contentType": "image/jpeg"
  }
}
```

Regeneration jobs receive `workflowMode=regenerate`, `sourceImage`, and `colorCardNo`.

## Worker env

Set these in Runpod:

```text
METROVAN_R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
METROVAN_R2_BUCKET=metrovanai-production
METROVAN_R2_ACCESS_KEY_ID=...
METROVAN_R2_SECRET_ACCESS_KEY=...
METROVAN_R2_REGION=auto
```

Set your real image pipeline command:

```text
METROVAN_PROCESSOR_COMMAND=python /app/metrovan_processor.py
METROVAN_REGEN_COMMAND=python /app/metrovan_processor.py
```

The command receives:

```text
METROVAN_INPUT_DIR      # writable workspace directory
METROVAN_INPUT_JSON     # full job payload
METROVAN_OUTPUT_PATH    # write the final jpg here
```

The Docker image defaults to `metrovan_processor.py`, which performs RAW rendering with lens auto-correction, white-balance estimation, 3000px HDR alignment/fusion, and JPG output. If you later add a heavier AI/ComfyUI pipeline, replace the command with your own script while keeping the same input/output contract.

## Local checks

Run the lightweight command-contract smoke test:

```powershell
pnpm smoke:runpod-worker
```

Build the Docker image after Docker Desktop is installed:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Build-RunpodWorker.ps1 -ImageName metrovanai-runpod-worker -Tag local
```

The current machine must have Docker available for image build. The smoke test does not require Docker.

## Render cutover env

Do not set these on production until the Runpod endpoint has passed staging tests:

```text
METROVAN_TASK_EXECUTOR=runpod-native
METROVAN_RUNPOD_ENDPOINT_ID=...
METROVAN_RUNPOD_API_KEY=...
METROVAN_RUNPOD_MAX_IN_FLIGHT=5
METROVAN_RUNPOD_TIMEOUT_SECONDS=3600
METROVAN_RUNPOD_OBJECT_URL_EXPIRES_SECONDS=21600
```

Rollback is immediate: remove `METROVAN_TASK_EXECUTOR=runpod-native` or set it back to `local-runninghub`, then redeploy/restart the API.
