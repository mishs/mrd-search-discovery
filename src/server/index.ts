import { fileURLToPath } from 'node:url';
import { createConfiguredApp } from './bootstrap.js';
import { loadConfig } from './config.js';

const config = loadConfig();

// Built layout: dist/server/index.js serves dist/client. In development this resolves to
// src/client, which has no index.html, so nothing is served and Vite handles the UI.
const clientDir = fileURLToPath(new URL('../client/', import.meta.url));

const app = createConfiguredApp(config, {
  clientDir,
  log: (message) => console.log(`[api] ${message}`),
});

const server = app.listen(config.PORT, () => {
  console.log(
    `[api] listening on http://localhost:${config.PORT} ` +
      `(provider latency ${config.PROVIDER_MIN_LATENCY_MS}-${config.PROVIDER_MAX_LATENCY_MS}ms, ` +
      `failure rate ${config.PROVIDER_FAILURE_RATE}, timeout ${config.PROVIDER_TIMEOUT_MS}ms, ` +
      `cache ${config.LIVE_DETAILS_CACHE_TTL_MS > 0 ? `${config.LIVE_DETAILS_CACHE_TTL_MS}ms` : 'off'}` +
      `${config.PROVIDER_SEED === undefined ? '' : `, seed ${config.PROVIDER_SEED}`})`,
  );
});

// Graceful shutdown: stop accepting connections, let in-flight searches finish
// (each is bounded by PROVIDER_TIMEOUT_MS), and force-exit if that takes too long.
const shutdown = () => {
  server.close(() => process.exit(0));
  server.closeIdleConnections();
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
