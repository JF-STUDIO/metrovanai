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
      status: objectStorageEnvReady ? 'ready' : 'planned',
      current: objectStorageEnvReady ? 'configured' : 'not configured',
      next: 'Future S3/R2 provider should read METROVAN_OBJECT_STORAGE_* variables exported by the launcher.'
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
