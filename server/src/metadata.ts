import path from 'node:path';
import pg from 'pg';
import type {
  BillingActivationCode,
  BillingEntry,
  AuditLogEntry,
  EmailVerificationTokenRecord,
  PaymentOrderRecord,
  PasswordResetTokenRecord,
  ProjectRecord,
  SessionRecord,
  SystemSettings,
  UserRecord
} from './types.js';
import { ensureDir, loadJson, saveJson } from './utils.js';

const { Pool } = pg;
export const MAX_RUNPOD_HDR_BATCH_SIZE = 100;

export interface DatabaseShape {
  projects: ProjectRecord[];
  billing: BillingEntry[];
  paymentOrders: PaymentOrderRecord[];
  activationCodes: BillingActivationCode[];
  users: UserRecord[];
  sessions: SessionRecord[];
  passwordResetTokens: PasswordResetTokenRecord[];
  emailVerificationTokens: EmailVerificationTokenRecord[];
  auditLogs: AuditLogEntry[];
  systemSettings: SystemSettings;
}

export interface MetadataProviderInfo {
  provider: string;
  location: string;
}

export interface MetadataProvider {
  getInfo(): MetadataProviderInfo;
  initialize?(): Promise<void>;
  load(): DatabaseShape;
  save(data: DatabaseShape): void;
}

interface JsonFileMetadataProviderOptions {
  filePath: string;
}

function createEmptyDatabase(): DatabaseShape {
  return {
    projects: [],
    billing: [],
    paymentOrders: [],
    activationCodes: [],
    users: [],
    sessions: [],
    passwordResetTokens: [],
    emailVerificationTokens: [],
    auditLogs: [],
    systemSettings: { runpodHdrBatchSize: 10 }
  };
}

function normalizeSystemSettings(input: Partial<SystemSettings> | undefined): SystemSettings {
  const parsedBatchSize = Number(input?.runpodHdrBatchSize ?? 10);
  return {
    runpodHdrBatchSize: Math.max(
      1,
      Math.min(MAX_RUNPOD_HDR_BATCH_SIZE, Number.isFinite(parsedBatchSize) ? Math.round(parsedBatchSize) : 10)
    )
  };
}

function normalizeDatabaseShape(raw: Partial<DatabaseShape>): DatabaseShape {
  return {
    projects: Array.isArray(raw.projects) ? raw.projects : [],
    billing: Array.isArray(raw.billing) ? raw.billing : [],
    paymentOrders: Array.isArray(raw.paymentOrders) ? raw.paymentOrders : [],
    activationCodes: Array.isArray(raw.activationCodes) ? raw.activationCodes : [],
    users: Array.isArray(raw.users) ? raw.users : [],
    sessions: Array.isArray(raw.sessions) ? raw.sessions.map((session) => ({ ...session, csrfTokenHash: session.csrfTokenHash ?? null })) : [],
    passwordResetTokens: Array.isArray(raw.passwordResetTokens) ? raw.passwordResetTokens : [],
    emailVerificationTokens: Array.isArray(raw.emailVerificationTokens) ? raw.emailVerificationTokens : [],
    auditLogs: Array.isArray(raw.auditLogs) ? raw.auditLogs : [],
    systemSettings: normalizeSystemSettings(raw.systemSettings)
  };
}

function quoteQualifiedIdentifier(input: string) {
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

function redactDatabaseUrl(databaseUrl: string) {
  try {
    const url = new URL(databaseUrl);
    if (url.password) {
      url.password = '***';
    }
    if (url.username) {
      url.username = '***';
    }
    return url.toString();
  } catch {
    return 'postgres://***';
  }
}

export class JsonFileMetadataProvider implements MetadataProvider {
  constructor(private readonly filePath: string) {
    ensureDir(path.dirname(this.filePath));
  }

  getInfo(): MetadataProviderInfo {
    return {
      provider: 'json-file',
      location: this.filePath
    };
  }

  load(): DatabaseShape {
    const raw = loadJson<Partial<DatabaseShape>>(this.filePath, createEmptyDatabase());
    return normalizeDatabaseShape(raw);
  }

  save(data: DatabaseShape) {
    saveJson(this.filePath, data);
  }
}

class PostgresJsonMetadataProvider implements MetadataProvider {
  private readonly pool: pg.Pool;
  private readonly tableName: string;
  private readonly quotedTableName: string;
  private readonly documentId: string;
  private readonly backupFilePath: string;
  private cache: DatabaseShape = createEmptyDatabase();
  private persistQueue: Promise<void> = Promise.resolve();

  constructor(options: JsonFileMetadataProviderOptions & { databaseUrl: string; tableName?: string; documentId?: string }) {
    this.backupFilePath = options.filePath;
    this.tableName = options.tableName?.trim() || 'metrovan_metadata';
    this.quotedTableName = quoteQualifiedIdentifier(this.tableName);
    this.documentId = options.documentId?.trim() || 'default';
    const sslValue = (process.env.METROVAN_POSTGRES_SSL ?? process.env.SUPABASE_POSTGRES_SSL ?? 'true').trim().toLowerCase();
    const useSsl = sslValue !== 'false' && sslValue !== '0' && sslValue !== 'no';
    this.pool = new Pool({
      connectionString: options.databaseUrl,
      ssl: useSsl ? { rejectUnauthorized: false } : undefined
    });
  }

  getInfo(): MetadataProviderInfo {
    const databaseUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
    return {
      provider: 'postgres-json',
      location: `${redactDatabaseUrl(databaseUrl)}#${this.tableName}/${this.documentId}`
    };
  }

  async initialize() {
    ensureDir(path.dirname(this.backupFilePath));
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.quotedTableName} (
        id text PRIMARY KEY,
        data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const response = await this.pool.query<{ data: Partial<DatabaseShape> }>(
      `SELECT data FROM ${this.quotedTableName} WHERE id = $1 LIMIT 1`,
      [this.documentId]
    );

    if (response.rows[0]?.data) {
      this.cache = normalizeDatabaseShape(response.rows[0].data);
      saveJson(this.backupFilePath, this.cache);
      return;
    }

    this.cache = normalizeDatabaseShape(loadJson<Partial<DatabaseShape>>(this.backupFilePath, createEmptyDatabase()));
    saveJson(this.backupFilePath, this.cache);
    await this.persist(this.cache);
  }

  load(): DatabaseShape {
    return this.cache;
  }

  save(data: DatabaseShape) {
    this.cache = normalizeDatabaseShape(data);
    saveJson(this.backupFilePath, this.cache);
    const snapshot = this.cache;
    this.persistQueue = this.persistQueue
      .catch(() => undefined)
      .then(() => this.persist(snapshot))
      .catch((error) => {
        console.error('Postgres metadata persistence failed:', error);
      });
  }

  private async persist(data: DatabaseShape) {
    await this.pool.query(
      `
        INSERT INTO ${this.quotedTableName} (id, data, updated_at)
        VALUES ($1, $2::jsonb, now())
        ON CONFLICT (id)
        DO UPDATE SET data = EXCLUDED.data, updated_at = now()
      `,
      [this.documentId, JSON.stringify(data)]
    );
  }
}

export function createMetadataProvider(
  provider: string | undefined,
  options: JsonFileMetadataProviderOptions
): MetadataProvider {
  const defaultProvider =
    process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL ? 'postgres-json' : 'json-file';
  const normalizedProvider = (provider ?? defaultProvider).trim().toLowerCase();
  if (normalizedProvider === 'json-file') {
    return new JsonFileMetadataProvider(options.filePath);
  }

  if (normalizedProvider === 'postgres-json' || normalizedProvider === 'supabase-postgres') {
    const databaseUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!databaseUrl) {
      throw new Error('SUPABASE_DB_URL or DATABASE_URL is required for the postgres-json metadata provider.');
    }
    return new PostgresJsonMetadataProvider({
      ...options,
      databaseUrl,
      tableName: process.env.METROVAN_METADATA_TABLE,
      documentId: process.env.METROVAN_METADATA_DOCUMENT_ID
    });
  }

  throw new Error(`Unsupported metadata provider: ${provider}`);
}
