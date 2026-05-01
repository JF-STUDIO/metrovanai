import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.METROVAN_SMOKE_AUTH_PORT || 19000 + Math.floor(Math.random() * 1000));
const apiRoot = `http://127.0.0.1:${port}`;
const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'metrovan-auth-session-'));
const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const email = `metrovan-smoke-${stamp}@example.test`;
const password = `Metrovan${stamp}!`;
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

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function hasStoredEmailVerificationToken(rawToken) {
  const dbPath = path.join(runtimeRoot, 'db.json');
  if (!fs.existsSync(dbPath)) {
    return false;
  }
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const hashed = hashToken(rawToken);
  return Array.isArray(db.emailVerificationTokens) && db.emailVerificationTokens.some((item) => item.tokenHash === hashed);
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
    await withStep('upload_capabilities_available', async () => {
      const response = await client.request('GET', '/api/upload/capabilities');
      assert(response.status === 200, `Expected upload capabilities 200, got ${response.status}`);
      assert(response.payload?.localProxy && response.payload?.directObject, 'Missing upload capability payload.');
      return {
        localProxy: response.payload.localProxy.enabled,
        directObject: response.payload.directObject.enabled
      };
    });

    await withStep('register_requires_email_verification', async () => {
      const response = await client.request('POST', '/api/auth/register', {
        email,
        password,
        displayName: 'Metrovan Smoke'
      });
      assert(response.status === 201, `Expected register 201, got ${response.status}`);
      assert(response.payload?.verificationRequired === true, 'Register did not require verification.');
      return { email };
    });

    await withStep('login_before_verification_rejected', async () => {
      const response = await client.request('POST', '/api/auth/login', { email, password });
      assert(response.status === 403, `Expected pre-verification login 403, got ${response.status}`);
      return { status: response.status };
    });

    await withStep('email_verification_confirms_session', async () => {
      const token = extractTokenFromLogs('verify', email);
      assert(token, 'Could not find email verification token in local server logs.');
      assert(hasStoredEmailVerificationToken(token), `Extracted verification token was not found in local metadata. length=${token.length}`);
      const response = await client.request('POST', '/api/auth/email-verification/confirm', { token });
      assert(
        response.status === 200,
        `Expected email verification 200, got ${response.status}: ${JSON.stringify(response.payload)}`
      );
      assert(response.payload?.session?.user?.email === email, 'Verified session email mismatch.');
      assert(response.payload?.session?.csrfToken, 'Verified session missing CSRF token.');
      return { sessionEmail: response.payload.session.user.email };
    });

    await withStep('session_endpoint_reports_user', async () => {
      const response = await client.request('GET', '/api/auth/session');
      assert(response.status === 200, `Expected session 200, got ${response.status}`);
      assert(response.payload?.session?.user?.email === email, 'Session endpoint email mismatch.');
      return { sessionEmail: response.payload.session.user.email };
    });

    await withStep('csrf_required_for_project_create', async () => {
      const response = await client.request(
        'POST',
        '/api/projects',
        { name: `CSRF rejection ${stamp}` },
        { csrf: false }
      );
      assert(response.status === 403, `Expected missing CSRF 403, got ${response.status}`);
      return { status: response.status };
    });

    let projectId = '';
    await withStep('authenticated_project_create', async () => {
      const response = await client.request('POST', '/api/projects', {
        name: `Smoke session project ${stamp}`,
        address: 'Local auth session smoke test',
        studioFeatureId: 'hdr-true-color'
      });
      assert(response.status === 201, `Expected project create 201, got ${response.status}`);
      assert(response.payload?.project?.id, 'Project response missing id.');
      projectId = response.payload.project.id;
      return { projectId };
    });

    await withStep('authenticated_project_list_contains_project', async () => {
      const response = await client.request('GET', '/api/projects');
      assert(response.status === 200, `Expected project list 200, got ${response.status}`);
      const ids = (response.payload?.items ?? []).map((item) => item.id);
      assert(ids.includes(projectId), 'Project list did not include created project.');
      return { projectCount: ids.length };
    });

    await withStep('logout_clears_session', async () => {
      const response = await client.request('POST', '/api/auth/logout');
      assert(response.status === 200, `Expected logout 200, got ${response.status}`);
      const session = await client.request('GET', '/api/auth/session');
      assert(session.status === 200, `Expected post-logout session 200, got ${session.status}`);
      assert(session.payload?.session === null, 'Session was still present after logout.');
      return { status: response.status };
    });

    await withStep('logged_out_project_create_rejected', async () => {
      const response = await client.request('POST', '/api/projects', { name: `Logged out ${stamp}` });
      assert(response.status === 401, `Expected logged-out project create 401, got ${response.status}`);
      return { status: response.status };
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
