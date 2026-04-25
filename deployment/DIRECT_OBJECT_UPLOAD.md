# Direct Object Upload Migration

This prepares the upload path for S3/R2-style browser direct uploads.

## Current Default

The production site still uses the stable local proxy upload path:

```text
Browser -> api.metrovanai.com -> local Node backend -> local disk
```

Direct object upload is present but disabled unless all required environment variables are configured.

## Target Architecture

```text
Browser -> S3/R2 object storage
Backend -> records object keys and starts processing
Runpod/worker -> reads from object storage and writes results back
```

This removes the local Cloudflare Tunnel and local Node process from the large-file upload path.

## Required Environment

Set these on the backend when object storage is ready:

```env
METROVAN_DIRECT_UPLOAD_ENABLED=true
METROVAN_OBJECT_STORAGE_ENDPOINT=https://<account>.r2.cloudflarestorage.com
METROVAN_OBJECT_STORAGE_BUCKET=metrovan-uploads
METROVAN_OBJECT_STORAGE_ACCESS_KEY_ID=...
METROVAN_OBJECT_STORAGE_SECRET_ACCESS_KEY=...
METROVAN_OBJECT_STORAGE_REGION=auto
METROVAN_OBJECT_STORAGE_FORCE_PATH_STYLE=false
METROVAN_OBJECT_STORAGE_INCOMING_PREFIX=incoming
METROVAN_OBJECT_UPLOAD_EXPIRES_SECONDS=900
METROVAN_OBJECT_UPLOAD_MAX_FILE_BYTES=2147483648
```

For AWS S3, use the S3 endpoint and real region, for example `us-west-2`.

## Bucket CORS

The bucket must allow browser uploads from the production domain:

```json
[
  {
    "AllowedOrigins": ["https://metrovanai.com", "https://www.metrovanai.com"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["etag"],
    "MaxAgeSeconds": 3600
  }
]
```

## API Flow

1. Frontend calls `GET /api/upload/capabilities`.
2. If `directObject.enabled` is false, it uses current local upload.
3. If enabled, frontend calls `POST /api/projects/:id/direct-upload/targets`.
4. Browser uploads each file directly to the returned signed `PUT` URL.
5. Frontend calls `POST /api/projects/:id/direct-upload/complete`.

The current completion endpoint pulls uploaded objects into local staging so the existing HDR grouping path can still run. For final Runpod production, replace that completion behavior with a job record that lets the worker read object keys directly.

## Production Next Step

For true Google Drive-like speed and reliability, add multipart/resumable object uploads:

- Create multipart upload.
- Presign each part.
- Upload parts in parallel.
- Retry only failed parts.
- Complete multipart upload.
- Persist upload state so refresh can resume.
