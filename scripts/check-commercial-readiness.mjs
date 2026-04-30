const apiRoot = (process.env.METROVAN_CHECK_API_ROOT || 'https://api.metrovanai.com').replace(/\/+$/, '');
const adminKey = process.env.METROVAN_CHECK_ADMIN_KEY || '';
const strictChecks = ['1', 'true', 'yes'].includes(String(process.env.METROVAN_CHECK_STRICT || '').toLowerCase());

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

async function checkSecurityHeaders() {
  try {
    const response = await fetch(`${apiRoot}/home`, { method: 'HEAD' });
    const csp =
      response.headers.get('content-security-policy') ||
      response.headers.get('content-security-policy-report-only') ||
      '';
    const frameOptions = response.headers.get('x-frame-options') || '';
    const contentTypeOptions = response.headers.get('x-content-type-options') || '';
    const styleUnsafeInline = /(?:^|;)\s*style-src\s+[^;]*'unsafe-inline'/.test(csp);
    record('security_headers', Boolean(csp) && frameOptions.toUpperCase() === 'DENY' && contentTypeOptions === 'nosniff', {
      status: response.status,
      csp: Boolean(csp),
      xFrameOptions: frameOptions,
      xContentTypeOptions: contentTypeOptions
    });
    record('strict_csp_ready', !styleUnsafeInline, {
      status: response.status,
      styleUnsafeInline,
      note: styleUnsafeInline
        ? 'style-src still allows unsafe-inline; enable METROVAN_STRICT_CSP after dynamic inline styles are migrated.'
        : 'style-src does not allow unsafe-inline.'
    });
  } catch (error) {
    record('security_headers', false, { error: error instanceof Error ? error.message : String(error) });
    record('strict_csp_ready', false, { error: error instanceof Error ? error.message : String(error) });
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
    if (strictChecks) {
      record('direct_object_upload_expiry', Number(upload.payload.directObject.uploadExpiresSeconds ?? 0) >= 1800, {
        uploadExpiresSeconds: upload.payload.directObject.uploadExpiresSeconds
      });
    }
  }
  if (upload.payload?.localProxy) {
    record('no_production_local_proxy_upload', upload.payload.localProxy.enabled === false, {
      enabled: Boolean(upload.payload.localProxy.enabled)
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

  if (strictChecks) {
    await checkSecurityHeaders();
  }

  const failed = checks.filter((check) => !check.ok);
  console.log(JSON.stringify({ done: true, apiRoot, failed: failed.length }));
  if (failed.length) {
    process.exitCode = 1;
  }
}

await main();
