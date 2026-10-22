import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import express, { type ErrorRequestHandler, type Express } from 'express';
import type {
  ApiErrorBody,
  CatalogItem,
  CategoriesResponse,
  SearchQuery,
  SearchResponse,
  SuggestionsResponse,
} from '../shared/contract.js';
import { CATEGORIES } from './catalog/catalog.js';
import { enrichItems } from './enrichment/enrich.js';
import type { LiveDetailsCache } from './enrichment/liveDetailsCache.js';
import { createMetrics, type Metrics } from './metrics.js';
import type { LiveDetailsProvider } from './provider/provider.js';
import { parseSearchQuery, parseSuggestionsQuery } from './search/query.js';
import { searchCatalog } from './search/search.js';
import { createSuggestionIndex } from './search/suggest.js';

const describeQuery = (query: SearchQuery): string =>
  `q=${JSON.stringify(query.q)} category=${query.category ?? '*'} sort=${query.sort}`;

export interface AppDependencies {
  catalog: readonly CatalogItem[];
  provider: LiveDetailsProvider;
  providerTimeoutMs: number;
  /** Optional short-lived cache of provider answers. Omit to always ask the provider. */
  liveDetailsCache?: LiveDetailsCache;
  /** Directory of the built client. When it contains index.html, Express serves it. */
  clientDir?: string;
  log?: (message: string) => void;
  /** Injected so tests can read counters; a fresh instance is created otherwise. */
  metrics?: Metrics;
}

/**
 * Builds the Express app from its dependencies. No `listen` here, so tests can
 * drive it with supertest and inject a deterministic provider.
 */
export function createApp(deps: AppDependencies): Express {
  const { catalog, provider, providerTimeoutMs, liveDetailsCache, clientDir, log = () => {}, metrics = createMetrics() } =
    deps;
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', metrics.middleware);
  const suggestionIndex = createSuggestionIndex(catalog);

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Internal diagnostics. In production this would sit behind auth or on a private port.
  app.get('/api/metrics', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(metrics.snapshot());
  });

  app.get('/api/categories', (_req, res) => {
    const body: CategoriesResponse = { categories: [...CATEGORIES] };
    res.json(body);
  });

  // Typeahead. Catalog-only (no provider call), so it is cheap and the browser may cache it.
  app.get('/api/suggestions', (req, res) => {
    const parsed = parseSuggestionsQuery(req.query);
    if (!parsed.ok) {
      const body: ApiErrorBody = {
        error: { code: 'INVALID_QUERY', message: 'Invalid suggestion parameters', details: parsed.details },
      };
      res.status(400).json(body);
      return;
    }
    const body: SuggestionsResponse = {
      q: parsed.query.q,
      suggestions: suggestionIndex.suggest(parsed.query.q, parsed.query.category),
    };
    // The catalog only changes on deploy, so short-lived browser caching is safe.
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.json(body);
  });

  app.get('/api/search', async (req, res) => {
    const parsed = parseSearchQuery(req.query);
    if (!parsed.ok) {
      const body: ApiErrorBody = {
        error: { code: 'INVALID_QUERY', message: 'Invalid search parameters', details: parsed.details },
      };
      res.status(400).json(body);
      return;
    }

    // If the browser aborts (newer search, closed tab), stop waiting on the provider.
    const disconnected = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) disconnected.abort();
    });

    const searchStart = performance.now();
    const matches = searchCatalog(catalog, parsed.query);
    const searchMs = performance.now() - searchStart;

    const { items, enrichment } = await enrichItems(matches, provider, {
      timeoutMs: providerTimeoutMs,
      signal: disconnected.signal,
      ...(liveDetailsCache ? { cache: liveDetailsCache } : {}),
    });

    metrics.recordEnrichment(enrichment, matches.length);

    if (disconnected.signal.aborted) {
      log(`search ${describeQuery(parsed.query)} abandoned: client disconnected, provider call aborted`);
      return;
    }

    const body: SearchResponse = { query: parsed.query, total: items.length, items, enrichment };
    // Lightweight instrumentation, visible in the browser's Network > Timing panel.
    res.setHeader(
      'Server-Timing',
      `search;dur=${searchMs.toFixed(1)}, provider;dur=${enrichment.durationMs}, ` +
        `cache;desc="${enrichment.cacheHits}/${matches.length} hits"`,
    );
    res.setHeader('Cache-Control', 'no-store');
    log(
      `search ${describeQuery(parsed.query)} results=${items.length} enrichment=${enrichment.status}${enrichment.reason ? `(${enrichment.reason})` : ''} ` +
        `providerMs=${enrichment.durationMs} cacheHits=${enrichment.cacheHits}`,
    );
    res.json(body);
  });

  app.use('/api', (_req, res) => {
    const body: ApiErrorBody = { error: { code: 'NOT_FOUND', message: 'Unknown API route' } };
    res.status(404).json(body);
  });

  if (clientDir && existsSync(join(clientDir, 'index.html'))) {
    app.use(
      express.static(clientDir, {
        // Vite fingerprints files in /assets, so they can be cached for a long time.
        // index.html is not fingerprinted and is revalidated on every load.
        setHeaders: (res, filePath) => {
          if (filePath.includes(`${sep}assets${sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      }),
    );
  }

  const onError: ErrorRequestHandler = (error, _req, res, _next) => {
    log(`unhandled error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    const body: ApiErrorBody = { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } };
    res.status(500).json(body);
  };
  app.use(onError);

  return app;
}
