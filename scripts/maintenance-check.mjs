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
const apiRoot = (process.env.METROVAN_CHECK_API_ROOT || 'https://api.metrovanai.com').replace(/\/+$/, '');
const serverRequire = createRequire(path.join(repoRoot, 'server', 'package.json'));
const results = [];

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

async function main() {
  const loadedSecrets = loadEnvFile(secretFile);
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

  const failed = results.filter((item) => !item.ok);
  console.log(JSON.stringify({ done: true, failed: failed.length }));
  if (failed.length) {
    process.exitCode = 1;
  }
}

await main();
