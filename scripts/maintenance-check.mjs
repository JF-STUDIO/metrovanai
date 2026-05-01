import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');
const workspaceRoot = path.resolve(repoRoot, '..');
const secretFile =
  process.env.METROVAN_SECRET_FILE ||
  path.join(workspaceRoot, 'PRIVATE_METROVAN_AI_SECRETS_REAL_DO_NOT_SHARE.env.local');
const frontendUrl = process.env.METROVAN_CHECK_FRONTEND_URL || 'https://metrovanai.com/';
const apiRoot = (process.env.METROVAN_CHECK_API_ROOT || 'https://metrovanai.com').replace(/\/+$/, '');
const serverRequire = createRequire(path.join(repoRoot, 'server', 'package.json'));
const results = [];
const reportStartedAt = new Date();
const monitoredEnvNames = [
  'METROVAN_RENDER_PRODUCTION_SERVICE_ID',
  'RENDER_API_KEY',
  'SUPABASE_DB_URL',
  'DATABASE_URL',
  'POSTGRES_URL',
  'METROVAN_METADATA_TABLE',
  'METROVAN_METADATA_DOCUMENT_ID',
  'METROVAN_POSTGRES_SSL',
  'METROVAN_OBJECT_STORAGE_ENDPOINT',
  'METROVAN_OBJECT_STORAGE_BUCKET',
  'METROVAN_OBJECT_STORAGE_ACCESS_KEY_ID',
  'METROVAN_OBJECT_STORAGE_SECRET_ACCESS_KEY',
  'METROVAN_OBJECT_STORAGE_REGION',
  'METROVAN_OBJECT_STORAGE_FORCE_PATH_STYLE',
  'METROVAN_OBJECT_STORAGE_INCOMING_PREFIX',
  'METROVAN_OBJECT_STORAGE_PERSISTENT_PREFIX'
];

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2 &&
      ((value.charCodeAt(0) === 34 && value.charCodeAt(value.length - 1) === 34) ||
        (value.charCodeAt(0) === 39 && value.charCodeAt(value.length - 1) === 39))
    ) {
      value = value.slice(1, -1);
    }
    process.env[name] = value;
  }
  return true;
}

function record(id, ok, details = {}) {
  const item = { id, ok, ...details };
  results.push(item);
  console.log(JSON.stringify(item));
}

function normalizeMonitoredEnv() {
  for (const name of monitoredEnvNames) {
    const value = process.env[name];
    if (typeof value === 'string') {
      process.env[name] = value.replace(/[\r\n]+$/g, '');
    }
  }
}

function redactError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[A-Za-z0-9_:/+=.-]{24,}/g, '<redacted>');
}

async function checkUrl(id, url, options = {}) {
  try {
    const response = await fetch(url, { method: options.method || 'GET', headers: { Accept: '*/*' } });
    record(id, response.ok, {
      status: response.status,
      contentType: response.headers.get('content-type') || null
    });
  } catch (error) {
    record(id, false, { error: redactError(error) });
  }
}

async function checkRender() {
  const serviceId = process.env.METROVAN_RENDER_PRODUCTION_SERVICE_ID;
  const apiKey = process.env.RENDER_API_KEY;
  if (!serviceId || !apiKey) {
    record('render_api', true, { skipped: true, reason: 'Render credentials not loaded.' });
    return;
  }

  try {
    const response = await fetch(`https://api.render.com/v1/services/${serviceId}/deploys?limit=1`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    const payload = await response.json().catch(() => null);
    const latest = Array.isArray(payload) ? payload[0] : null;
    record('render_api', response.ok, {
      status: response.status,
      latestStatus: latest?.deploy?.status ?? latest?.status ?? null,
      latestCommit: latest?.deploy?.commit?.id?.slice?.(0, 12) ?? latest?.commit?.id?.slice?.(0, 12) ?? null
    });
  } catch (error) {
    record('render_api', false, { error: redactError(error) });
  }
}

async function checkDatabase() {
  const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) {
    record('database', true, { skipped: true, reason: 'Database URL not loaded.' });
    return;
  }

  const pg = serverRequire('pg');
  const client = new pg.Client({
    connectionString,
    ssl: process.env.METROVAN_POSTGRES_SSL === 'false' ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 10_000
  });

  try {
    await client.connect();
    const table = process.env.METROVAN_METADATA_TABLE;
    let metadataRows = null;
    let metadataDocumentFound = null;
    if (table && /^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
      const count = await client.query(`select count(*)::int as rows from ${table}`);
      metadataRows = count.rows[0]?.rows ?? null;
      if (process.env.METROVAN_METADATA_DOCUMENT_ID) {
        const document = await client.query(`select 1 from ${table} where id = $1 limit 1`, [
          process.env.METROVAN_METADATA_DOCUMENT_ID
        ]);
        metadataDocumentFound = document.rowCount > 0;
      }
    }
    record('database', true, { metadataTable: table || null, metadataRows, metadataDocumentFound });
  } catch (error) {
    record('database', false, { error: redactError(error) });
  } finally {
    await client.end().catch(() => undefined);
  }
}

function getMetadataTableName() {
  const table = process.env.METROVAN_METADATA_TABLE || 'metrovan_metadata';
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(table)) {
    throw new Error(`Invalid metadata table name: ${table}`);
  }
  return table
    .split('.')
    .map((part) => `"${part.replace(/"/g, '""')}"`)
    .join('.');
}

function isCompletedHdrItem(item) {
  return Boolean(item?.resultUrl && item?.resultFileName && (item?.resultKey || item?.resultPath));
}

function hasRawJpegSidecarMix(exposures) {
  const rawExtensions = new Set([
    '.arw',
    '.cr2',
    '.cr3',
    '.crw',
    '.nef',
    '.nrw',
    '.dng',
    '.raf',
    '.rw2',
    '.rwl',
    '.orf',
    '.srw',
    '.3fr',
    '.fff',
    '.iiq',
    '.pef',
    '.erf'
  ]);
  const jpegExtensions = new Set(['.jpg', '.jpeg']);
  const rawStems = new Set();
  const jpegStems = new Set();
  for (const exposure of exposures ?? []) {
    const name = path.basename(String(exposure?.originalName || exposure?.fileName || '').replace(/\\/g, '/')).toLowerCase();
    const extension = path.extname(name);
    const stem = extension ? name.slice(0, -extension.length) : name;
    if (rawExtensions.has(extension)) rawStems.add(stem);
    if (jpegExtensions.has(extension)) jpegStems.add(stem);
  }
  return Array.from(jpegStems).some((stem) => rawStems.has(stem));
}

function getProjectName(project) {
  return String(project?.name || project?.address || project?.id || 'Untitled project');
}

function getRecommendedActionLabel(action) {
  if (action === 'retry-failed-processing') return '重试失败照片';
  if (action === 'regenerate-download') return '重新生成下载包';
  if (action === 'mark-stalled-failed') return '标记卡住失败';
  if (action === 'deep-health') return '深度巡检';
  return action;
}

function buildApplicationPriorityQueue({ projects, failedItems, sidecarGroups, stalledProjects, recentFailedDownloads, creditMismatchProjects }) {
  const byProject = new Map();
  const ensure = (project) => {
    const id = String(project?.id || '').trim();
    if (!id) return null;
    if (!byProject.has(id)) {
      byProject.set(id, {
        projectId: id,
        projectName: getProjectName(project),
        userKey: project.userKey ?? null,
        updatedAt: project.updatedAt ?? null,
        score: 0,
        errorCount: 0,
        warningCount: 0,
        reasons: [],
        recommendedActions: []
      });
    }
    return byProject.get(id);
  };
  const addReason = (project, reason) => {
    const entry = ensure(project);
    if (!entry) return;
    entry.score += reason.score;
    if (reason.severity === 'error') entry.errorCount += 1;
    else entry.warningCount += 1;
    entry.reasons.push({
      code: reason.code,
      severity: reason.severity,
      title: reason.title,
      detail: reason.detail
    });
    if (reason.action && !entry.recommendedActions.includes(reason.action)) {
      entry.recommendedActions.push(reason.action);
    }
  };

  const failedByProject = new Map();
  for (const { project } of failedItems) {
    const id = String(project?.id || '');
    failedByProject.set(id, (failedByProject.get(id) ?? 0) + 1);
  }
  for (const [projectId, count] of failedByProject.entries()) {
    const project = projects.find((item) => item.id === projectId);
    addReason(project, {
      code: 'failed-processing-items',
      severity: 'error',
      title: '照片处理失败',
      detail: `${count} 张失败照片没有结果图。`,
      action: 'retry-failed-processing',
      score: 100 + count * 25
    });
  }

  const sidecarsByProject = new Map();
  for (const { project } of sidecarGroups) {
    const id = String(project?.id || '');
    sidecarsByProject.set(id, (sidecarsByProject.get(id) ?? 0) + 1);
  }
  for (const [projectId, count] of sidecarsByProject.entries()) {
    const project = projects.find((item) => item.id === projectId);
    addReason(project, {
      code: 'raw-jpeg-sidecar-groups',
      severity: 'warning',
      title: 'RAW/JPG 混组',
      detail: `${count} 个 HDR 组混入同名 JPG 副本。`,
      action: 'deep-health',
      score: 10 + count * 5
    });
  }

  const failedDownloadsByProject = new Map();
  for (const job of recentFailedDownloads) {
    const id = String(job?.projectId || '');
    if (!id) continue;
    const current = failedDownloadsByProject.get(id);
    if (!current || Number(job.completedAt || job.createdAt || 0) > Number(current.completedAt || current.createdAt || 0)) {
      failedDownloadsByProject.set(id, job);
    }
  }
  for (const [projectId, job] of failedDownloadsByProject.entries()) {
    const project = projects.find((item) => item.id === projectId);
    addReason(project, {
      code: 'recent-failed-downloads',
      severity: 'warning',
      title: '下载包生成失败',
      detail: job.error ? `最近下载任务失败：${String(job.error).slice(0, 160)}` : '最近下载任务失败。',
      action: 'regenerate-download',
      score: 30
    });
  }

  for (const project of stalledProjects) {
    const minutes = Math.floor((Date.now() - Date.parse(project.updatedAt)) / 60000);
    addReason(project, {
      code: 'stalled-project',
      severity: 'error',
      title: '项目疑似卡住',
      detail: `项目已 ${minutes} 分钟没有更新。`,
      action: 'mark-stalled-failed',
      score: 130
    });
  }

  for (const project of creditMismatchProjects) {
    addReason(project, {
      code: 'credit-mismatch-project',
      severity: 'warning',
      title: '积分和结果数量不一致',
      detail: `记录扣费 ${Number(project.pointsSpent ?? 0)}，完成结果 ${(project.hdrItems ?? []).filter(isCompletedHdrItem).length}。`,
      action: 'deep-health',
      score: 15
    });
  }

  return Array.from(byProject.values())
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return Date.parse(right.updatedAt || '') - Date.parse(left.updatedAt || '');
    })
    .slice(0, 5)
    .map((entry) => ({
      ...entry,
      priority: entry.score >= 100 ? 'high' : entry.score >= 40 ? 'medium' : 'low',
      rootCauseSummary: entry.reasons[0]?.detail ?? '需要检查项目状态。',
      recommendedActionLabels: entry.recommendedActions.map(getRecommendedActionLabel)
    }));
}

async function checkApplicationData() {
  const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) {
    record('application_data', true, { skipped: true, reason: 'Database URL not loaded.' });
    return;
  }

  const pg = serverRequire('pg');
  const client = new pg.Client({
    connectionString,
    ssl: process.env.METROVAN_POSTGRES_SSL === 'false' ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 10_000
  });

  try {
    await client.connect();
    const tableName = getMetadataTableName();
    const documentId = process.env.METROVAN_METADATA_DOCUMENT_ID || 'default';
    const response = await client.query(`select data from ${tableName} where id = $1 limit 1`, [documentId]);
    const data = response.rows[0]?.data ?? {};
    const projects = Array.isArray(data.projects) ? data.projects : [];
    const downloadJobs = Array.isArray(data.downloadJobs) ? data.downloadJobs : [];
    const hdrItems = projects.flatMap((project) =>
      Array.isArray(project.hdrItems) ? project.hdrItems.map((item) => ({ project, item })) : []
    );
    const failedItems = hdrItems.filter(({ item }) => item?.status === 'error' && !isCompletedHdrItem(item));
    const sidecarGroups = hdrItems.filter(({ item }) => hasRawJpegSidecarMix(item?.exposures));
    const stalledProjects = projects.filter((project) => {
      const updatedAt = Date.parse(project.updatedAt);
      return (
        (project.status === 'processing' || project.status === 'uploading' || project.job?.status === 'running') &&
        Number.isFinite(updatedAt) &&
        Date.now() - updatedAt > 45 * 60 * 1000
      );
    });
    const recentFailedDownloads = downloadJobs.filter((job) => {
      const completedAt = Number(job.completedAt || job.createdAt || 0);
      return job.status === 'failed' && completedAt && Date.now() - completedAt < 24 * 60 * 60 * 1000;
    });
    const creditMismatchProjects = projects.filter((project) => {
      const completedCount = (project.hdrItems ?? []).filter(isCompletedHdrItem).length;
      return Number(project.pointsSpent ?? 0) !== completedCount;
    });
    const alerts = [
      failedItems.length ? { code: 'failed-items', value: failedItems.length } : null,
      sidecarGroups.length ? { code: 'raw-jpeg-sidecar-groups', value: sidecarGroups.length } : null,
      stalledProjects.length ? { code: 'stalled-projects', value: stalledProjects.length } : null,
      recentFailedDownloads.length ? { code: 'recent-failed-downloads', value: recentFailedDownloads.length } : null,
      creditMismatchProjects.length ? { code: 'credit-mismatch-projects', value: creditMismatchProjects.length } : null
    ].filter(Boolean);
    const priorityQueue = buildApplicationPriorityQueue({
      projects,
      failedItems,
      sidecarGroups,
      stalledProjects,
      recentFailedDownloads,
      creditMismatchProjects
    });

    record('application_data', alerts.length === 0, {
      totals: {
        projects: projects.length,
        hdrItems: hdrItems.length,
        downloadJobs: downloadJobs.length
      },
      alerts,
      samples: {
        failedProjectIds: Array.from(new Set(failedItems.map(({ project }) => project.id))).slice(0, 10),
        stalledProjectIds: stalledProjects.slice(0, 10).map((project) => project.id),
        failedDownloadJobIds: recentFailedDownloads.slice(0, 10).map((job) => job.jobId)
      },
      priorityQueue
    });
  } catch (error) {
    record('application_data', false, { error: redactError(error) });
  } finally {
    await client.end().catch(() => undefined);
  }
}

function hmac(key, value) {
  return crypto.createHmac('sha256', key).update(value, 'utf8').digest();
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function toAmzDate(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function encodePathSegment(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function buildCanonicalQuery(pairs) {
  return pairs
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

function buildR2ListRequest(prefix) {
  const endpoint = process.env.METROVAN_OBJECT_STORAGE_ENDPOINT?.replace(/\/+$/, '');
  const bucket = process.env.METROVAN_OBJECT_STORAGE_BUCKET;
  const accessKeyId = process.env.METROVAN_OBJECT_STORAGE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.METROVAN_OBJECT_STORAGE_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return null;
  }

  const region = process.env.METROVAN_OBJECT_STORAGE_REGION || 'auto';
  const forcePathStyle = ['true', '1', 'yes'].includes(
    String(process.env.METROVAN_OBJECT_STORAGE_FORCE_PATH_STYLE || '').toLowerCase()
  );
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const payloadHash = 'UNSIGNED-PAYLOAD';
  const url = new URL(endpoint);
  if (forcePathStyle) {
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/${encodePathSegment(bucket)}`;
  } else {
    url.hostname = `${bucket}.${url.hostname}`;
  }

  const canonicalQuery = buildCanonicalQuery([
    ['list-type', '2'],
    ['max-keys', '5'],
    ['prefix', prefix]
  ]);
  url.search = canonicalQuery;

  const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = ['GET', url.pathname || '/', canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex');
  return {
    url,
    headers: {
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate
    }
  };
}

async function checkR2() {
  const prefixes = [
    process.env.METROVAN_OBJECT_STORAGE_INCOMING_PREFIX || 'incoming',
    process.env.METROVAN_OBJECT_STORAGE_PERSISTENT_PREFIX || 'projects'
  ];
  const probes = [];

  for (const prefix of prefixes) {
    const request = buildR2ListRequest(`${prefix.replace(/\/+$/, '')}/`);
    if (!request) {
      record('r2_storage', true, { skipped: true, reason: 'Object storage credentials not loaded.' });
      return;
    }

    try {
      const response = await fetch(request.url, { headers: request.headers });
      const body = await response.text();
      probes.push({
        prefix,
        ok: response.ok,
        status: response.status,
        sampleKeys: [...body.matchAll(/<Key>([\s\S]*?)<\/Key>/g)].length
      });
    } catch (error) {
      probes.push({ prefix, ok: false, error: redactError(error) });
    }
  }

  record('r2_storage', probes.every((probe) => probe.ok), { probes });
}

function ensureReportsDir() {
  const reportsDir = process.env.METROVAN_MAINTENANCE_REPORT_DIR || path.join(repoRoot, 'reports', 'maintenance');
  fs.mkdirSync(reportsDir, { recursive: true });
  return reportsDir;
}

function writeReport() {
  const failed = results.filter((item) => !item.ok);
  const report = {
    startedAt: reportStartedAt.toISOString(),
    completedAt: new Date().toISOString(),
    ok: failed.length === 0,
    failedCount: failed.length,
    results
  };
  const reportsDir = ensureReportsDir();
  const stamp = report.completedAt.replace(/[:-]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const target = path.join(reportsDir, `maintenance-${stamp}.json`);
  fs.writeFileSync(target, JSON.stringify(report, null, 2));
  return { report, target };
}

function getAlertRecipients() {
  return String(process.env.METROVAN_MAINTENANCE_ALERT_EMAILS || process.env.METROVAN_ADMIN_EMAILS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

async function sendMaintenanceAlert(report, reportPath) {
  if (report.ok) {
    return { sent: false, reason: 'no_alerts' };
  }

  const host = process.env.SMTP_HOST?.trim();
  const from = process.env.SMTP_FROM?.trim();
  const recipients = getAlertRecipients();
  if (!host || !from || !recipients.length) {
    return { sent: false, reason: 'smtp_not_configured' };
  }

  const nodemailer = serverRequire('nodemailer');
  const port = Number(process.env.SMTP_PORT || 587);
  const secureValue = String(process.env.SMTP_SECURE || '').toLowerCase();
  const secure = secureValue ? ['true', '1', 'yes'].includes(secureValue) : port === 465;
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined
  });
  const failedLines = report.results
    .filter((item) => !item.ok)
    .map((item) => `- ${item.id}: ${JSON.stringify(item).slice(0, 800)}`)
    .join('\n');
  const applicationData = report.results.find((item) => item.id === 'application_data');
  const priorityQueue = Array.isArray(applicationData?.priorityQueue) ? applicationData.priorityQueue : [];
  const priorityLines = priorityQueue.length
    ? priorityQueue
        .map((item, index) => {
          const actions = item.recommendedActionLabels?.length ? item.recommendedActionLabels.join(' / ') : '后台查看';
          return `${index + 1}. [${item.priority}] ${item.projectName} (${item.projectId})\n   ${item.rootCauseSummary}\n   建议：${actions}`;
        })
        .join('\n')
    : 'No prioritized project issues were found in the application data check.';
  await transporter.sendMail({
    from,
    to: recipients,
    subject: `[Metrovan AI] Maintenance alert (${report.failedCount})`,
    text: `Metrovan AI automated maintenance found ${report.failedCount} failing check(s).\n\nTop project issues:\n${priorityLines}\n\nFailing checks:\n${failedLines}\n\nReport: ${reportPath}\nCompleted: ${report.completedAt}`
  });
  return { sent: true, recipients: recipients.length };
}

async function main() {
  const loadedSecrets = loadEnvFile(secretFile);
  normalizeMonitoredEnv();
  const ciEnvironment = process.env.CI === 'true';
  record('local_secrets_file', loadedSecrets || ciEnvironment, {
    loaded: loadedSecrets,
    skipped: !loadedSecrets && ciEnvironment,
    path: loadedSecrets ? '<configured>' : secretFile
  });
  await checkUrl('frontend', frontendUrl, { method: 'HEAD' });
  await checkUrl('backend_health', `${apiRoot}/api/health`);
  await checkRender();
  await checkDatabase();
  await checkR2();
  await checkApplicationData();

  const { report, target } = writeReport();
  const alert = await sendMaintenanceAlert(report, target).catch((error) => ({
    sent: false,
    error: redactError(error)
  }));
  record('maintenance_report', true, { path: target, alert });
  const failed = results.filter((item) => !item.ok);
  console.log(JSON.stringify({ done: true, failed: failed.length }));
  if (failed.length) {
    process.exitCode = 1;
  }
}

await main();
