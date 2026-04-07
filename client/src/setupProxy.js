const { createProxyMiddleware } = require('http-proxy-middleware');

/**
 * CRA dev-server proxy configuration.
 * Proxies /api and /uploads to the backend.
 */
module.exports = function (app) {
  // Allow running the UI from another laptop by pointing the dev proxy at the server PC.
  // Examples:
  // - PowerShell: $env:REACT_APP_SERVER_HOST="192.168.1.100"; npm start
  // - PowerShell: $env:REACT_APP_API_BASE="http://192.168.1.100:5000"; npm start
  const envApiBase = (process.env.REACT_APP_API_BASE || '').trim();
  const envHost = (process.env.REACT_APP_SERVER_HOST || '').trim();
  const envPort = (process.env.REACT_APP_SERVER_PORT || '').trim() || '5000';
  const target = envApiBase || (envHost ? `http://${envHost}:${envPort}` : 'http://localhost:5000');

  // API proxy (handles both HTTP and WebSocket for /api paths)
  app.use(
    '/api',
    createProxyMiddleware({
      target,
      changeOrigin: true,
      ws: true,
      logLevel: 'warn'
    })
  );

  // Uploads proxy
  app.use(
    '/uploads',
    createProxyMiddleware({
      target,
      changeOrigin: true,
      logLevel: 'warn'
    })
  );
};

