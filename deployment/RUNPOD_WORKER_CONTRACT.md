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
  "remoteExecutorMaxInFlight": 2
}
```

If `taskExecutor` remains `local-runninghub`, these values are ignored.

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

Failure payload:
```json
{
  "jobId": "job_123",
  "status": "failed",
  "detail": "workflow failed"
}
```

## Notes
- The current remote executor contract sends merged JPEG data as base64 because local storage is still disk-based.
- After storage moves to S3, the contract should switch from `inputImageBase64` to `inputStorageKey` or presigned URLs.
- The backend already normalizes the remote result back into a local JPEG result file so the rest of the product does not change.
