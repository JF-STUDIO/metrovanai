import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from 'react';
import { captureClientError, initClientObservability } from './observability';

const PRELOAD_RECOVERY_STORAGE_KEY = 'metrovanai.preload-recovery-at';
const PRELOAD_RECOVERY_THROTTLE_MS = 15_000;

let preloadRecoveryInstalled = false;

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === 'string' ? error : String(error);
}

function isAssetPreloadError(error: unknown) {
  const message = getErrorMessage(error);
  return /Unable to preload CSS|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk \d+ failed/i.test(
    message
  );
}

function readLastPreloadRecovery() {
  try {
    return Number(window.sessionStorage.getItem(PRELOAD_RECOVERY_STORAGE_KEY) ?? '0');
  } catch {
    return 0;
  }
}

function rememberPreloadRecovery(timestamp: number) {
  try {
    window.sessionStorage.setItem(PRELOAD_RECOVERY_STORAGE_KEY, String(timestamp));
  } catch {
    // Storage can be unavailable in locked-down browser modes.
  }
}

function schedulePreloadRecovery() {
  if (typeof window === 'undefined') {
    return false;
  }

  const now = Date.now();
  const lastRecovery = readLastPreloadRecovery();
  if (Number.isFinite(lastRecovery) && now - lastRecovery < PRELOAD_RECOVERY_THROTTLE_MS) {
    return false;
  }

  rememberPreloadRecovery(now);
  window.setTimeout(() => window.location.reload(), 120);
  return true;
}

function installPreloadRecovery() {
  if (preloadRecoveryInstalled || typeof window === 'undefined') {
    return;
  }

  preloadRecoveryInstalled = true;
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    const error = (event as Event & { payload?: unknown }).payload ?? event;
    captureClientError(error, {
      source: 'vite.preload_error'
    });
    schedulePreloadRecovery();
  });
}

const App = lazy(() => import('./App'));

interface AppErrorBoundaryState {
  hasError: boolean;
  isRecovering: boolean;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false, isRecovering: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true, isRecovering: false };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    captureClientError(error, {
      source: 'react.error_boundary',
      componentStack: info.componentStack ?? null
    });

    if (isAssetPreloadError(error) && schedulePreloadRecovery()) {
      this.setState({ isRecovering: true });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="boot-fallback">
          <strong>Metrovan AI</strong>
          <span>{this.state.isRecovering ? '正在刷新最新版本...' : '页面加载失败，请重新加载。'}</span>
          <button type="button" onClick={() => window.location.reload()}>
            重新加载
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function AppShell() {
  installPreloadRecovery();
  initClientObservability();

  return (
    <AppErrorBoundary>
      <Suspense
        fallback={
          <div className="boot-fallback">
            <strong>Metrovan AI</strong>
            <span>正在加载...</span>
          </div>
        }
      >
        <App />
      </Suspense>
    </AppErrorBoundary>
  );
}
