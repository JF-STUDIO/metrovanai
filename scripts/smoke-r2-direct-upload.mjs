import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const workspaceRoot = path.resolve(repoRoot, '..');
const secretFile =
  process.env.METROVAN_SECRET_FILE ||
  path.join(workspaceRoot, 'PRIVATE_METROVAN_AI_SECRETS_REAL_DO_NOT_SHARE.env.local');
const port = Number(process.env.METROVAN_SMOKE_R2_PORT || 20000 + Math.floor(Math.random() * 1000));
const apiRoot = `http://127.0.0.1:${port}`;
const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'metrovan-r2-direct-upload-'));
const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const email = `metrovan-r2-smoke-${stamp}@example.test`;
const password = `Metrovan${stamp}!`;
const smokeFileName = `r2-smoke-${stamp}.jpg`;
const smokeJpeg = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAHsP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8BP//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8BP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8hf//aAAwDAQACAAMAAAAQ8P/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8QP//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8QP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8QP//Z',
  'base64'
);
const requiredObjectStorageEnv = [
  'METROVAN_OBJECT_STORAGE_ENDPOINT',
  'METROVAN_OBJECT_STORAGE_BUCKET',
  'METROVAN_OBJECT_STORAGE_ACCESS_KEY_ID',
  'METROVAN_OBJECT_STORAGE_SECRET_ACCESS_KEY'
];
const results = [];
const uploadedStorageKeys = new Set();
let serverOutput = '';

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return false;
  }
  const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[name] === undefined) {
      process.env[name] = value;
    }
  }
  return true;
}

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
  const dbPath = path.join(runtimeRoot, 'db.json');
  if (!fs.existsSync(dbPath)) {
    return false;
  }
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const hashed = hashToken(rawToken);
  return Array.isArray(db.emailVerificationTokens) && db.emailVerificationTokens.some((item) => item.tokenHash === hashed);
}

function hasStoredEmailVerificationCode(userEmail, code) {
  const dbPath = path.join(runtimeRoot, 'db.json');
  if (!fs.existsSync(dbPath)) {
    return false;
  }
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const hashed = hashVerificationCode(userEmail, code);
  return Array.isArray(db.emailVerificationTokens) && db.emailVerificationTokens.some((item) => item.tokenHash === hashed);
}

function projectHasExposureStorageKey(projectId, storageKey) {
  const dbPath = path.join(runtimeRoot, 'db.json');
  if (!fs.existsSync(dbPath)) {
    return false;
  }
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const project = Array.isArray(db.projects) ? db.projects.find((item) => item.id === projectId) : null;
  return Boolean(
    project?.hdrItems?.some((item) =>
      item.exposures?.some((exposure) => exposure.storageKey === storageKey || exposure.storagePath === storageKey)
    )
  );
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

async function cleanupUploadedObjects() {
  if (!uploadedStorageKeys.size) {
    return;
  }
  const code = [
    "import { deleteObjectsFromStorage } from './src/object-storage.ts';",
    '(async()=>{',
    `const result = await deleteObjectsFromStorage(${JSON.stringify([...uploadedStorageKeys])});`,
    'console.log(JSON.stringify(result));',
    'if (result.failed.length) process.exit(1);',
    '})().catch((error)=>{ console.error(error); process.exit(1); });'
  ].join(' ');
  const output = execFileSync('pnpm', ['--filter', 'metrovan-ai-server', 'exec', 'tsx', '-e', code], {
    cwd: repoRoot,
    env: process.env,
    encoding: 'utf8'
  }).trim();
  const cleanup = parseJson(output);
  addResult('r2_cleanup', cleanup?.failed?.length === 0, {
    deleted: cleanup?.deleted ?? 0,
    failed: cleanup?.failed?.length ?? 0
  });
}

async function main() {
  loadEnvFile(secretFile);
  const missing = requiredObjectStorageEnv.filter((name) => !process.env[name]?.trim());
  if (missing.length) {
    console.log(JSON.stringify({ ok: true, skipped: true, reason: 'missing_object_storage_env', missing }));
    return;
  }

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
      METROVAN_DIRECT_UPLOAD_ENABLED: 'true',
      METROVAN_DIRECT_UPLOAD_STAGE_LOCAL: 'true',
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
  let client;
  let projectId = '';
  let projectDeleted = false;

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

    client = new ApiClient();
    await withStep('direct_upload_capabilities_enabled', async () => {
      const response = await client.request('GET', '/api/upload/capabilities');
      assert(response.status === 200, `Expected upload capabilities 200, got ${response.status}`);
      assert(response.payload?.directObject?.enabled === true, 'Direct object upload was not enabled.');
      return {
        directObject: response.payload.directObject.enabled,
        localProxy: response.payload.localProxy.enabled
      };
    });

    await withStep('register_and_verify_test_user', async () => {
      const register = await client.request('POST', '/api/auth/register', {
        email,
        password,
        displayName: 'Metrovan R2 Smoke'
      });
      assert(register.status === 201, `Expected register 201, got ${register.status}`);
      const code = extractVerificationCodeFromLogs(email);
      assert(code, 'Could not find email verification code in local server logs.');
      assert(hasStoredEmailVerificationCode(email, code), 'Extracted verification code was not found in local metadata.');
      const verify = await client.request('POST', '/api/auth/email-verification/confirm', { email, code });
      assert(verify.status === 200, `Expected email verification 200, got ${verify.status}: ${JSON.stringify(verify.payload)}`);
      return { email: verify.payload.session.user.email };
    });

    await withStep('authenticated_project_create', async () => {
      const response = await client.request('POST', '/api/projects', {
        name: `R2 direct smoke ${stamp}`,
        address: 'R2 direct upload staging smoke',
        studioFeatureId: 'hdr-true-color'
      });
      assert(response.status === 201, `Expected project create 201, got ${response.status}`);
      projectId = response.payload.project.id;
      return { projectId };
    });

    let storageKey = '';
    await withStep('r2_presigned_put_and_complete', async () => {
      const targetsResponse = await client.request('POST', `/api/projects/${projectId}/direct-upload/targets`, {
        files: [{ originalName: smokeFileName, mimeType: 'image/jpeg', size: smokeJpeg.length }]
      });
      assert(targetsResponse.status === 200, `Expected targets 200, got ${targetsResponse.status}: ${JSON.stringify(targetsResponse.payload)}`);
      const target = targetsResponse.payload?.targets?.[0];
      assert(target?.uploadUrl && target?.storageKey, 'Direct upload target was missing upload URL or storage key.');
      storageKey = target.storageKey;
      uploadedStorageKeys.add(storageKey);

      const upload = await fetch(target.uploadUrl, {
        method: target.method,
        headers: target.headers,
        body: smokeJpeg
      });
      const uploadBody = await upload.text();
      assert(upload.ok, `Expected R2 PUT success, got ${upload.status}: ${uploadBody}`);

      const complete = await client.request('POST', `/api/projects/${projectId}/direct-upload/complete`, {
        files: [{ originalName: smokeFileName, mimeType: 'image/jpeg', size: smokeJpeg.length, storageKey }]
      });
      assert(complete.status === 200, `Expected direct upload complete 200, got ${complete.status}: ${JSON.stringify(complete.payload)}`);
      assert(complete.payload?.project?.status === 'uploading', `Expected uploading status, got ${complete.payload?.project?.status}`);
      return { storageKey, size: smokeJpeg.length };
    });

    await withStep('hdr_layout_uses_r2_uploaded_object', async () => {
      const response = await client.request('POST', `/api/projects/${projectId}/hdr-layout`, {
        mode: 'replace',
        inputComplete: true,
        hdrItems: [
          {
            exposureOriginalNames: [smokeFileName],
            selectedOriginalName: smokeFileName,
            exposures: [
              {
                originalName: smokeFileName,
                fileName: smokeFileName,
                extension: '.jpg',
                mimeType: 'image/jpeg',
                size: smokeJpeg.length,
                isRaw: false,
                storageKey
              }
            ]
          }
        ]
      });
      assert(response.status === 200, `Expected HDR layout 200, got ${response.status}: ${JSON.stringify(response.payload)}`);
      const item = response.payload?.project?.hdrItems?.[0];
      assert(item?.exposures?.length === 1, 'HDR layout did not return one exposure.');
      assert(projectHasExposureStorageKey(projectId, storageKey), 'HDR exposure did not retain the R2 storage key in local metadata.');
      assert(response.payload?.project?.uploadCompletedAt, 'HDR layout did not mark upload completed.');
      return { hdrItems: response.payload.project.hdrItems.length, storageKey };
    });

    await withStep('trial_credits_allow_project_start_after_r2_upload', async () => {
      const before = await client.request('GET', '/api/billing');
      assert(before.status === 200, `Expected billing 200 before start, got ${before.status}`);
      assert(
        before.payload?.summary?.availablePoints >= 1,
        `Expected trial credits before start, got ${before.payload?.summary?.availablePoints}`
      );
      const response = await client.request('POST', `/api/projects/${projectId}/start`, {});
      assert(response.status === 200, `Expected start 200 with trial points, got ${response.status}: ${JSON.stringify(response.payload)}`);
      assert(
        response.payload?.project?.status === 'processing',
        `Expected processing status after start, got ${response.payload?.project?.status}`
      );
      const after = await client.request('GET', '/api/billing');
      assert(
        after.payload?.summary?.availablePoints <= before.payload?.summary?.availablePoints,
        'Billing points increased after project start.'
      );
      return {
        status: response.status,
        beforePoints: before.payload.summary.availablePoints,
        afterPoints: after.payload.summary.availablePoints
      };
    });

    await withStep('delete_project_cleans_r2_object', async () => {
      const response = await client.request('DELETE', `/api/projects/${projectId}`);
      assert(response.status === 200, `Expected project delete 200, got ${response.status}: ${JSON.stringify(response.payload)}`);
      projectDeleted = true;
      uploadedStorageKeys.delete(storageKey);
      return { deleted: true, cloudCleanup: response.payload.cloudCleanup };
    });

    console.log(JSON.stringify({ ok: true, results: results.length }));
  } finally {
    if (!projectDeleted && client && projectId) {
      try {
        const response = await client.request('DELETE', `/api/projects/${projectId}`);
        if (response.status === 200) {
          projectDeleted = true;
          for (const key of uploadedStorageKeys) {
            if (response.payload?.cloudCleanup?.failed === 0 || response.payload?.cloudCleanup?.deleted > 0) {
              uploadedStorageKeys.delete(key);
            }
          }
        }
      } catch {
        // Fall back to direct object cleanup below.
      }
    }
    child.kill('SIGTERM');
    await sleep(250);
    try {
      await cleanupUploadedObjects();
    } finally {
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
