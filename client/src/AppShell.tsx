import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from 'react';
import { captureClientError, initClientObservability } from './observability';

const App = lazy(() => import('./App'));

interface AppErrorBoundaryState {
  hasError: boolean;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    captureClientError(error, {
      source: 'react.error_boundary',
      componentStack: info.componentStack ?? null
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="boot-fallback">
          <strong>Metrovan AI</strong>
          <span>Page failed to load. Refresh and try again.</span>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function AppShell() {
  initClientObservability();

  return (
    <AppErrorBoundary>
      <Suspense
        fallback={
          <div className="boot-fallback">
            <strong>Metrovan AI</strong>
            <span>Loading...</span>
          </div>
        }
      >
        <App />
      </Suspense>
    </AppErrorBoundary>
  );
}
