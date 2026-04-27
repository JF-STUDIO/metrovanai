import { randomUUID } from 'node:crypto';

type LogLevel = 'info' | 'warning' | 'error';

interface ServerEventInput {
  level?: LogLevel;
  event: string;
  traceId?: string | null;
  userKey?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  phase?: string | null;
  details?: Record<string, unknown>;
}

let sentry: typeof import('@sentry/node') | null = null;

function getSentryDsn() {
  return String(process.env.METROVAN_SENTRY_DSN ?? process.env.SENTRY_DSN ?? '').trim();
}

function getSentrySampleRate() {
  const value = Number(process.env.METROVAN_SENTRY_TRACES_SAMPLE_RATE ?? process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.05);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.05;
}

export function createTraceId(prefix = 'mva') {
  return `${prefix}_${randomUUID()}`;
}

export async function initServerObservability() {
  const dsn = getSentryDsn();
  if (!dsn || sentry) {
    return;
  }

  try {
    sentry = await import('@sentry/node');
    sentry.init({
      dsn,
      environment: process.env.NODE_ENV ?? 'development',
      tracesSampleRate: getSentrySampleRate()
    });
  } catch (error) {
    console.warn('[observability] Sentry initialization failed', error);
  }
}

export function serializeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return {
    name: 'Error',
    message: typeof error === 'string' ? error : JSON.stringify(error),
    stack: null
  };
}

export function logServerEvent(input: ServerEventInput) {
  const payload = {
    type: 'metrovan.event',
    level: input.level ?? 'info',
    event: input.event,
    traceId: input.traceId ?? null,
    userKey: input.userKey ?? null,
    projectId: input.projectId ?? null,
    taskId: input.taskId ?? null,
    phase: input.phase ?? null,
    details: input.details ?? {},
    occurredAt: new Date().toISOString()
  };

  const line = JSON.stringify(payload);
  if (payload.level === 'error') {
    console.error(line);
  } else if (payload.level === 'warning') {
    console.warn(line);
  } else {
    console.info(line);
  }

  if (sentry) {
    sentry.addBreadcrumb({
      category: 'metrovan',
      level: payload.level === 'warning' ? 'warning' : payload.level,
      message: input.event,
      data: payload
    });
  }
}

export function captureServerError(error: unknown, input: Omit<ServerEventInput, 'level' | 'details'> & { details?: Record<string, unknown> }) {
  const serialized = serializeError(error);
  logServerEvent({
    ...input,
    level: 'error',
    event: input.event,
    details: {
      ...(input.details ?? {}),
      error: serialized
    }
  });
  sentry?.captureException(error, {
    extra: {
      traceId: input.traceId,
      userKey: input.userKey,
      projectId: input.projectId,
      taskId: input.taskId,
      phase: input.phase,
      ...(input.details ?? {})
    }
  });
}
