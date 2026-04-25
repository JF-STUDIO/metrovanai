# Metrovan AI Remote Worker Contract

This document defines the first remote executor contract for moving Metrovan AI processing off the local machine and onto a Runpod-hosted worker.

## Purpose
- Keep the current public API unchanged.
- Keep the current local site usable.
- Allow the backend to switch from `local-runninghub` to `runpod-http` with config only.
- Offload workflow execution first, while keeping local HDR merge in place.

## Local backend config
Set these values in `deployment/local-server.production.json` when you want to use the remote worker:

```json
{
  "taskExecutor": "runpod-http",
  "remoteExecutorBaseUrl": "https://your-runpod-worker.example.com",
  "remoteExecutorToken": "replace-with-a-long-random-secret",
  "remoteExecutorPollMs": 2500,
  "remoteExecutorTimeoutSeconds": 1800,
  "remoteExecutorMaxInFlight": 5
}
```

If `taskExecutor` remains `local-runninghub`, these values are ignored.

Equivalent environment variables are also supported:

```env
METROVAN_TASK_EXECUTOR=runpod-http
METROVAN_REMOTE_EXECUTOR_URL=https://your-runpod-worker.example.com
METROVAN_REMOTE_EXECUTOR_TOKEN=replace-with-a-long-random-secret
METROVAN_REMOTE_EXECUTOR_POLL_MS=2500
METROVAN_REMOTE_EXECUTOR_TIMEOUT_SECONDS=1800
METROVAN_REMOTE_EXECUTOR_MAX_IN_FLIGHT=5
METROVAN_REMOTE_EXECUTOR_OBJECT_IO=false
```

## Current split of responsibility

### Local backend still does
- user auth
- project ownership checks
- billing and point charging
- local RAW/EXIF grouping
- local white-balance correction
- local HDR merge at 3000 long edge
- final result persistence into project storage

### Remote worker does
- receive merged HDR image payload
- run the enhancement workflow
- expose job status
- return a final result image

## HTTP contract

### `POST /jobs`
Submit a merged HDR image for remote processing.

Request headers:
- `Content-Type: application/json`
- `Authorization: Bearer <token>` optional

Request body:
```json
{
  "projectId": "abc123",
  "hdrItemId": "hdr001",
  "title": "Kitchen 01",
  "sceneType": "interior",
  "colorMode": "default",
  "replacementColor": null,
  "inputFileName": "kitchen-01.jpg",
  "inputMimeType": "image/jpeg",
  "inputImageBase64": "<base64 jpeg>"
}
```

When S3/R2 object storage is configured and `METROVAN_REMOTE_EXECUTOR_OBJECT_IO=true`, the backend can send object references instead of base64:

```json
{
  "projectId": "abc123",
  "hdrItemId": "hdr001",
  "title": "Kitchen 01",
  "sceneType": "interior",
  "colorMode": "default",
  "replacementColor": null,
  "inputFileName": "kitchen-01.jpg",
  "inputMimeType": "image/jpeg",
  "inputStorageKey": "projects/user/project/work/kitchen-01.jpg",
  "inputDownloadUrl": "https://signed-download-url"
}
```

Response body:
```json
{
  "jobId": "job_123",
  "status": "queued",
  "detail": "accepted"
}
```

### `GET /jobs/:jobId`
Poll job status.

Response body while running:
```json
{
  "jobId": "job_123",
  "status": "processing",
  "progress": 42,
  "detail": "running workflow",
  "queuePosition": 0,
  "workflowName": "runpod-worker"
}
```

Response body when completed:
```json
{
  "jobId": "job_123",
  "status": "completed",
  "progress": 100,
  "detail": "done",
  "queuePosition": 0,
  "workflowName": "runpod-worker",
  "result": {
    "fileName": "kitchen-01.png",
    "base64Data": "<base64 image>"
  }
}
```

Alternative completed payload:
```json
{
  "jobId": "job_123",
  "status": "completed",
  "progress": 100,
  "result": {
    "fileName": "kitchen-01.png",
    "downloadUrl": "https://worker.example.com/results/job_123.png"
  }
}
```

Object-storage completed payload:
```json
{
  "jobId": "job_123",
  "status": "completed",
  "progress": 100,
  "result": {
    "fileName": "kitchen-01.png",
    "storageKey": "projects/user/project/results/kitchen-01.png"
  }
}
```

Failure payload:
```json
{
  "jobId": "job_123",
  "status": "failed",
  "detail": "workflow failed"
}
```

## Notes
- Base64 mode remains the compatibility fallback.
- Object I/O mode is the production path for large files because it avoids sending image bytes through JSON.
- The backend normalizes every remote result back into the existing project result record, so the public API and frontend do not change.
