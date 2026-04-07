// Centralized helpers for connecting to the backend across LAN.
// Use env vars when running the UI on a different machine than the server.
//
// Supported (CRA) env vars:
// - REACT_APP_SERVER_HOST=192.168.1.100
// - REACT_APP_SERVER_PORT=5000
// - REACT_APP_API_BASE=http://192.168.1.100:5000   (optional; used by some pages)
//
// Notes:
// - When running via CRA dev server (port 3000), the backend is usually on 5000.
// - When running the production build served by the backend, window.location.port is often 5000.

export function getServerHost() {
  return (process.env.REACT_APP_SERVER_HOST || '').trim() || window.location.hostname;
}

export function getServerPort(defaultPort = 5000) {
  const envPort = (process.env.REACT_APP_SERVER_PORT || '').trim();
  if (envPort) return envPort;

  // If the app is served from the backend (production), reuse that port.
  if (window.location.port && window.location.port !== '3000') {
    return window.location.port;
  }

  return String(defaultPort);
}

export function getApiBase() {
  const base = (process.env.REACT_APP_API_BASE || '').trim();
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

export function getWebSocketUrl(path = '/') {
  const host = getServerHost();
  const port = getServerPort(5000);
  // The backend server runs plain HTTP/WS (no TLS), so always use ws://.
  // Even when the CRA dev server uses HTTPS, the WebSocket connects directly
  // to the backend on port 5000 which doesn't have SSL.
  const protocol = 'ws';
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${protocol}://${host}:${port}${normalizedPath}`;
}

