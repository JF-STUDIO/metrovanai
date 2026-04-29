import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from 'react';
import { fetchSession } from './api';
import { LANDING_COPY, getStoredLandingLocale } from './landing-copy';
import { captureClientError, initClientObservability } from './observability';
import { LandingPage } from './pages/LandingPage';

const PRELOAD_RECOVERY_STORAGE_KEY = 'metrovanai.preload-recovery-at';
const PRELOAD_RECOVERY_THROTTLE_MS = 15_000;
type ShellRoute = 'home' | 'plans' | 'app';
type LandingRoute = 'home' | 'plans';

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

function getShellRouteFromPath(pathname = window.location.pathname): ShellRoute {
  if (pathname === '/plans') {
    return 'plans';
  }
  if (pathname === '/' || pathname === '' || pathname === '/home') {
    return 'home';
  }
  return 'app';
}

function getLandingPath(route: LandingRoute) {
  return route === 'plans' ? '/plans' : '/home';
}

function pushShellUrl(pathname: string, search = '', hash = window.location.hash) {
  const nextUrl = `${pathname}${search}${hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (currentUrl !== nextUrl) {
    window.history.pushState({}, '', nextUrl);
  }
}

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
  const [shellRoute, setShellRoute] = useState<ShellRoute>(() => getShellRouteFromPath());
  const [hasSession, setHasSession] = useState(false);
  const locale = getStoredLandingLocale();
  const copy = useMemo(() => LANDING_COPY[locale], [locale]);
  installPreloadRecovery();
  initClientObservability();

  useEffect(() => {
    if (window.location.pathname === '/' || window.location.pathname === '') {
      window.history.replaceState({}, '', `/home${window.location.search}${window.location.hash}`);
    }

    const syncRoute = () => setShellRoute(getShellRouteFromPath());
    window.addEventListener('popstate', syncRoute);
    return () => window.removeEventListener('popstate', syncRoute);
  }, []);

  useEffect(() => {
    if (shellRoute === 'app') {
      return;
    }

    let cancelled = false;
    fetchSession()
      .then(({ session }) => {
        if (!cancelled) {
          setHasSession(Boolean(session));
        }
      })
      .catch((error) => {
        captureClientError(error, { source: 'app_shell.session' });
        if (!cancelled) {
          setHasSession(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [shellRoute]);

  const navigateLanding = useCallback((route: 'home' | 'plans' | 'studio') => {
    if (route === 'studio') {
      pushShellUrl('/studio');
      setShellRoute('app');
      return;
    }

    pushShellUrl(getLandingPath(route));
    setShellRoute(route);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const openAuth = useCallback((mode: 'signin' | 'signup') => {
    pushShellUrl('/studio', `?auth=${mode}`);
    setShellRoute('app');
  }, []);

  return (
    <AppErrorBoundary>
      {shellRoute === 'app' ? (
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
      ) : (
        <LandingPage
          activeRoute={shellRoute}
          copy={copy}
          hasSession={hasSession}
          message=""
          onNavigate={navigateLanding}
          onOpenAuth={openAuth}
        />
      )}
    </AppErrorBoundary>
  );
}
