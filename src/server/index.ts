import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { catalog } from './catalog/catalog.js';
import { loadConfig } from './config.js';
import { createSimulatedProvider } from './provider/provider.js';
import { createSeededRandom } from './provider/random.js';

const config = loadConfig();

const provider = createSimulatedProvider({
  minLatencyMs: config.PROVIDER_MIN_LATENCY_MS,
  maxLatencyMs: config.PROVIDER_MAX_LATENCY_MS,
  failureRate: config.PROVIDER_FAILURE_RATE,
  random: config.PROVIDER_SEED === undefined ? Math.random : createSeededRandom(config.PROVIDER_SEED),
});

// Built layout: dist/server/index.js serves dist/client. In development this resolves to
// src/client, which has no index.html, so nothing is served and Vite handles the UI.
const clientDir = fileURLToPath(new URL('../client/', import.meta.url));

const app = createApp({
  catalog,
  provider,
  providerTimeoutMs: config.PROVIDER_TIMEOUT_MS,
  clientDir,
  log: (message) => console.log(`[api] ${message}`),
});

const server = app.listen(config.PORT, () => {
  console.log(
    `[api] listening on http://localhost:${config.PORT} ` +
      `(provider latency ${config.PROVIDER_MIN_LATENCY_MS}-${config.PROVIDER_MAX_LATENCY_MS}ms, ` +
      `failure rate ${config.PROVIDER_FAILURE_RATE}, timeout ${config.PROVIDER_TIMEOUT_MS}ms` +
      `${config.PROVIDER_SEED === undefined ? '' : `, seed ${config.PROVIDER_SEED}`})`,
  );
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
