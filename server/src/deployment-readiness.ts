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
  const remoteHttpExecutorEnvReady = hasEnv('METROVAN_REMOTE_EXECUTOR_URL');
  const runpodNativeExecutorEnvReady = hasEnv('METROVAN_RUNPOD_ENDPOINT_ID') && hasEnv('METROVAN_RUNPOD_API_KEY');
  const remoteExecutorEnvReady = remoteHttpExecutorEnvReady || runpodNativeExecutorEnvReady;
  const remoteObjectTransportReady =
    (remoteObjectIoEnabled || runpodNativeExecutorEnvReady) && objectStorageEnvReady && objectStorageEndpointReady;
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
      status:
        input.storage.provider === 'local-disk' && !(objectStorageEnvReady && objectStorageEndpointReady)
          ? 'action-required'
          : 'ready',
      current: input.storage.provider,
      next:
        input.storage.provider === 'local-disk'
          ? objectStorageEnvReady && objectStorageEndpointReady
            ? 'Local disk is only scratch space. Persistent originals and results are backed by object storage.'
            : 'Configure R2/S3 object storage so local disk is not the persistent source of truth.'
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
      status: directUploadEnabled && objectStorageEnvReady && objectStorageEndpointReady ? 'ready' : 'action-required',
      current: directUploadEnabled ? 'enabled' : 'disabled',
      next:
        directUploadEnabled && objectStorageEnvReady && objectStorageEndpointReady
          ? 'Browser direct upload is enabled.'
          : 'Enable METROVAN_DIRECT_UPLOAD_ENABLED and configure R2/S3 before production traffic.'
    },
    {
      id: 'executor.provider',
      status: input.executor.provider === 'local-runninghub' ? 'action-required' : 'ready',
      current: describeProvider(input.executor),
      next:
        input.executor.provider === 'local-runninghub'
          ? 'Production must use METROVAN_TASK_EXECUTOR=runpod-native or runpod-http. Do not process customer photos on this computer.'
          : 'Remote executor provider is active.'
    },
    {
      id: 'executor.remote_env',
      status: remoteExecutorEnvReady ? 'ready' : 'action-required',
      current: remoteExecutorEnvReady ? 'configured' : 'not configured',
      next: runpodNativeExecutorEnvReady
        ? 'Runpod native env is configured. Worker input contract is metrovan.runpod.v1.'
        : 'For Runpod native set METROVAN_RUNPOD_ENDPOINT_ID and METROVAN_RUNPOD_API_KEY. For a custom adapter set METROVAN_REMOTE_EXECUTOR_URL.'
    },
    {
      id: 'executor.object_io',
      status: remoteObjectTransportReady ? 'ready' : 'planned',
      current: runpodNativeExecutorEnvReady ? 'required by runpod-native' : remoteObjectIoEnabled ? 'enabled' : 'disabled',
      next:
        remoteObjectTransportReady
          ? 'Remote executor can receive object keys/presigned URLs instead of large base64 payloads.'
          : 'After S3/R2 is configured, use runpod-native or set METROVAN_REMOTE_EXECUTOR_OBJECT_IO=true for the custom adapter.'
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
