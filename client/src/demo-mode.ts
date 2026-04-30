export function isDemoModeEnabled(search = window.location.search) {
  return (
    new URLSearchParams(search).get('demo') === '1' &&
    (import.meta.env.DEV || import.meta.env.VITE_METROVAN_ENABLE_DEMO === 'true')
  );
}
