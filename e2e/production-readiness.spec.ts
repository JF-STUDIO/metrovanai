import { expect, test } from '@playwright/test';

const frontendUrl = (process.env.METROVAN_CHECK_FRONTEND_URL || 'https://metrovanai.com').replace(/\/+$/, '');
const apiRoot = (process.env.METROVAN_CHECK_API_ROOT || 'https://api.metrovanai.com').replace(/\/+$/, '');
const adminKey = process.env.METROVAN_CHECK_ADMIN_KEY || '';

test('production home enforces strict security headers', async ({ request }) => {
  const response = await request.get(`${frontendUrl}/home`);
  expect(response.ok()).toBeTruthy();

  const csp = response.headers()['content-security-policy'] || '';
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("style-src 'self'");
  expect(csp).not.toContain("'unsafe-inline'");
  expect(response.headers()['x-frame-options']).toBe('DENY');
  expect(response.headers()['x-content-type-options']).toBe('nosniff');
  expect(response.headers()['strict-transport-security']).toContain('max-age=31536000');
});

test('production API exposes safe anonymous readiness', async ({ request }) => {
  const health = await request.get(`${apiRoot}/api/health`);
  expect(health.ok()).toBeTruthy();
  await expect(health.json()).resolves.toEqual({ ok: true, service: 'metrovan-ai-api' });

  const session = await request.get(`${apiRoot}/api/auth/session`);
  expect(session.ok()).toBeTruthy();
  await expect(session.json()).resolves.toEqual({ session: null });

  const capabilities = await request.get(`${apiRoot}/api/upload/capabilities`);
  expect(capabilities.ok()).toBeTruthy();
  const payload = await capabilities.json();
  expect(payload.localProxy.enabled).toBe(false);
  expect(payload.directObject.enabled).toBe(true);
  expect(payload.directObject.uploadExpiresSeconds).toBeGreaterThanOrEqual(1800);
  expect(payload.directUploadTargets.maxFiles).toBeGreaterThanOrEqual(100);
});

test('production admin readiness has no action-required checks', async ({ request }) => {
  test.skip(!adminKey, 'Set METROVAN_CHECK_ADMIN_KEY to include admin readiness in E2E.');

  const response = await request.get(`${apiRoot}/api/admin/readiness`, {
    headers: {
      'x-metrovan-admin-key': adminKey
    }
  });
  expect(response.ok()).toBeTruthy();

  const payload = await response.json();
  expect(payload.mode).toBe('commercial-ready');
  const required = payload.checks.filter((check: { status: string }) => check.status === 'action-required');
  expect(required).toEqual([]);
});
