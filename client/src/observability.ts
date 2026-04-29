type ClientEventLevel = 'info' | 'warning' | 'error';
type ClientEventType = 'client.error' | 'upload.attempt-failed' | 'upload.batch-completed' | 'upload.batch-failed-files';

interface ClientEventInput {
  type?: ClientEventType;
  level?: ClientEventLevel;
  message: string;
  stack?: string | null;
  route?: string;
  projectId?: string | null;
  taskId?: string | null;
  context?: Record<string, unknown>;
}

let initialized = false;
let sentryReady: Promise<unknown> | null = null;
const LOCAL_API_ROOT = 'http://127.0.0.1:8787';
const PRODUCTION_API_ROOT = 'https://api.metrovanai.com';

function getApiRoot() {
  const configured = import.meta.env.VITE_METROVAN_API_URL?.trim();
  if (configured) {
    return configured;
  }

  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' ? LOCAL_API_ROOT : PRODUCTION_API_ROOT;
  }

  return LOCAL_API_ROOT;
}

function getSentryDsn() {
  return String(import.meta.env.VITE_SENTRY_DSN ?? '').trim();
}

function getSentrySampleRate() {
  const value = Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? 0.05);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.05;
}

function normalizeError(input: unknown) {
  if (input instanceof Error) {
    return {
      message: input.message,
      stack: input.stack ?? null
    };
  }

  return {
    message: typeof input === 'string' ? input : JSON.stringify(input),
    stack: null
  };
}

async function initSentry() {
  const dsn = getSentryDsn();
  if (!dsn) {
    return null;
  }

  if (!sentryReady) {
    sentryReady = import('@sentry/react').then((Sentry) => {
      Sentry.init({
        dsn,
        environment: import.meta.env.MODE,
        tracesSampleRate: getSentrySampleRate()
      });
      return Sentry;
    });
  }

  return await sentryReady;
}

export function sendClientEvent(input: ClientEventInput) {
  const payload = {
    type: input.type ?? 'client.error',
    level: input.level ?? 'error',
    message: input.message.slice(0, 1000),
    stack: input.stack ? input.stack.slice(0, 6000) : null,
    route: input.route ?? window.location.pathname,
    projectId: input.projectId ?? null,
    taskId: input.taskId ?? null,
    context: input.context ?? {},
    userAgent: navigator.userAgent,
    occurredAt: new Date().toISOString()
  };

  void fetch(`${getApiRoot()}/api/observability/client-event`, {
    method: 'POST',
    credentials: 'include',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(() => {
    // Observability must never block the user path.
  });
}

export function captureClientError(error: unknown, context: Record<string, unknown> = {}) {
  const normalized = normalizeError(error);
  sendClientEvent({
    type: 'client.error',
    level: 'error',
    message: normalized.message || 'Client error',
    stack: normalized.stack,
    context
  });

  void initSentry()
    .then((Sentry) => {
      const sentry = Sentry as typeof import('@sentry/react') | null;
      sentry?.captureException(error, { extra: context });
    })
    .catch(() => {
      // Ignore optional Sentry setup failures.
    });
}

export function initClientObservability() {
  if (initialized || typeof window === 'undefined') {
    return;
  }

  initialized = true;
  void initSentry().catch(() => undefined);

  window.addEventListener('error', (event) => {
    captureClientError(event.error ?? event.message, {
      source: 'window.error',
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    captureClientError(event.reason, {
      source: 'window.unhandledrejection'
    });
  });
}
