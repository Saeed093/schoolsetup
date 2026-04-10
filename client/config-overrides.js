/**
 * Webpack 5 (CRA) polyfills: face-api.js references Node-only modules that must be stubbed for the browser.
 */
module.exports = function override(config) {
  config.resolve.fallback = {
    ...(config.resolve.fallback || {}),
    fs: false,
    path: false,
    crypto: false
  };
  config.ignoreWarnings = [
    ...(config.ignoreWarnings || []),
    /Failed to parse source map/
  ];
  return config;
};
