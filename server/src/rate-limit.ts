import type express from 'express';
import pg from 'pg';
import { getClientIp } from './request-utils.js';

const { Pool } = pg;
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 1000 * 60 * 10;

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

interface RateLimitInput {
  scope: string;
  limit: number;
  windowMs: number;
  message?: string;
}

export interface RateLimitUser {
  userKey: string;
}

function getExternalRateLimitConfig() {
  const url = String(process.env.UPSTASH_REDIS_REST_URL ?? process.env.METROVAN_UPSTASH_REDIS_REST_URL ?? '')
    .trim()
    .replace(/\/+$/, '');
  const token = String(process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.METROVAN_UPSTASH_REDIS_REST_TOKEN ?? '').trim();
  return url && token ? { url, token } : null;
}

function getPostgresRateLimitDatabaseUrl() {
  return String(
    process.env.METROVAN_RATE_LIMIT_DATABASE_URL ??
      process.env.SUPABASE_DB_URL ??
      process.env.DATABASE_URL ??
      process.env.POSTGRES_URL ??
      ''
  ).trim();
}

function getPostgresRateLimitTableName() {
  const raw = String(process.env.METROVAN_RATE_LIMIT_TABLE ?? 'metrovan_rate_limits').trim();
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(raw) ? raw : 'metrovan_rate_limits';
}

function normalizeUpstashPipelineResult(payload: unknown) {
  return Array.isArray(payload) ? payload : [];
}

function readUpstashResultNumber(item: unknown) {
  if (item && typeof item === 'object' && 'result' in item) {
    const parsed = Number((item as { result?: unknown }).result);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const parsed = Number(item);
  return Number.isFinite(parsed) ? parsed : null;
}

async function callUpstashPipeline(config: { url: string; token: string }, commands: unknown[][]) {
  const response = await fetch(`${config.url}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(commands)
  });
  if (!response.ok) {
    throw new Error(`Upstash rate limit request failed: ${response.status}`);
  }
  return normalizeUpstashPipelineResult(await response.json());
}

export function createRateLimiter() {
  const rateLimitBuckets = new Map<string, RateLimitBucket>();
  let externalRateLimitWarningLogged = false;
  let postgresRateLimitWarningLogged = false;
  let postgresRateLimitPool: pg.Pool | null | undefined;
  let postgresRateLimitTableReady: Promise<void> | null = null;

  const rateLimitCleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of rateLimitBuckets.entries()) {
      if (bucket.resetAt <= now) {
        rateLimitBuckets.delete(key);
      }
    }
  }, RATE_LIMIT_CLEANUP_INTERVAL_MS);
  rateLimitCleanupTimer.unref?.();

  function getPostgresRateLimitPool() {
    if (postgresRateLimitPool !== undefined) {
      return postgresRateLimitPool;
    }

    const databaseUrl = getPostgresRateLimitDatabaseUrl();
    if (!databaseUrl) {
      postgresRateLimitPool = null;
      return null;
    }

    const sslValue = (process.env.METROVAN_POSTGRES_SSL ?? process.env.SUPABASE_POSTGRES_SSL ?? 'true')
      .trim()
      .toLowerCase();
    const useSsl = sslValue !== 'false' && sslValue !== '0' && sslValue !== 'no';
    postgresRateLimitPool = new Pool({
      connectionString: databaseUrl,
      max: 2,
      ssl: useSsl ? { rejectUnauthorized: false } : undefined
    });
    return postgresRateLimitPool;
  }

  async function ensurePostgresRateLimitTable(pool: pg.Pool) {
    const tableName = getPostgresRateLimitTableName();
    postgresRateLimitTableReady ??= pool
      .query(
        `
          CREATE TABLE IF NOT EXISTS ${tableName} (
            rate_key text PRIMARY KEY,
            hit_count integer NOT NULL,
            reset_at timestamptz NOT NULL,
            updated_at timestamptz NOT NULL DEFAULT now()
          )
        `
      )
      .then(() => undefined);
    await postgresRateLimitTableReady;
  }

  async function getPostgresRateLimitBucket(key: string, windowMs: number) {
    const pool = getPostgresRateLimitPool();
    if (!pool) {
      return null;
    }

    await ensurePostgresRateLimitTable(pool);
    const resetAt = Date.now() + windowMs;
    const tableName = getPostgresRateLimitTableName();
    const response = await pool.query<{ hit_count: number; reset_at_ms: string | number | null }>(
      `
        INSERT INTO ${tableName} (rate_key, hit_count, reset_at, updated_at)
        VALUES ($1, 1, to_timestamp($2::double precision / 1000.0), now())
        ON CONFLICT (rate_key) DO UPDATE SET
          hit_count = CASE
            WHEN ${tableName}.reset_at <= now() THEN 1
            ELSE ${tableName}.hit_count + 1
          END,
          reset_at = CASE
            WHEN ${tableName}.reset_at <= now() THEN EXCLUDED.reset_at
            ELSE ${tableName}.reset_at
          END,
          updated_at = now()
        RETURNING hit_count, EXTRACT(EPOCH FROM reset_at) * 1000 AS reset_at_ms
      `,
      [key, resetAt]
    );

    const row = response.rows[0];
    if (!row) {
      return null;
    }

    const parsedResetAt = Number(row.reset_at_ms);
    return {
      count: Number(row.hit_count) || 1,
      resetAt: Number.isFinite(parsedResetAt) ? parsedResetAt : resetAt
    };
  }

  function getLocalRateLimitBucket(key: string, windowMs: number) {
    const now = Date.now();
    const existing = rateLimitBuckets.get(key);
    const bucket: RateLimitBucket =
      existing && existing.resetAt > now
        ? existing
        : {
            count: 0,
            resetAt: now + windowMs
          };

    bucket.count += 1;
    rateLimitBuckets.set(key, bucket);
    return bucket;
  }

  async function getExternalRateLimitBucket(key: string, windowMs: number) {
    const config = getExternalRateLimitConfig();
    if (!config) {
      return null;
    }

    const redisKey = `metrovan:rate-limit:${key}`;
    const firstResult = await callUpstashPipeline(config, [
      ['INCR', redisKey],
      ['PTTL', redisKey]
    ]);
    const count = readUpstashResultNumber(firstResult[0]) ?? 1;
    let ttlMs = readUpstashResultNumber(firstResult[1]) ?? -1;
    if (count === 1 || ttlMs < 0) {
      const secondResult = await callUpstashPipeline(config, [
        ['PEXPIRE', redisKey, windowMs],
        ['PTTL', redisKey]
      ]);
      ttlMs = readUpstashResultNumber(secondResult[1]) ?? windowMs;
    }

    return {
      count,
      resetAt: Date.now() + Math.max(1, ttlMs)
    };
  }

  async function getRateLimitBucket(key: string, windowMs: number) {
    try {
      const externalBucket = await getExternalRateLimitBucket(key, windowMs);
      if (externalBucket) {
        return externalBucket;
      }
    } catch (error) {
      if (!externalRateLimitWarningLogged) {
        externalRateLimitWarningLogged = true;
        console.warn(
          `External rate limit backend failed; falling back to in-memory limits: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    try {
      const postgresBucket = await getPostgresRateLimitBucket(key, windowMs);
      if (postgresBucket) {
        return postgresBucket;
      }
    } catch (error) {
      if (!postgresRateLimitWarningLogged) {
        postgresRateLimitWarningLogged = true;
        console.warn(
          `Postgres rate limit backend failed; falling back to in-memory limits: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    return getLocalRateLimitBucket(key, windowMs);
  }

  async function checkRateLimit(req: express.Request, res: express.Response, input: RateLimitInput) {
    const key = `${input.scope}:${getClientIp(req)}`;
    const bucket = await getRateLimitBucket(key, input.windowMs);
    if (bucket.count <= input.limit) {
      return true;
    }

    const now = Date.now();
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    res.setHeader('Retry-After', String(retryAfterSeconds));
    res.status(429).json({ error: input.message ?? 'Too many attempts. Please try again later.' });
    return false;
  }

  async function checkUserRateLimit(
    req: express.Request,
    res: express.Response,
    user: RateLimitUser,
    input: RateLimitInput
  ) {
    return checkRateLimit(req, res, {
      ...input,
      scope: `${input.scope}:user:${user.userKey}`
    });
  }

  return {
    checkRateLimit,
    checkUserRateLimit
  };
}
