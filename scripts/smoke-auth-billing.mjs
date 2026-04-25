import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const configPath = path.join(repoRoot, 'deployment', 'local-server.production.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
const apiRoot = process.env.METROVAN_SMOKE_API_ROOT || `http://127.0.0.1:${config.localServerPort || 8787}`;
const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const email = `zhoujin0618+metrovan-smoke-${stamp}@gmail.com`;
const password = `Metrovan${stamp}!`;
const newPassword = `MetrovanReset${stamp}!`;
const results = [];

function addResult(name, ok, details = {}) {
  results.push({ name, ok, ...details });
  console.log(JSON.stringify({ name, ok, ...details }));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class ApiClient {
  constructor() {
    this.cookies = new Map();
    this.csrfToken = '';
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
  }

  captureCookies(response) {
    const headers = response.headers;
    const setCookies =
      typeof headers.getSetCookie === 'function'
        ? headers.getSetCookie()
        : [headers.get('set-cookie')].filter(Boolean);
    for (const item of setCookies) {
      const first = item.split(';')[0];
      const separator = first.indexOf('=');
      if (separator === -1) continue;
      const key = first.slice(0, separator).trim();
      const value = first.slice(separator + 1).trim();
      if (!key) continue;
      if (value) {
        this.cookies.set(key, value);
      } else {
        this.cookies.delete(key);
      }
    }
  }

  async request(method, requestPath, body, options = {}) {
    const headers = {
      Accept: 'application/json',
      ...options.headers
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const cookie = this.cookieHeader();
    if (cookie) {
      headers.Cookie = cookie;
    }
    if (this.csrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      headers['X-CSRF-Token'] = this.csrfToken;
    }

    const response = await fetch(`${apiRoot}${requestPath}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual'
    });
    this.captureCookies(response);
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    if (payload?.session?.csrfToken) {
      this.csrfToken = payload.session.csrfToken;
    }
    return { status: response.status, payload };
  }
}

async function getResendEmails() {
  const key = String(config.smtpPass || '').trim();
  assert(key.startsWith('re_'), 'Resend API key is not configured in smtpPass.');
  const response = await fetch('https://api.resend.com/emails?limit=50', {
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'application/json'
    }
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Resend list failed: ${response.status} ${payload?.message || ''}`);
  }
  return Array.isArray(payload.data) ? payload.data : [];
}

async function getResendEmail(emailId) {
  const key = String(config.smtpPass || '').trim();
  const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(emailId)}`, {
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'application/json'
    }
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Resend retrieve failed: ${response.status} ${payload?.message || ''}`);
  }
  return payload;
}

function emailMatches(item, recipient, subjectNeedle) {
  const to = JSON.stringify(item.to || item.recipients || '').toLowerCase();
  const subject = String(item.subject || '').toLowerCase();
  return to.includes(recipient.toLowerCase()) && subject.includes(subjectNeedle.toLowerCase());
}

function extractTokenFromEmail(detail, authMode) {
  const haystack = JSON.stringify(detail)
    .replaceAll('\\u0026amp;', '&')
    .replaceAll('\\u0026', '&')
    .replaceAll('&amp;', '&');
  const regexes = [
    new RegExp(`auth=${authMode}[^"'\\s<>]*token=([^&"'\\\\\\s<>]+)`),
    new RegExp(`token=([^&"'\\\\\\s<>]+)[^"'\\s<>]*auth=${authMode}`)
  ];
  for (const regex of regexes) {
    const match = haystack.match(regex);
    if (match?.[1]) {
      return decodeURIComponent(match[1].replaceAll('&amp;', '&'));
    }
  }
  return null;
}

async function waitForEmailToken(recipient, subjectNeedle, authMode) {
  const deadline = Date.now() + 90_000;
  let lastSeen = 0;
  while (Date.now() < deadline) {
    const emails = await getResendEmails();
    lastSeen = emails.length;
    for (const item of emails) {
      if (!emailMatches(item, recipient, subjectNeedle)) {
        continue;
      }
      const id = item.id;
      if (!id) {
        continue;
      }
      const detail = await getResendEmail(id);
      const token = extractTokenFromEmail(detail, authMode);
      if (token) {
        return { token, emailId: id };
      }
    }
    await sleep(3000);
  }
  throw new Error(`Timed out waiting for ${subjectNeedle} email. Recent sent emails visible: ${lastSeen}.`);
}

function signStripePayload(payload) {
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify(payload);
  const signature = crypto
    .createHmac('sha256', config.stripeWebhookSecret)
    .update(`${timestamp}.${body}`, 'utf8')
    .digest('hex');
  return { body, header: `t=${timestamp},v1=${signature}` };
}

async function sendSignedStripeEvent(payload) {
  const signed = signStripePayload(payload);
  const response = await fetch(`${apiRoot}/api/stripe/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Stripe-Signature': signed.header
    },
    body: signed.body
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: response.status, payload: parsed };
}

async function withStep(name, fn) {
  try {
    const details = await fn();
    addResult(name, true, details);
    return details;
  } catch (error) {
    addResult(name, false, { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

async function main() {
  const client = new ApiClient();

  await withStep('health', async () => {
    const response = await client.request('GET', '/api/health');
    assert(response.status === 200, `expected 200, got ${response.status}`);
    return { status: response.status };
  });

  await withStep('register', async () => {
    const response = await client.request('POST', '/api/auth/register', {
      email,
      displayName: 'Metrovan Smoke',
      password
    });
    assert(response.status === 201, `expected 201, got ${response.status}`);
    assert(response.payload?.verificationRequired === true, 'verificationRequired was not true');
    return { status: response.status, email };
  });

  await withStep('duplicate_register_rejected', async () => {
    const response = await client.request('POST', '/api/auth/register', {
      email,
      displayName: 'Metrovan Smoke',
      password
    });
    assert(response.status === 409, `expected 409, got ${response.status}`);
    return { status: response.status };
  });

  await withStep('login_before_verify_rejected', async () => {
    const response = await client.request('POST', '/api/auth/login', { email, password });
    assert(response.status === 403, `expected 403, got ${response.status}`);
    return { status: response.status };
  });

  let verificationToken = '';
  await withStep('email_verification_email_sent_and_readable', async () => {
    const data = await waitForEmailToken(email, 'verify', 'verify');
    verificationToken = data.token;
    return { emailId: data.emailId };
  });

  await withStep('email_verification_confirm', async () => {
    const response = await client.request('POST', '/api/auth/email-verification/confirm', {
      token: verificationToken
    });
    assert(response.status === 200, `expected 200, got ${response.status}`);
    assert(response.payload?.session?.user?.email === email, 'verified session email mismatch');
    return { status: response.status, userKey: response.payload.session.user.userKey };
  });

  await withStep('session_after_verify', async () => {
    const response = await client.request('GET', '/api/auth/session');
    assert(response.status === 200, `expected 200, got ${response.status}`);
    assert(response.payload?.session?.user?.email === email, 'session email mismatch');
    return { status: response.status };
  });

  await withStep('wrong_password_rejected', async () => {
    const wrongClient = new ApiClient();
    const response = await wrongClient.request('POST', '/api/auth/login', {
      email,
      password: 'WrongPassword123!'
    });
    assert(response.status === 401, `expected 401, got ${response.status}`);
    return { status: response.status };
  });

  const loginClient = new ApiClient();
  await withStep('login_after_verify', async () => {
    const response = await loginClient.request('POST', '/api/auth/login', { email, password });
    assert(response.status === 200, `expected 200, got ${response.status}`);
    assert(response.payload?.session?.csrfToken, 'missing csrf token');
    return { status: response.status };
  });

  await withStep('password_reset_request', async () => {
    const response = await client.request('POST', '/api/auth/password-reset/request', { email });
    assert(response.status === 200, `expected 200, got ${response.status}`);
    return { status: response.status };
  });

  let resetToken = '';
  await withStep('password_reset_email_sent_and_readable', async () => {
    const data = await waitForEmailToken(email, 'reset', 'reset');
    resetToken = data.token;
    return { emailId: data.emailId };
  });

  await withStep('password_reset_confirm', async () => {
    const response = await client.request('POST', '/api/auth/password-reset/confirm', {
      token: resetToken,
      password: newPassword
    });
    assert(response.status === 200, `expected 200, got ${response.status}`);
    return { status: response.status };
  });

  await withStep('old_password_rejected_after_reset', async () => {
    const response = await new ApiClient().request('POST', '/api/auth/login', { email, password });
    assert(response.status === 401, `expected 401, got ${response.status}`);
    return { status: response.status };
  });

  const paidClient = new ApiClient();
  await withStep('new_password_login', async () => {
    const response = await paidClient.request('POST', '/api/auth/login', { email, password: newPassword });
    assert(response.status === 200, `expected 200, got ${response.status}`);
    return { status: response.status };
  });

  const initialBilling = await withStep('billing_initial', async () => {
    const response = await paidClient.request('GET', '/api/billing');
    assert(response.status === 200, `expected 200, got ${response.status}`);
    assert(Array.isArray(response.payload?.packages) && response.payload.packages.length >= 4, 'missing billing packages');
    return {
      status: response.status,
      availablePoints: response.payload.summary.availablePoints,
      packageCount: response.payload.packages.length
    };
  });

  const checkout = await withStep('stripe_checkout_created', async () => {
    const response = await paidClient.request('POST', '/api/billing/checkout', { packageId: 'recharge-100' });
    assert(response.status === 201, `expected 201, got ${response.status}`);
    assert(String(response.payload?.checkoutUrl || '').startsWith('https://checkout.stripe.com/'), 'invalid checkout url');
    assert(response.payload?.order?.stripeCheckoutSessionId, 'missing stripe checkout session id');
    return {
      status: response.status,
      orderId: response.payload.order.id,
      sessionId: response.payload.sessionId,
      points: response.payload.order.points
    };
  });

  await withStep('stripe_checkout_webhook_credit_idempotent', async () => {
    const eventPayload = {
      id: `evt_smoke_${stamp}`,
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: checkout.sessionId,
          object: 'checkout.session',
          payment_status: 'paid',
          status: 'complete',
          client_reference_id: checkout.orderId,
          metadata: { metrovanOrderId: checkout.orderId },
          payment_intent: `pi_smoke_${stamp}`,
          customer: `cus_smoke_${stamp}`
        }
      }
    };
    const first = await sendSignedStripeEvent(eventPayload);
    assert(first.status === 200, `expected first webhook 200, got ${first.status}`);
    const afterFirst = await paidClient.request('GET', '/api/billing');
    const expected = initialBilling.availablePoints + checkout.points;
    assert(afterFirst.payload.summary.availablePoints === expected, `expected ${expected} points`);
    const second = await sendSignedStripeEvent(eventPayload);
    assert(second.status === 200, `expected second webhook 200, got ${second.status}`);
    const afterSecond = await paidClient.request('GET', '/api/billing');
    assert(afterSecond.payload.summary.availablePoints === expected, 'webhook was not idempotent');
    return { creditedPoints: checkout.points, availablePoints: expected };
  });

  const project = await withStep('project_create', async () => {
    const response = await paidClient.request('POST', '/api/projects', {
      name: `Smoke billing ${stamp}`,
      address: 'Smoke test'
    });
    assert(response.status === 201, `expected 201, got ${response.status}`);
    return { projectId: response.payload.project.id };
  });

  await withStep('project_start_without_photos_rejected_before_charge', async () => {
    const before = await paidClient.request('GET', '/api/billing');
    const response = await paidClient.request('POST', `/api/projects/${project.projectId}/start`, {});
    assert(response.status === 400, `expected 400, got ${response.status}`);
    const after = await paidClient.request('GET', '/api/billing');
    assert(after.payload.summary.availablePoints === before.payload.summary.availablePoints, 'points changed unexpectedly');
    return { status: response.status, availablePoints: after.payload.summary.availablePoints };
  });

  await withStep('core_credit_reservation_idempotent', async () => {
    process.env.METROVAN_METADATA_PROVIDER = config.metadataProvider || 'json-file';
    process.env.SUPABASE_DB_URL = config.supabaseDbUrl || '';
    process.env.METROVAN_METADATA_TABLE = config.metadataTable || 'metrovan_metadata';
    process.env.METROVAN_METADATA_DOCUMENT_ID = config.metadataDocumentId || 'default';
    process.env.METROVAN_POSTGRES_SSL = String(config.postgresSsl ?? true);
    const { LocalStore } = await import('../server/src/store.ts');
    const store = new LocalStore(repoRoot);
    await store.initialize();
    store.updateProject(project.projectId, (current) => {
      const groupId = current.groups[0]?.id || 'smoke-group';
      const hdrItems = [1, 2].map((index) => ({
        id: `smoke-hdr-${stamp}-${index}`,
        index,
        title: `Smoke HDR ${index}`,
        groupId,
        sceneType: 'interior',
        selectedExposureId: '',
        previewUrl: null,
        status: 'review',
        statusText: 'review',
        errorMessage: null,
        mergedPath: null,
        mergedUrl: null,
        resultPath: null,
        resultUrl: null,
        resultFileName: null,
        exposures: []
      }));
      return {
        ...current,
        hdrItems,
        groups: [
          {
            id: groupId,
            index: 1,
            name: 'Smoke group',
            sceneType: 'interior',
            colorMode: 'default',
            replacementColor: null,
            hdrItemIds: hdrItems.map((item) => item.id)
          }
        ]
      };
    });
    const first = store.reserveProjectProcessingCredits(project.projectId, 0.25);
    assert(first.ok, first.error || 'first reservation failed');
    const second = store.reserveProjectProcessingCredits(project.projectId, 0.25);
    assert(second.ok, second.error || 'second reservation failed');
    const charges = store
      .listBillingEntries((await paidClient.request('GET', '/api/auth/session')).payload.session.user.userKey)
      .filter((entry) => entry.projectId === project.projectId && entry.type === 'charge');
    assert(charges.length === 1, `expected 1 charge, got ${charges.length}`);
    assert(charges[0].points === 2, `expected 2 charged points, got ${charges[0].points}`);
    return { chargedPoints: charges[0].points, chargeEntries: charges.length };
  });

  if (config.stripeSecretKey && checkout.sessionId) {
    await withStep('stripe_session_cleanup_attempt', async () => {
      try {
        const response = await fetch(
          `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(checkout.sessionId)}/expire`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${config.stripeSecretKey}`
            }
          }
        );
        if (response.ok) {
          return { expired: true };
        }
        const payload = await response.json().catch(() => ({}));
        return { expired: false, reason: payload?.error?.code || payload?.error?.type || response.status };
      } catch (error) {
        return { expired: false, reason: error instanceof Error ? error.message : 'not_expirable' };
      }
    });
  }

  const failed = results.filter((item) => !item.ok);
  console.log(JSON.stringify({ done: true, failed: failed.length, email }));
  if (failed.length) {
    process.exit(1);
  }
}

await main();
