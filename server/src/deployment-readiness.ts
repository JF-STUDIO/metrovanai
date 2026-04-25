interface ProviderInfo {
  provider: string;
  location?: string;
  root?: string;
  workflowEngine?: string;
}

export interface DeploymentReadinessCheck {
  id: string;
  status: 'ready' | 'planned' | 'action-required';
  current: string;
  next: string;
}

function hasEnv(name: string) {
  return Boolean(String(process.env[name] ?? '').trim());
}

function isEnabledEnv(name: string) {
  const value = String(process.env[name] ?? '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

function describeProvider(info: ProviderInfo) {
  return info.workflowEngine ? `${info.provider}/${info.workflowEngine}` : info.provider;
}

export function buildDeploymentReadiness(input: {
  metadata: ProviderInfo;
  storage: ProviderInfo;
  executor: ProviderInfo;
}) {
  const objectStorageEnvReady =
    hasEnv('METROVAN_OBJECT_STORAGE_BUCKET') &&
    hasEnv('METROVAN_OBJECT_STORAGE_ACCESS_KEY_ID') &&
    hasEnv('METROVAN_OBJECT_STORAGE_SECRET_ACCESS_KEY');
  const objectStorageEndpointReady = hasEnv('METROVAN_OBJECT_STORAGE_ENDPOINT');
  const directUploadEnabled = isEnabledEnv('METROVAN_DIRECT_UPLOAD_ENABLED');
  const remoteObjectIoEnabled = isEnabledEnv('METROVAN_REMOTE_EXECUTOR_OBJECT_IO');
  const remoteExecutorEnvReady = hasEnv('METROVAN_REMOTE_EXECUTOR_URL');
  const stripeEnvReady = hasEnv('METROVAN_STRIPE_SECRET_KEY') && hasEnv('METROVAN_STRIPE_WEBHOOK_SECRET');
  const checks: DeploymentReadinessCheck[] = [
    {
      id: 'metadata.provider',
      status: input.metadata.provider === 'json-file' ? 'action-required' : 'ready',
      current: input.metadata.provider,
      next:
        input.metadata.provider === 'json-file'
          ? 'Set METROVAN_METADATA_PROVIDER=supabase-postgres or postgres-json before commercial launch.'
          : 'Metadata is already behind a Postgres-compatible provider.'
    },
    {
      id: 'storage.provider',
      status: input.storage.provider === 'local-disk' ? 'planned' : 'ready',
      current: input.storage.provider,
      next:
        input.storage.provider === 'local-disk'
          ? 'Keep local-disk for testing. For commercial cutover, implement s3-compatible using existing storageKey values.'
          : 'Object storage provider is active.'
    },
    {
      id: 'storage.object_env',
      status: objectStorageEnvReady && objectStorageEndpointReady ? 'ready' : 'planned',
      current: objectStorageEnvReady && objectStorageEndpointReady ? 'configured' : 'not configured',
      next:
        objectStorageEnvReady && objectStorageEndpointReady
          ? 'Object storage env is ready for persistent file mirroring and remote worker handoff.'
          : 'Set METROVAN_OBJECT_STORAGE_ENDPOINT, BUCKET, ACCESS_KEY_ID and SECRET_ACCESS_KEY before S3/R2 cutover.'
    },
    {
      id: 'storage.direct_upload',
      status: directUploadEnabled && objectStorageEnvReady && objectStorageEndpointReady ? 'ready' : 'planned',
      current: directUploadEnabled ? 'enabled' : 'disabled',
      next:
        directUploadEnabled && objectStorageEnvReady && objectStorageEndpointReady
          ? 'Browser direct upload is enabled.'
          : 'Keep disabled for local testing. Enable METROVAN_DIRECT_UPLOAD_ENABLED only after bucket CORS is configured.'
    },
    {
      id: 'executor.provider',
      status: input.executor.provider === 'local-runninghub' ? 'planned' : 'ready',
      current: describeProvider(input.executor),
      next:
        input.executor.provider === 'local-runninghub'
          ? 'Keep local-runninghub for testing. For Runpod, set taskExecutor=runpod-http and METROVAN_REMOTE_EXECUTOR_URL.'
          : 'Remote executor provider is active.'
    },
    {
      id: 'executor.remote_env',
      status: remoteExecutorEnvReady ? 'ready' : 'planned',
      current: remoteExecutorEnvReady ? 'configured' : 'not configured',
      next: 'Runpod worker must implement POST /jobs and GET /jobs/:id as documented in the commercial cutover contract.'
    },
    {
      id: 'executor.object_io',
      status: remoteObjectIoEnabled && objectStorageEnvReady && objectStorageEndpointReady ? 'ready' : 'planned',
      current: remoteObjectIoEnabled ? 'enabled' : 'disabled',
      next:
        remoteObjectIoEnabled && objectStorageEnvReady && objectStorageEndpointReady
          ? 'Remote executor can receive object keys/presigned URLs instead of base64 image payloads.'
          : 'After S3/R2 is configured, set METROVAN_REMOTE_EXECUTOR_OBJECT_IO=true to avoid large base64 payloads.'
    },
    {
      id: 'payment.stripe_env',
      status: stripeEnvReady ? 'ready' : 'action-required',
      current: stripeEnvReady ? 'configured' : 'not configured',
      next: 'Set METROVAN_STRIPE_SECRET_KEY and METROVAN_STRIPE_WEBHOOK_SECRET before accepting real payments.'
    }
  ];

  return {
    generatedAt: new Date().toISOString(),
    mode: checks.some((check) => check.status === 'action-required') ? 'test-ready' : 'commercial-ready',
    providers: {
      metadata: input.metadata,
      storage: input.storage,
      executor: input.executor
    },
    checks
  };
}
