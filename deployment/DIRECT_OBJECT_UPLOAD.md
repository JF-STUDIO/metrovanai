# Direct Object Upload And Object Storage Migration

This prepares the upload and storage path for S3/R2-style browser direct uploads and persistent result storage.

## Current Default

The production site can still use the stable local proxy upload path:

```text
Browser -> api.metrovanai.com -> local Node backend -> local disk
```

Direct object upload is disabled unless all required environment variables are configured. Object storage mirroring can be configured earlier: the backend keeps using local disk, but mirrors HDR intermediates and final results into object storage so a future server can restore them without changing user records.

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
METROVAN_OBJECT_STORAGE_PERSISTENT_PREFIX=projects
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

The current completion endpoint pulls uploaded objects into local staging so the existing HDR grouping path can still run. For final Runpod production, use direct upload plus remote object I/O so the worker reads object keys or presigned URLs directly.

## Persistent Object Mirroring

When `METROVAN_OBJECT_STORAGE_*` is configured, the backend mirrors important files under:

```text
<METROVAN_OBJECT_STORAGE_PERSISTENT_PREFIX>/<userKey>/<projectId>/
```

Current categories:

- `hdr/` merged HDR JPG files
- `work/` remote-worker input copies
- `results/` final edited images

The database keeps `storageKey` values on project records. If a local result file is missing after moving servers, protected result routes and ZIP downloads try to restore the file from object storage before returning 404.

This means local testing can continue now, while production can later move compute and storage without breaking existing user/project records.

## Production Next Step

For true Google Drive-like speed and reliability, add multipart/resumable object uploads:

- Create multipart upload.
- Presign each part.
- Upload parts in parallel.
- Retry only failed parts.
- Complete multipart upload.
- Persist upload state so refresh can resume.
