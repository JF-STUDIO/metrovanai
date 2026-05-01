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

test('production protected APIs reject anonymous access', async ({ request }) => {
  const protectedReads = [
    `${apiRoot}/api/billing`,
    `${apiRoot}/api/projects`,
    `${apiRoot}/api/projects/anonymous-probe/download`,
    `${apiRoot}/api/admin/users`
  ];

  for (const url of protectedReads) {
    const response = await request.get(url);
    expect(response.ok()).toBeFalsy();
    expect([401, 403]).toContain(response.status());
  }

  const projectCreate = await request.post(`${apiRoot}/api/projects`, {
    data: { name: 'Anonymous probe' }
  });
  expect(projectCreate.ok()).toBeFalsy();
  expect([401, 403]).toContain(projectCreate.status());

  const checkoutCreate = await request.post(`${apiRoot}/api/billing/checkout`, {
    data: { packageId: 'recharge-100' }
  });
  expect(checkoutCreate.ok()).toBeFalsy();
  expect([401, 403]).toContain(checkoutCreate.status());
});

test('production dangerous admin mutations reject anonymous access', async ({ request }) => {
  const mutationProbes = [
    {
      url: `${apiRoot}/api/admin/orders/order-probe/refund`,
      data: { confirm: true, confirmOrderId: 'order-probe', confirmEmail: 'probe@example.com' }
    },
    {
      url: `${apiRoot}/api/admin/users/user-probe/billing-adjustments`,
      data: { confirm: true, confirmUserId: 'user-probe', type: 'credit', points: 1, note: 'anonymous probe' }
    },
    {
      url: `${apiRoot}/api/admin/users/user-probe/logout`,
      data: { confirm: true }
    }
  ];

  for (const probe of mutationProbes) {
    const response = await request.post(probe.url, { data: probe.data });
    expect(response.ok()).toBeFalsy();
    expect([401, 403]).toContain(response.status());
  }

  const deleteUser = await request.delete(`${apiRoot}/api/admin/users/user-probe`, {
    data: { confirm: true, confirmUserId: 'user-probe', confirmEmail: 'probe@example.com' }
  });
  expect(deleteUser.ok()).toBeFalsy();
  expect([401, 403]).toContain(deleteUser.status());
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
  expect(Array.isArray(payload.checks)).toBeTruthy();
  expect(payload.checks.length).toBeGreaterThan(0);
  const required = payload.checks.filter((check: { status: string }) => check.status === 'action-required');
  expect(required).toEqual([]);
});
