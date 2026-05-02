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

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = 'true'] = arg.replace(/^--/, '').split('=');
    return [key, value];
  })
);
const users = Math.max(1, Math.min(100, Number(args.get('users') ?? process.env.METROVAN_LOAD_USERS ?? 10)));
const filesPerUser = Math.max(1, Math.min(100, Number(args.get('files') ?? process.env.METROVAN_LOAD_FILES_PER_USER ?? 3)));
const pollCount = Math.max(1, Math.min(20, Number(args.get('polls') ?? process.env.METROVAN_LOAD_POLLS ?? 4)));
const sourceDir = String(args.get('source-dir') ?? process.env.METROVAN_LOAD_SOURCE_DIR ?? '').trim();
const startProcessing = args.has('start-processing') || process.env.METROVAN_LOAD_START_PROCESSING === 'true';
const processingWaitMs = Math.max(30_000, Math.min(30 * 60_000, Number(args.get('processing-wait-ms') ?? process.env.METROVAN_LOAD_PROCESSING_WAIT_MS ?? 10 * 60_000)));
const processingPollMs = Math.max(2_000, Math.min(60_000, Number(args.get('processing-poll-ms') ?? process.env.METROVAN_LOAD_PROCESSING_POLL_MS ?? 10_000)));
const port = Number(process.env.METROVAN_LOAD_TEST_PORT || 21000 + Math.floor(Math.random() * 1000));
const apiRoot = `http://127.0.0.1:${port}`;
const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'metrovan-load-upload-'));
const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
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
let serverOutput = '';
const uploadedStorageKeys = new Set();
const testProjects = [];
const RAW_EXTENSIONS = new Set(['.arw', '.cr2', '.cr3', '.crw', '.nef', '.nrw', '.raf', '.dng', '.rw2', '.rwl', '.orf', '.srw', '.3fr', '.fff', '.iiq', '.pef']);
const JPG_EXTENSIONS = new Set(['.jpg', '.jpeg']);

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return false;
  const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    let value = line.slice(separator + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    process.env[name] ??= value;
  }
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryStep(fn, attempts = 4, delayMs = 1500) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      await sleep(delayMs * attempt);
    }
  }
  throw lastError;
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

function summarizeTimings(results) {
  const names = [...new Set(results.flatMap((item) => Object.keys(item.timings ?? {})))].sort();
  const summary = {};
  for (const name of names) {
    const values = results
      .map((item) => item.timings?.[name])
      .filter((value) => Number.isFinite(value));
    if (!values.length) continue;
    summary[name] = {
      count: values.length,
      p50Ms: percentile(values, 0.5),
      p95Ms: percentile(values, 0.95),
      maxMs: Math.max(...values),
      totalMs: values.reduce((sum, value) => sum + value, 0)
    };
  }
  return summary;
}

function getSlowestTiming(timings) {
  const [name, value] =
    Object.entries(timings)
      .filter(([key]) => !key.endsWith('Wait') || key === 'processingWait')
      .sort((left, right) => right[1].p95Ms - left[1].p95Ms)[0] ?? [];
  return name ? { name, ...value } : null;
}

function getMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (JPG_EXTENSIONS.has(extension)) return 'image/jpeg';
  if (extension === '.arw') return 'image/x-sony-arw';
  if (extension === '.cr2' || extension === '.cr3' || extension === '.crw') return 'image/x-canon-crw';
  if (extension === '.nef' || extension === '.nrw') return 'image/x-nikon-nef';
  if (extension === '.dng') return 'image/x-adobe-dng';
  return 'application/octet-stream';
}

function loadSourceFiles() {
  if (!sourceDir) return [];
  const resolved = path.resolve(sourceDir);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Source dir not found: ${resolved}`);
  }
  return fs
    .readdirSync(resolved)
    .map((name) => path.join(resolved, name))
    .filter((filePath) => {
      const extension = path.extname(filePath).toLowerCase();
      return fs.statSync(filePath).isFile() && (RAW_EXTENSIONS.has(extension) || JPG_EXTENSIONS.has(extension));
    })
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right)))
    .map((filePath) => {
      const stat = fs.statSync(filePath);
      const extension = path.extname(filePath).toLowerCase();
      return {
        sourcePath: filePath,
        originalName: path.basename(filePath),
        mimeType: getMimeType(filePath),
        size: stat.size,
        extension,
        isRaw: RAW_EXTENSIONS.has(extension)
      };
    });
}

const sourceFiles = loadSourceFiles();
if (sourceDir && sourceFiles.length < users * filesPerUser) {
  throw new Error(`Source dir only has ${sourceFiles.length} supported files, need ${users * filesPerUser}.`);
}

function getUserUploadFiles(index) {
  if (!sourceFiles.length) {
    return Array.from({ length: filesPerUser }, (_, fileIndex) => ({
      originalName: `load-${stamp}-${index}-${fileIndex}.jpg`,
      mimeType: 'image/jpeg',
      size: smokeJpeg.length,
      extension: '.jpg',
      isRaw: false,
      body: smokeJpeg
    }));
  }

  const offset = (index - 1) * filesPerUser;
  return sourceFiles.slice(offset, offset + filesPerUser).map((file, fileIndex) => ({
    ...file,
    originalName: `${String(index).padStart(3, '0')}-${String(fileIndex + 1).padStart(3, '0')}-${file.originalName}`,
    body: fs.createReadStream(file.sourcePath)
  }));
}

function extractTokenFromLogs(authMode, recipient) {
  const normalized = serverOutput.replaceAll('&amp;', '&');
  const lines = normalized.split(/\r?\n/).filter((line) => line.includes(recipient)).reverse();
  for (const line of lines) {
    if (!line.includes(`auth=${authMode}`)) continue;
    const tokenMatch =
      line.match(/(?:^|[?&])token=([^&"'\s<>]+)[^"'\s<>]*[?&]auth=/) ??
      line.match(/[?&]auth=[^&"'\s<>]+[^"'\s<>]*[?&]token=([^&"'\s<>]+)/);
    if (tokenMatch?.[1]) return decodeURIComponent(tokenMatch[1]);
  }
  return null;
}

class ApiClient {
  constructor(syntheticIp) {
    this.cookies = new Map();
    this.csrfToken = '';
    this.syntheticIp = syntheticIp;
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
      const [first] = item.split(';');
      const separator = first.indexOf('=');
      if (separator === -1) continue;
      const key = first.slice(0, separator).trim();
      const value = first.slice(separator + 1).trim();
      if (value) this.cookies.set(key, value);
      else this.cookies.delete(key);
    }
  }

  async request(method, requestPath, body, options = {}) {
    const headers = { Accept: 'application/json', 'X-Forwarded-For': this.syntheticIp, ...options.headers };
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
    const payload = parseJson(await response.text());
    if (payload?.session?.csrfToken) this.csrfToken = payload.session.csrfToken;
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
      if (response.ok) return;
    } catch {
      // keep waiting
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for local server health.\n${serverOutput.slice(-4000)}`);
}

async function runUser(index) {
  const started = performance.now();
  const client = new ApiClient(`10.61.${Math.floor(index / 255)}.${(index % 254) + 1}`);
  const email = `metrovan-load-${stamp}-${index}@example.test`;
  const password = `Metrovan${stamp}!${index}`;
  const displayName = `Load User ${index}`;
  const timings = {};

  const step = async (name, fn) => {
    const stepStarted = performance.now();
    const result = await fn();
    timings[name] = Math.round(performance.now() - stepStarted);
    return result;
  };

  await step('register', async () => {
    const response = await client.request('POST', '/api/auth/register', { email, password, displayName });
    if (response.status !== 201) throw new Error(`register ${response.status}`);
  });

  await step('verify', async () => {
    const deadline = Date.now() + 10_000;
    let token = null;
    while (Date.now() < deadline && !token) {
      token = extractTokenFromLogs('verify', email);
      if (!token) await sleep(100);
    }
    if (!token) throw new Error('missing verification token');
    const response = await client.request('POST', '/api/auth/email-verification/confirm', { token });
    if (response.status !== 200) throw new Error(`verify ${response.status}`);
  });

  const projectId = await step('project', async () => {
    const response = await client.request('POST', '/api/projects', {
      name: `Load upload ${stamp}-${index}`,
      address: 'Upload load test',
      studioFeatureId: 'hdr-true-color'
    });
    if (response.status !== 201) throw new Error(`project ${response.status}`);
    testProjects.push({ client, projectId: response.payload.project.id });
    return response.payload.project.id;
  });

  const uploadedFiles = await step('directUpload', async () => {
    const files = getUserUploadFiles(index);
    const targetStarted = performance.now();
    const targetResponse = await client.request('POST', `/api/projects/${projectId}/direct-upload/targets`, { files });
    timings.directUploadTargets = Math.round(performance.now() - targetStarted);
    if (targetResponse.status !== 200) throw new Error(`targets ${targetResponse.status}`);
    const targets = targetResponse.payload.targets ?? [];
    const putStarted = performance.now();
    await Promise.all(
      targets.map(async (target, fileIndex) => {
        const upload = await fetch(target.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': files[fileIndex].mimeType, 'Content-Length': String(files[fileIndex].size) },
          body: files[fileIndex].body,
          duplex: 'half'
        });
        if (!upload.ok) throw new Error(`put ${upload.status}`);
        return { ...files[fileIndex], storageKey: target.storageKey };
      })
    );
    timings.directUploadPut = Math.round(performance.now() - putStarted);
    const completeFiles = targets.map((target, fileIndex) => ({
      originalName: target.originalName || files[fileIndex].originalName,
      mimeType: target.mimeType || files[fileIndex].mimeType,
      size: target.size || files[fileIndex].size,
      storageKey: target.storageKey
    }));
    for (const file of completeFiles) {
      uploadedStorageKeys.add(file.storageKey);
    }
    const completeStarted = performance.now();
    const complete = await retryStep(async () => {
      const response = await client.request('POST', `/api/projects/${projectId}/direct-upload/complete`, { files: completeFiles });
      if (response.status !== 200) {
        throw new Error(`complete ${response.status}: ${JSON.stringify(response.payload).slice(0, 500)}`);
      }
      return response;
    });
    timings.directUploadComplete = Math.round(performance.now() - completeStarted);
    return completeFiles;
  });

  await step('layout', async () => {
    const response = await client.request('POST', `/api/projects/${projectId}/hdr-layout`, {
      mode: 'replace',
      inputComplete: true,
      hdrItems: uploadedFiles.map((file) => ({
        exposureOriginalNames: [file.originalName],
        selectedOriginalName: file.originalName,
        exposures: [
          {
            originalName: file.originalName,
            fileName: file.originalName,
            extension: file.extension,
            mimeType: file.mimeType,
            size: file.size,
            isRaw: file.isRaw,
            storageKey: file.storageKey
          }
        ]
      }))
    });
    if (response.status !== 200) throw new Error(`layout ${response.status}`);
  });

  if (startProcessing) {
    await step('credits', async () => {
      let billing = await client.request('GET', '/api/billing');
      if (billing.status !== 200) throw new Error(`billing ${billing.status}`);
      let available = Number(billing.payload?.summary?.availablePoints ?? 0);
      const required = filesPerUser;
      while (available < required) {
        const packages = Array.isArray(billing.payload?.packages) ? billing.payload.packages : [];
        const sorted = [...packages].sort((left, right) => Number(left.points ?? 0) - Number(right.points ?? 0));
        const selected =
          sorted.find((item) => Number(item.points ?? 0) >= required - available) ??
          sorted[sorted.length - 1] ??
          null;
        if (!selected?.id) {
          throw new Error(`No billing package available for ${required - available} point shortfall.`);
        }
        const topUp = await client.request('POST', '/api/billing/top-up', { packageId: selected.id });
        if (topUp.status !== 201) throw new Error(`top-up ${topUp.status}: ${JSON.stringify(topUp.payload).slice(0, 500)}`);
        billing = topUp;
        available = Number(billing.payload?.summary?.availablePoints ?? 0);
      }
      return { availablePoints: available, requiredPoints: required };
    });
  }

  const processing = startProcessing
    ? await step('processing', async () => {
        const startStarted = performance.now();
        const start = await client.request('POST', `/api/projects/${projectId}/start`, {});
        timings.processingStart = Math.round(performance.now() - startStarted);
        if (start.status !== 200) throw new Error(`start ${start.status}: ${JSON.stringify(start.payload).slice(0, 500)}`);

        const deadline = Date.now() + processingWaitMs;
        let latestProject = start.payload.project;
        const phasePolls = {};
        const waitStarted = performance.now();
        while (Date.now() < deadline) {
          const response = await client.request('GET', `/api/projects/${projectId}`);
          if (response.status !== 200) throw new Error(`processing-poll ${response.status}`);
          latestProject = response.payload.project;
          const phase = latestProject?.job?.phase ?? latestProject?.status ?? 'unknown';
          phasePolls[phase] = (phasePolls[phase] ?? 0) + 1;
          if (latestProject?.status === 'completed' || latestProject?.status === 'failed') {
            break;
          }
          await sleep(processingPollMs);
        }
        timings.processingWait = Math.round(performance.now() - waitStarted);
        return {
          status: latestProject?.status ?? 'unknown',
          jobStatus: latestProject?.job?.status ?? null,
          jobPhase: latestProject?.job?.phase ?? null,
          resultCount: latestProject?.resultAssets?.length ?? 0,
          failedCount: latestProject?.hdrItems?.filter((item) => item.status === 'error').length ?? 0,
          phasePolls
        };
      })
    : await step('poll', async () => {
        for (let poll = 0; poll < pollCount; poll += 1) {
          const response = await client.request('GET', `/api/projects/${projectId}`);
          if (response.status !== 200) throw new Error(`poll ${response.status}`);
          await sleep(250);
        }
        return null;
      });

  return {
    ok: true,
    index,
    projectId,
    files: filesPerUser,
    totalMs: Math.round(performance.now() - started),
    timings,
    processing
  };
}

async function cleanupProjects() {
  let deleted = 0;
  let failed = 0;
  for (const project of testProjects) {
    try {
      const response = await project.client.request('DELETE', `/api/projects/${project.projectId}`);
      if (response.status === 200) {
        deleted += 1;
        continue;
      }
      failed += 1;
    } catch {
      failed += 1;
    }
  }
  if (testProjects.length) {
    console.log(JSON.stringify({ projectCleanup: { deleted, failed } }));
  }
}

function cleanupUploadedObjects() {
  if (!uploadedStorageKeys.size) return;
  const code = [
    "import { deleteObjectsFromStorage } from './src/object-storage.ts';",
    '(async()=>{',
    `const result = await deleteObjectsFromStorage(${JSON.stringify([...uploadedStorageKeys])});`,
    'console.log(JSON.stringify(result));',
    'if (result.failed.length) process.exit(1);',
    '})().catch((error)=>{ console.error(error); process.exit(1); });'
  ].join(' ');
  try {
    const output = execFileSync('pnpm', ['--filter', 'metrovan-ai-server', 'exec', 'tsx', '-e', code], {
      cwd: repoRoot,
      env: process.env,
      encoding: 'utf8'
    }).trim();
    const cleanup = parseJson(output);
    console.log(JSON.stringify({ cleanup: { deleted: cleanup?.deleted ?? 0, failed: cleanup?.failed?.length ?? 0 } }));
  } catch (error) {
    console.warn(`Load test cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main() {
  loadEnvFile(secretFile);
  const missing = requiredObjectStorageEnv.filter((name) => !process.env[name]?.trim());
  if (missing.length) {
    console.log(JSON.stringify({ ok: false, skipped: true, reason: 'missing_object_storage_env', missing }));
    process.exit(1);
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
      METROVAN_ALLOW_INTERNAL_TOP_UP: 'true',
      AUTH_EMAIL_LOG_DELIVERY: 'true',
      AUTH_EMAIL_LOG_LINKS: 'true',
      SMTP_HOST: '',
      SMTP_FROM: '',
      METROVAN_TASK_EXECUTOR: 'runpod-native'
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
    await waitForHealth(child);
    const started = performance.now();
    const results = await Promise.allSettled(Array.from({ length: users }, (_unused, index) => runUser(index + 1)));
    const fulfilled = results.filter((item) => item.status === 'fulfilled').map((item) => item.value);
    const rejected = results.filter((item) => item.status === 'rejected').map((item) => item.reason);
    const totals = fulfilled.map((item) => item.totalMs);
    const timings = summarizeTimings(fulfilled);
    const processingResults = fulfilled.map((item) => item.processing).filter(Boolean);
    const processingStatuses = processingResults.reduce((counts, item) => {
      counts[item.status] = (counts[item.status] ?? 0) + 1;
      return counts;
    }, {});
    const processingIncomplete = startProcessing
      ? processingResults.filter((item) => item.status !== 'completed')
      : [];
    const summary = {
      ok: rejected.length === 0 && processingIncomplete.length === 0,
      users,
      filesPerUser,
      totalFiles: users * filesPerUser,
      succeeded: fulfilled.length,
      failed: rejected.length,
      processing: startProcessing
        ? {
            statuses: processingStatuses,
            completedProjects: processingStatuses.completed ?? 0,
            incompleteProjects: processingIncomplete.length,
            resultCount: processingResults.reduce((sum, item) => sum + Number(item.resultCount ?? 0), 0),
            failedItems: processingResults.reduce((sum, item) => sum + Number(item.failedCount ?? 0), 0)
          }
        : null,
      totalMs: Math.round(performance.now() - started),
      p50Ms: percentile(totals, 0.5),
      p95Ms: percentile(totals, 0.95),
      maxMs: totals.length ? Math.max(...totals) : 0,
      slowestStep: getSlowestTiming(timings),
      timings,
      errors: [
        ...rejected.slice(0, 5).map((error) => (error instanceof Error ? error.message : String(error))),
        ...processingIncomplete.slice(0, 5).map((item) => `processing ${item.status} phase=${item.jobPhase ?? 'unknown'}`)
      ]
    };
    console.log(JSON.stringify(summary, null, 2));
    if (rejected.length) process.exitCode = 1;
  } finally {
    await cleanupProjects();
    cleanupUploadedObjects();
    child.kill('SIGTERM');
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
