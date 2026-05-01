import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');
const workspaceRoot = path.resolve(repoRoot, '..');
const serverRequire = createRequire(path.join(repoRoot, 'server', 'package.json'));
const secretFile =
  process.env.METROVAN_SECRET_FILE ||
  path.join(workspaceRoot, 'PRIVATE_METROVAN_AI_SECRETS_REAL_DO_NOT_SHARE.env.local');

const applyChanges = process.argv.includes('--apply');
const verbose = process.argv.includes('--verbose');
const projectIdArg = process.argv.find((arg) => arg.startsWith('--project-id='))?.slice('--project-id='.length) || '';

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
    process.env[name] = value.replace(/[\r\n]+$/g, '');
  }
  return true;
}

function quoteQualifiedIdentifier(input) {
  const parts = input.split('.').map((part) => part.trim()).filter(Boolean);
  if (!parts.length || parts.length > 2) {
    throw new Error(`Invalid Postgres table name: ${input}`);
  }
  return parts
    .map((part) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(part)) {
        throw new Error(`Invalid Postgres identifier: ${part}`);
      }
      return `"${part.replaceAll('"', '""')}"`;
    })
    .join('.');
}

function normalizeKey(input) {
  return String(input || '').replace(/^\/+/, '').replace(/\\/g, '/');
}

function isIncomingKey(storageKey) {
  const incomingPrefix = normalizeKey(process.env.METROVAN_OBJECT_STORAGE_INCOMING_PREFIX || 'incoming');
  const normalized = normalizeKey(storageKey);
  return Boolean(normalized && incomingPrefix && (normalized === incomingPrefix || normalized.startsWith(`${incomingPrefix}/`)));
}

function redactKey(storageKey) {
  const basename = path.posix.basename(normalizeKey(storageKey));
  return basename.length > 72 ? `${basename.slice(0, 28)}...${basename.slice(-28)}` : basename;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function createEmptyDatabase() {
  return {
    projects: [],
    billing: [],
    paymentOrders: [],
    processedStripeEvents: [],
    activationCodes: [],
    downloadJobs: [],
    users: [],
    sessions: [],
    passwordResetTokens: [],
    emailVerificationTokens: [],
    auditLogs: [],
    systemSettings: {}
  };
}

function normalizeDatabase(raw) {
  const fallback = createEmptyDatabase();
  const source = isPlainObject(raw) ? raw : {};
  return {
    ...fallback,
    ...source,
    projects: Array.isArray(source.projects) ? source.projects : []
  };
}

async function main() {
  loadEnvFile(secretFile);

  const objectStorageModulePath = path.join(repoRoot, 'server', 'dist', 'object-storage.js');
  if (!fs.existsSync(objectStorageModulePath)) {
    throw new Error('Missing server/dist/object-storage.js. Run `pnpm --filter metrovan-ai-server build` first.');
  }

  const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error('Missing SUPABASE_DB_URL, DATABASE_URL, or POSTGRES_URL.');
  }

  const { createPersistentObjectKey, copyObjectInStorage, getObjectStorageMetadata } = await import(
    `${objectStorageModulePath}?t=${Date.now()}`
  );
  const pg = serverRequire('pg');
  const client = new pg.Client({
    connectionString,
    ssl: process.env.METROVAN_POSTGRES_SSL === 'false' ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 10_000
  });

  const table = quoteQualifiedIdentifier(process.env.METROVAN_METADATA_TABLE || 'metrovan_metadata');
  const documentId = process.env.METROVAN_METADATA_DOCUMENT_ID || 'default';
  await client.connect();

  try {
    const response = await client.query(`select data from ${table} where id = $1 limit 1`, [documentId]);
    const database = normalizeDatabase(response.rows[0]?.data);
    let projectsScanned = 0;
    let incomingReferences = 0;
    let alreadyPersistent = 0;
    let copied = 0;
    let missing = 0;
    let copyFailed = 0;
    const missingSamples = [];
    const failedSamples = [];

    for (const project of database.projects) {
      if (!project || (projectIdArg && project.id !== projectIdArg)) {
        continue;
      }
      projectsScanned += 1;
      const hdrItems = Array.isArray(project.hdrItems) ? project.hdrItems : [];
      for (const hdrItem of hdrItems) {
        const exposures = Array.isArray(hdrItem?.exposures) ? hdrItem.exposures : [];
        for (const exposure of exposures) {
          const sourceStorageKey = normalizeKey(exposure?.storageKey);
          if (!sourceStorageKey) {
            continue;
          }
          if (!isIncomingKey(sourceStorageKey)) {
            alreadyPersistent += 1;
            continue;
          }

          incomingReferences += 1;
          const metadata = await getObjectStorageMetadata(sourceStorageKey);
          if (!metadata) {
            missing += 1;
            if (missingSamples.length < 20) {
              missingSamples.push({
                projectId: project.id,
                projectName: project.name || null,
                itemId: hdrItem?.id || null,
                fileName: exposure?.originalName || exposure?.fileName || redactKey(sourceStorageKey)
              });
            }
            continue;
          }

          if (!applyChanges) {
            continue;
          }

          const targetStorageKey = createPersistentObjectKey({
            userKey: project.userKey || 'unknown-user',
            projectId: project.id || 'unknown-project',
            userDisplayName: project.userDisplayName || null,
            projectName: project.name || null,
            category: 'originals',
            fileName: exposure?.originalName || exposure?.fileName || path.posix.basename(sourceStorageKey)
          });

          try {
            await copyObjectInStorage({
              sourceStorageKey,
              targetStorageKey
            });
            exposure.storageKey = targetStorageKey;
            exposure.storageUrl = `/storage/${targetStorageKey}`;
            copied += 1;
            if (verbose) {
              console.log(
                JSON.stringify({
                  event: 'copied',
                  projectId: project.id,
                  itemId: hdrItem?.id || null,
                  fileName: exposure?.originalName || exposure?.fileName || redactKey(sourceStorageKey)
                })
              );
            }
          } catch (error) {
            copyFailed += 1;
            if (failedSamples.length < 20) {
              failedSamples.push({
                projectId: project.id,
                projectName: project.name || null,
                itemId: hdrItem?.id || null,
                fileName: exposure?.originalName || exposure?.fileName || redactKey(sourceStorageKey),
                error: error instanceof Error ? error.message.replace(/[A-Za-z0-9_:/+=.-]{24,}/g, '<redacted>') : String(error)
              });
            }
          }
        }
      }
    }

    if (applyChanges && copied > 0) {
      await client.query(
        `
          update ${table}
          set data = $2::jsonb, updated_at = now()
          where id = $1
        `,
        [documentId, JSON.stringify(database)]
      );
    }

    console.log(
      JSON.stringify(
        {
          mode: applyChanges ? 'apply' : 'dry-run',
          projectId: projectIdArg || null,
          projectsScanned,
          incomingReferences,
          copyable: incomingReferences - missing,
          copied,
          missing,
          copyFailed,
          alreadyPersistent,
          missingSamples,
          failedSamples
        },
        null,
        2
      )
    );

    if (copyFailed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
