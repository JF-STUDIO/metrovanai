import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '..');
const inputDir = process.env.METROVAN_STRESS_INPUT_DIR || 'C:\\Users\\zhouj\\Downloads\\4.16-20260417T020034Z-3-002\\4.16';
const accountCount = Math.max(1, Number(process.env.METROVAN_STRESS_ACCOUNTS || 3));
const photosPerAccount = Math.max(3, Number(process.env.METROVAN_STRESS_PHOTOS_PER_ACCOUNT || 6));
const groupSize = Math.max(1, Number(process.env.METROVAN_STRESS_GROUP_SIZE || 3));
const creditPoints = Math.max(1, Number(process.env.METROVAN_STRESS_CREDIT_POINTS || 500));
const port = Number(process.env.METROVAN_STRESS_PORT || 19878);
const apiRoot = `http://127.0.0.1:${port}`;
const runtimeRoot = process.env.METROVAN_STRESS_RUNTIME_ROOT || path.join(os.tmpdir(), `metrovan-stress-${Date.now()}`);
const password = `MetrovanStress${Date.now()}1`;
const supportedExtensions = new Set(['.arw', '.cr2', '.cr3', '.nef', '.raf', '.dng', '.jpg', '.jpeg']);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickInputFiles() {
  assert(fs.existsSync(inputDir), `Input directory does not exist: ${inputDir}`);
  return fs
    .readdirSync(inputDir)
    .filter((name) => supportedExtensions.has(path.extname(name).toLowerCase()))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }))
    .map((name) => path.join(inputDir, name));
}

function startServer() {
  fs.mkdirSync(runtimeRoot, { recursive: true });
  const child = spawn(process.execPath, ['server/dist/index.js'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      METROVAN_RUNTIME_ROOT: runtimeRoot,
      METROVAN_METADATA_PROVIDER: 'json-file',
      METROVAN_STORAGE_PROVIDER: 'local-disk',
      METROVAN_TASK_EXECUTOR: 'mock',
      METROVAN_MOCK_WORKFLOW_LATENCY_MS: process.env.METROVAN_MOCK_WORKFLOW_LATENCY_MS || '150',
      METROVAN_MOCK_WORKFLOW_MAX_IN_FLIGHT: process.env.METROVAN_MOCK_WORKFLOW_MAX_IN_FLIGHT || '24',
      METROVAN_LOCAL_PROXY_UPLOAD_ENABLED: 'true',
      METROVAN_DIRECT_UPLOAD_ENABLED: 'false',
      SUPABASE_DB_URL: '',
      DATABASE_URL: '',
      POSTGRES_URL: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', (chunk) => process.stdout.write(`[server] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));
  return child;
}

async function waitForServer(child) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited before health check with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${apiRoot}/api/health`);
      if (response.ok) return;
    } catch {
      // Server is still booting.
    }
    await sleep(500);
  }
  throw new Error('Timed out waiting for local stress server.');
}

function readDb() {
  return JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'db.json'), 'utf8'));
}

function writeDb(db) {
  fs.writeFileSync(path.join(runtimeRoot, 'db.json'), JSON.stringify(db, null, 2), 'utf8');
}

function verifyAndCreditUsers(accounts) {
  const db = readDb();
  const now = new Date().toISOString();
  for (const account of accounts) {
    const user = db.users.find((item) => item.email === account.email);
    assert(user, `User not found in test db: ${account.email}`);
    user.emailVerifiedAt = user.emailVerifiedAt || now;
    db.billing.unshift({
      id: crypto.randomBytes(8).toString('hex'),
      userKey: user.userKey,
      type: 'credit',
      points: creditPoints,
      amountUsd: 0,
      note: 'Stress test admin credit',
      projectId: null,
      projectName: '',
      activationCodeId: null,
      activationCode: null,
      activationCodeLabel: null,
      createdAt: now
    });
  }
  writeDb(db);
}

class ApiClient {
  constructor(email) {
    this.email = email;
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
    for (const cookie of setCookies) {
      const first = cookie.split(';')[0];
      const separator = first.indexOf('=');
      if (separator === -1) continue;
      this.cookies.set(first.slice(0, separator), first.slice(separator + 1));
    }
  }

  async request(method, requestPath, body) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;
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
    const payload = text ? JSON.parse(text) : null;
    if (payload?.session?.csrfToken) this.csrfToken = payload.session.csrfToken;
    if (!response.ok) {
      throw new Error(`${method} ${requestPath} failed ${response.status}: ${JSON.stringify(payload)}`);
    }
    return payload;
  }

  async uploadFiles(projectId, files) {
    const form = new FormData();
    for (const filePath of files) {
      const blob = await fs.openAsBlob(filePath);
      form.append('files', blob, path.basename(filePath));
    }
    const headers = {};
    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;
    if (this.csrfToken) headers['X-CSRF-Token'] = this.csrfToken;
    const response = await fetch(`${apiRoot}/api/projects/${projectId}/files`, {
      method: 'POST',
      headers,
      body: form
    });
    this.captureCookies(response);
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new Error(`upload failed ${response.status}: ${JSON.stringify(payload)}`);
    }
    return payload.project;
  }
}

function splitIntoGroups(files) {
  const groups = [];
  for (let index = 0; index < files.length; index += groupSize) {
    const chunk = files.slice(index, index + groupSize);
    if (chunk.length) {
      groups.push({
        exposureOriginalNames: chunk.map((filePath) => path.basename(filePath)),
        selectedOriginalName: path.basename(chunk[Math.floor(chunk.length / 2)] || chunk[0])
      });
    }
  }
  return groups;
}

async function pollProject(client, projectId) {
  const deadline = Date.now() + 5 * 60_000;
  let project = null;
  while (Date.now() < deadline) {
    project = (await client.request('GET', `/api/projects/${projectId}`)).project;
    const status = project.status;
    const returned = project.job?.workflowRealtime?.returned ?? 0;
    const total = project.job?.workflowRealtime?.total ?? 0;
    process.stdout.write(`\r[${client.email}] ${status} returned=${returned}/${total} results=${project.resultAssets?.length ?? 0}   `);
    if (status === 'completed' || status === 'failed') {
      process.stdout.write('\n');
      return project;
    }
    await sleep(1500);
  }
  throw new Error(`Timed out waiting for project ${projectId}`);
}

async function downloadArchive(client, projectId) {
  const response = await fetch(`${apiRoot}/api/projects/${projectId}/download`, {
    headers: {
      Cookie: client.cookieHeader()
    }
  });
  const bytes = await response.arrayBuffer();
  if (!response.ok) {
    throw new Error(`download failed ${response.status}: ${Buffer.from(bytes).toString('utf8')}`);
  }
  return bytes.byteLength;
}

async function runAccount(account, files) {
  const client = new ApiClient(account.email);
  const timings = {};
  let start = Date.now();
  await client.request('POST', '/api/auth/login', { email: account.email, password });
  timings.loginMs = Date.now() - start;

  start = Date.now();
  const project = (await client.request('POST', '/api/projects', {
    name: `Mock stress ${account.index + 1}`,
    address: 'Stress test'
  })).project;
  timings.createProjectMs = Date.now() - start;

  start = Date.now();
  await client.uploadFiles(project.id, files);
  timings.uploadMs = Date.now() - start;

  start = Date.now();
  const grouped = (await client.request('POST', `/api/projects/${project.id}/hdr-layout`, {
    mode: 'replace',
    inputComplete: true,
    hdrItems: splitIntoGroups(files)
  })).project;
  timings.groupMs = Date.now() - start;

  start = Date.now();
  await client.request('POST', `/api/projects/${project.id}/start`, {});
  const completed = await pollProject(client, project.id);
  timings.processMs = Date.now() - start;

  start = Date.now();
  const downloadBytes = await downloadArchive(client, project.id);
  timings.downloadMs = Date.now() - start;

  const billing = await client.request('GET', '/api/billing');
  return {
    email: account.email,
    projectId: project.id,
    uploadedFiles: files.length,
    hdrGroups: grouped.hdrItems.length,
    status: completed.status,
    results: completed.resultAssets.length,
    pointsEstimate: completed.pointsEstimate,
    pointsSpent: completed.pointsSpent,
    availablePoints: billing.summary.availablePoints,
    downloadBytes,
    timings
  };
}

async function main() {
  assert(fs.existsSync(path.join(repoRoot, 'server', 'dist', 'index.js')), 'Run server build first: pnpm --filter metrovan-ai-server build');
  const allFiles = pickInputFiles();
  assert(allFiles.length >= accountCount * photosPerAccount, `Need at least ${accountCount * photosPerAccount} supported files, found ${allFiles.length}`);

  const server = startServer();
  const startedAt = Date.now();
  try {
    await waitForServer(server);
    const stamp = Date.now();
    const accounts = Array.from({ length: accountCount }, (_, index) => ({
      index,
      email: `metrovan-stress-${stamp}-${index + 1}@example.com`
    }));

    await Promise.all(
      accounts.map((account) => {
        const client = new ApiClient(account.email);
        return client.request('POST', '/api/auth/register', {
          email: account.email,
          displayName: `Stress ${account.index + 1}`,
          password
        });
      })
    );
    verifyAndCreditUsers(accounts);

    const results = await Promise.all(
      accounts.map((account, index) => {
        const offset = index * photosPerAccount;
        return runAccount(account, allFiles.slice(offset, offset + photosPerAccount));
      })
    );

    const summary = {
      ok: results.every((item) => item.status === 'completed' && item.results === item.hdrGroups),
      apiRoot,
      runtimeRoot,
      inputDir,
      accountCount,
      photosPerAccount,
      groupSize,
      totalMs: Date.now() - startedAt,
      results
    };
    console.log(JSON.stringify(summary, null, 2));
    if (!summary.ok) {
      process.exitCode = 1;
    }
  } finally {
    server.kill('SIGTERM');
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
