const apiRoot = (process.env.METROVAN_CHECK_API_ROOT || 'https://metrovan-ai-api.onrender.com').replace(/\/+$/, '');
const adminKey = process.env.METROVAN_CHECK_ADMIN_KEY || '';

const checks = [];

function record(id, ok, details = {}) {
  const item = { id, ok, ...details };
  checks.push(item);
  console.log(JSON.stringify(item));
}

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

async function checkJson(id, path, options = {}) {
  try {
    const response = await fetch(`${apiRoot}${path}`, {
      headers: {
        Accept: 'application/json',
        ...(options.headers || {})
      }
    });
    const payload = await readJson(response);
    const ok = typeof options.expectStatus === 'number' ? response.status === options.expectStatus : response.ok;
    record(id, ok, { status: response.status, payload: options.includePayload === false ? undefined : payload });
    return { ok, status: response.status, payload };
  } catch (error) {
    record(id, false, { error: error instanceof Error ? error.message : String(error) });
    return { ok: false, status: 0, payload: null };
  }
}

async function checkHead(id, path) {
  try {
    const response = await fetch(`${apiRoot}${path}`, { method: 'HEAD' });
    record(id, response.ok, { status: response.status });
    return response.ok;
  } catch (error) {
    record(id, false, { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

async function main() {
  await checkJson('health', '/api/health', { includePayload: true });
  await checkHead('home_route', '/home');
  await checkJson('anonymous_session', '/api/auth/session', { expectStatus: 200, includePayload: true });

  const upload = await checkJson('upload_capabilities', '/api/upload/capabilities', { includePayload: true });
  if (upload.payload?.directObject) {
    record('direct_object_upload', Boolean(upload.payload.directObject.enabled), {
      enabled: Boolean(upload.payload.directObject.enabled),
      requiredEnv: upload.payload.directObject.requiredEnv
    });
  }

  if (adminKey) {
    const readiness = await checkJson('admin_readiness', '/api/admin/readiness', {
      headers: { 'x-metrovan-admin-key': adminKey },
      includePayload: true
    });
    const required = Array.isArray(readiness.payload?.checks)
      ? readiness.payload.checks.filter((check) => check.status === 'action-required')
      : [];
    record('admin_readiness_action_required', required.length === 0, {
      count: required.length,
      items: required.map((check) => ({ id: check.id, current: check.current, next: check.next }))
    });
  } else {
    record('admin_readiness', true, {
      skipped: true,
      reason: 'Set METROVAN_CHECK_ADMIN_KEY to include authenticated readiness checks.'
    });
  }

  const failed = checks.filter((check) => !check.ok);
  console.log(JSON.stringify({ done: true, apiRoot, failed: failed.length }));
  if (failed.length) {
    process.exitCode = 1;
  }
}

await main();
