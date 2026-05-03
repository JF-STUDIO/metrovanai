import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.METROVAN_SMOKE_STRIPE_PORT || 21000 + Math.floor(Math.random() * 1000));
const apiRoot = `http://127.0.0.1:${port}`;
const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'metrovan-stripe-webhook-'));
const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const email = `metrovan-stripe-smoke-${stamp}@example.test`;
const password = `Metrovan${stamp}!`;
const webhookSecret = `whsec_metrovan_smoke_${stamp}`;
const stripeSecretKey = `sk_test_metrovan_smoke_${stamp}`;
const results = [];
let serverOutput = '';

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

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

function dbPath() {
  return path.join(runtimeRoot, 'db.json');
}

function readDb() {
  return JSON.parse(fs.readFileSync(dbPath(), 'utf8'));
}

function writeDb(db) {
  fs.writeFileSync(dbPath(), `${JSON.stringify(db, null, 2)}\n`, 'utf8');
}

function extractTokenFromLogs(authMode, recipient) {
  const normalized = serverOutput.replaceAll('&amp;', '&');
  const lines = normalized.split(/\r?\n/).filter((line) => line.includes(recipient)).reverse();
  for (const line of lines) {
    if (!line.includes(`auth=${authMode}`)) continue;
    const tokenMatch =
      line.match(/(?:^|[?&])token=([^&"'\s<>]+)[^"'\s<>]*[?&]auth=/) ??
      line.match(/[?&]auth=[^&"'\s<>]+[^"'\s<>]*[?&]token=([^&"'\s<>]+)/);
    if (tokenMatch?.[1]) {
      return decodeURIComponent(tokenMatch[1]);
    }
  }
  return null;
}

function extractVerificationCodeFromLogs(recipient) {
  const lines = serverOutput.split(/\r?\n/).filter((line) => line.includes(recipient)).reverse();
  for (const line of lines) {
    const codeMatch = line.match(/Verification code for [^:]+:\s*(\d{6})\b/);
    if (codeMatch?.[1]) {
      return codeMatch[1];
    }
  }
  return null;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function hashVerificationCode(userEmail, code) {
  return hashToken(`${userEmail.trim().toLowerCase()}:${code.trim()}`);
}

function hasStoredEmailVerificationToken(rawToken) {
  if (!fs.existsSync(dbPath())) {
    return false;
  }
  const db = readDb();
  const hashed = hashToken(rawToken);
  return Array.isArray(db.emailVerificationTokens) && db.emailVerificationTokens.some((item) => item.tokenHash === hashed);
}

function hasStoredEmailVerificationCode(userEmail, code) {
  if (!fs.existsSync(dbPath())) {
    return false;
  }
  const db = readDb();
  const hashed = hashVerificationCode(userEmail, code);
  return Array.isArray(db.emailVerificationTokens) && db.emailVerificationTokens.some((item) => item.tokenHash === hashed);
}

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function createTestPaymentOrder(user, input) {
  const db = readDb();
  const now = new Date().toISOString();
  const order = {
    id: createId('order'),
    userId: user.id,
    userKey: user.userKey,
    email: user.email,
    packageId: input.packageId,
    packageName: input.packageName,
    points: input.points,
    amountUsd: input.amountUsd,
    currency: 'usd',
    activationCodeId: null,
    activationCode: null,
    activationCodeLabel: null,
    stripeCheckoutSessionId: input.sessionId,
    stripePaymentIntentId: null,
    stripeCustomerId: null,
    stripeReceiptUrl: null,
    stripeInvoiceUrl: null,
    stripeInvoicePdfUrl: null,
    stripeRefundId: null,
    refundedAmountUsd: 0,
    refundedPoints: 0,
    refundBillingEntryId: null,
    refundedAt: null,
    checkoutUrl: `https://checkout.stripe.com/c/pay/${input.sessionId}`,
    status: 'checkout_created',
    errorMessage: null,
    billingEntryId: null,
    createdAt: now,
    updatedAt: now,
    paidAt: null,
    fulfilledAt: null
  };
  db.paymentOrders.unshift(order);
  writeDb(db);
  return order;
}

function getPaymentOrder(orderId) {
  return readDb().paymentOrders.find((order) => order.id === orderId) ?? null;
}

function signStripePayload(payload) {
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', webhookSecret).update(`${timestamp}.${body}`, 'utf8').digest('hex');
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
  return { status: response.status, payload: parseJson(text) };
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
    const setCookies =
      typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : [response.headers.get('set-cookie')].filter(Boolean);
    for (const item of setCookies) {
      const first = item.split(';')[0] ?? '';
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
    if (options.csrf !== false && this.csrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      headers['X-CSRF-Token'] = this.csrfToken;
    }

    const response = await fetch(`${apiRoot}${requestPath}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual'
    });
    this.captureCookies(response);
    const payload = parseJson(await response.text());
    if (payload?.session?.csrfToken) {
      this.csrfToken = payload.session.csrfToken;
    }
    return { status: response.status, payload };
  }
}

async function waitForHealth(child) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Local server exited early with code ${child.exitCode}.\n${serverOutput.slice(-4000)}`);
    }
    try {
      const response = await fetch(`${apiRoot}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Wait for the listener to bind.
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for local server health.\n${serverOutput.slice(-4000)}`);
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
  const child = spawn('pnpm', ['--filter', 'metrovan-ai-server', 'exec', 'tsx', 'src/index.ts'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      METROVAN_RUNTIME_ROOT: runtimeRoot,
      METROVAN_METADATA_PROVIDER: 'json-file',
      METROVAN_STORAGE_PROVIDER: 'local-disk',
      METROVAN_ALLOW_LOCAL_PRODUCTION: 'true',
      METROVAN_DISABLE_RESULT_AUTO_RECOVERY: 'true',
      METROVAN_STRIPE_SECRET_KEY: stripeSecretKey,
      METROVAN_STRIPE_WEBHOOK_SECRET: webhookSecret,
      METROVAN_STRIPE_WEBHOOK_TRUST_EVENT_SESSION: 'true',
      AUTH_EMAIL_LOG_DELIVERY: 'true',
      AUTH_EMAIL_LOG_LINKS: 'true',
      SMTP_HOST: '',
      SMTP_FROM: '',
      SUPABASE_DB_URL: '',
      DATABASE_URL: '',
      POSTGRES_URL: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', (chunk) => {
    serverOutput += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    serverOutput += chunk.toString();
  });

  try {
    await withStep('local_server_health', async () => {
      await waitForHealth(child);
      return { apiRoot, runtimeRoot };
    });

    const client = new ApiClient();
    let verifiedUser = null;
    await withStep('register_and_verify_test_user', async () => {
      const register = await client.request('POST', '/api/auth/register', {
        email,
        password,
        displayName: 'Metrovan Stripe Smoke'
      });
      assert(register.status === 201, `Expected register 201, got ${register.status}`);
      const code = extractVerificationCodeFromLogs(email);
      assert(code, 'Could not find email verification code in local server logs.');
      assert(hasStoredEmailVerificationCode(email, code), 'Extracted verification code was not found in local metadata.');
      const verify = await client.request('POST', '/api/auth/email-verification/confirm', { email, code });
      assert(verify.status === 200, `Expected email verification 200, got ${verify.status}: ${JSON.stringify(verify.payload)}`);
      verifiedUser = verify.payload.session.user;
      return { email: verifiedUser.email };
    });

    const initialBilling = await withStep('billing_initial', async () => {
      const response = await client.request('GET', '/api/billing');
      assert(response.status === 200, `Expected billing 200, got ${response.status}`);
      return { availablePoints: response.payload.summary.availablePoints, orderCount: response.payload.orders.length };
    });

    const sessionId = `cs_test_smoke_${stamp}`;
    const paymentIntentId = `pi_smoke_${stamp}`;
    const customerId = `cus_smoke_${stamp}`;
    const order = await withStep('local_checkout_order_seeded', async () => {
      assert(verifiedUser, 'Missing verified user.');
      const seeded = createTestPaymentOrder(verifiedUser, {
        sessionId,
        packageId: 'recharge-smoke',
        packageName: 'Stripe Webhook Smoke',
        points: 25,
        amountUsd: 12.5
      });
      const billing = await client.request('GET', '/api/billing');
      assert(billing.payload.orders.some((item) => item.id === seeded.id), 'Seeded order was not visible in billing API.');
      return { orderId: seeded.id, sessionId, points: seeded.points };
    });

    await withStep('stripe_webhook_signature_rejects_invalid_payload', async () => {
      const response = await fetch(`${apiRoot}/api/stripe/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Stripe-Signature': 't=1,v1=invalid'
        },
        body: JSON.stringify({ id: 'evt_invalid', object: 'event' })
      });
      assert(response.status === 400, `Expected invalid webhook 400, got ${response.status}`);
      return { status: response.status };
    });

    await withStep('stripe_checkout_webhook_credits_once', async () => {
      const eventPayload = {
        id: `evt_smoke_${stamp}`,
        object: 'event',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: sessionId,
            object: 'checkout.session',
            payment_status: 'paid',
            status: 'complete',
            client_reference_id: order.orderId,
            metadata: { metrovanOrderId: order.orderId },
            payment_intent: paymentIntentId,
            customer: customerId
          }
        }
      };

      const first = await sendSignedStripeEvent(eventPayload);
      assert(first.status === 200, `Expected first webhook 200, got ${first.status}: ${JSON.stringify(first.payload)}`);
      assert(first.payload?.received === true, 'First webhook was not received.');
      const afterFirst = await client.request('GET', '/api/billing');
      const expectedPoints = initialBilling.availablePoints + order.points;
      assert(afterFirst.payload.summary.availablePoints === expectedPoints, `Expected ${expectedPoints} points after first webhook.`);
      const updatedOrder = getPaymentOrder(order.orderId);
      assert(updatedOrder?.status === 'paid', `Expected paid order, got ${updatedOrder?.status}`);
      assert(updatedOrder?.stripePaymentIntentId === paymentIntentId, 'Payment intent id was not stored.');

      const second = await sendSignedStripeEvent(eventPayload);
      assert(second.status === 200, `Expected duplicate webhook 200, got ${second.status}: ${JSON.stringify(second.payload)}`);
      assert(second.payload?.duplicate === true, 'Duplicate webhook was not marked duplicate.');
      const afterSecond = await client.request('GET', '/api/billing');
      assert(afterSecond.payload.summary.availablePoints === expectedPoints, 'Duplicate webhook changed billing balance.');
      const billingEntries = readDb().billing.filter((entry) => entry.userKey === verifiedUser.userKey);
      assert(billingEntries.length === 1, `Expected one billing entry, got ${billingEntries.length}`);
      const processedEvents = readDb().processedStripeEvents.filter((event) => event.id === eventPayload.id);
      assert(processedEvents.length === 1, `Expected one processed event, got ${processedEvents.length}`);
      return { creditedPoints: order.points, availablePoints: expectedPoints };
    });

    console.log(JSON.stringify({ ok: true, results: results.length }));
  } finally {
    child.kill('SIGTERM');
    await sleep(250);
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
