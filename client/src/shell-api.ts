type ShellSessionPayload = {
  session: {
    user: {
      id: string;
      userKey: string;
      email: string;
      displayName: string;
      locale: 'zh' | 'en';
      role: 'user' | 'admin';
      accountStatus: 'active' | 'disabled';
    };
  } | null;
};

const LOCAL_API_ROOT = 'http://127.0.0.1:8787';
const PRODUCTION_API_ROOT = 'https://api.metrovanai.com';

function resolveShellApiRoot() {
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

export async function fetchShellSession() {
  const response = await fetch(`${resolveShellApiRoot()}/api/auth/session`, {
    credentials: 'include'
  });

  if (!response.ok) {
    throw new Error(`Session request failed: ${response.status}`);
  }

  return (await response.json()) as ShellSessionPayload;
}
