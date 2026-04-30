function isEnabledEnv(name: string) {
  const value = String(process.env[name] ?? '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

export function isProductionRuntime() {
  return process.env.NODE_ENV === 'production' || isEnabledEnv('METROVAN_CLOUD_ONLY_MODE');
}

export function assertCloudProductionRuntime() {
  if (!isProductionRuntime() || isEnabledEnv('METROVAN_ALLOW_LOCAL_PRODUCTION')) {
    return;
  }

  const missing: string[] = [];
  const metadataProvider = String(process.env.METROVAN_METADATA_PROVIDER ?? '').trim().toLowerCase();
  const taskExecutor = String(process.env.METROVAN_TASK_EXECUTOR ?? '').trim().toLowerCase();

  if (!['postgres-json', 'supabase-postgres'].includes(metadataProvider)) {
    missing.push('METROVAN_METADATA_PROVIDER=postgres-json');
  }
  if (!String(process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? '').trim()) {
    missing.push('SUPABASE_DB_URL or DATABASE_URL');
  }
  if (!isEnabledEnv('METROVAN_DIRECT_UPLOAD_ENABLED')) {
    missing.push('METROVAN_DIRECT_UPLOAD_ENABLED=true');
  }

  for (const key of [
    'METROVAN_OBJECT_STORAGE_ENDPOINT',
    'METROVAN_OBJECT_STORAGE_BUCKET',
    'METROVAN_OBJECT_STORAGE_ACCESS_KEY_ID',
    'METROVAN_OBJECT_STORAGE_SECRET_ACCESS_KEY'
  ]) {
    if (!String(process.env[key] ?? '').trim()) {
      missing.push(key);
    }
  }

  if (!['runpod-native', 'runpod-serverless'].includes(taskExecutor)) {
    missing.push('METROVAN_TASK_EXECUTOR=runpod-native');
  }
  if (taskExecutor === 'runpod-native' || taskExecutor === 'runpod-serverless') {
    for (const key of ['METROVAN_RUNPOD_ENDPOINT_ID', 'METROVAN_RUNPOD_API_KEY']) {
      if (!String(process.env[key] ?? '').trim()) {
        missing.push(key);
      }
    }
  }

  if (missing.length) {
    throw new Error(`Cloud production configuration is incomplete: ${Array.from(new Set(missing)).join(', ')}`);
  }
}

export function isLocalProxyUploadEnabled() {
  return !isProductionRuntime() || isEnabledEnv('METROVAN_LOCAL_PROXY_UPLOAD_ENABLED');
}
