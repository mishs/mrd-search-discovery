import type { Express } from 'express';
import { createApp } from './app.js';
import { catalog } from './catalog/catalog.js';
import type { Config } from './config.js';
import { createLiveDetailsCache } from './enrichment/liveDetailsCache.js';
import { createSimulatedProvider } from './provider/provider.js';
import { createSeededRandom } from './provider/random.js';

export interface BootstrapOptions {
  /** Directory of the built client to serve; omit when something else serves the UI. */
  clientDir?: string;
  log?: (message: string) => void;
}

/**
 * Builds the app from validated configuration. Shared by the local server
 * (src/server/index.ts) and the hosted demo (netlify/functions/api.ts), so
 * both run the same catalog, provider and cache wiring.
 */
export function createConfiguredApp(config: Config, options: BootstrapOptions = {}): Express {
  const provider = createSimulatedProvider({
    minLatencyMs: config.PROVIDER_MIN_LATENCY_MS,
    maxLatencyMs: config.PROVIDER_MAX_LATENCY_MS,
    failureRate: config.PROVIDER_FAILURE_RATE,
    random: config.PROVIDER_SEED === undefined ? Math.random : createSeededRandom(config.PROVIDER_SEED),
  });

  return createApp({
    catalog,
    provider,
    providerTimeoutMs: config.PROVIDER_TIMEOUT_MS,
    ...(config.LIVE_DETAILS_CACHE_TTL_MS > 0
      ? { liveDetailsCache: createLiveDetailsCache({ ttlMs: config.LIVE_DETAILS_CACHE_TTL_MS }) }
      : {}),
    ...(options.clientDir === undefined ? {} : { clientDir: options.clientDir }),
    ...(options.log === undefined ? {} : { log: options.log }),
  });
}
