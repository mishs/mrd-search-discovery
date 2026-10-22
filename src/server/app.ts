import { existsSync } from 'node:fs';
import { join } from 'node:path';
import express, { type ErrorRequestHandler, type Express } from 'express';
import type {
  ApiErrorBody,
  CatalogItem,
  CategoriesResponse,
  SearchResponse,
} from '../shared/contract.js';
import { CATEGORIES } from './catalog/catalog.js';
import { enrichItems } from './enrichment/enrich.js';
import type { LiveDetailsProvider } from './provider/provider.js';
import { parseSearchQuery } from './search/query.js';
import { searchCatalog } from './search/search.js';

export interface AppDependencies {
  catalog: readonly CatalogItem[];
  provider: LiveDetailsProvider;
  providerTimeoutMs: number;
  /** Directory of the built client. When it contains index.html, Express serves it. */
  clientDir?: string;
  log?: (message: string) => void;
}

/**
 * Builds the Express app from its dependencies. No `listen` here, so tests can
 * drive it with supertest and inject a deterministic provider.
 */
export function createApp(deps: AppDependencies): Express {
  const { catalog, provider, providerTimeoutMs, clientDir, log = () => {} } = deps;
  const app = express();
  app.disable('x-powered-by');

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/categories', (_req, res) => {
    const body: CategoriesResponse = { categories: [...CATEGORIES] };
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
    });

    const body: SearchResponse = { query: parsed.query, total: items.length, items, enrichment };
    // Lightweight instrumentation, visible in the browser's Network > Timing panel.
    res.setHeader('Server-Timing', `search;dur=${searchMs.toFixed(1)}, provider;dur=${enrichment.durationMs}`);
    res.setHeader('Cache-Control', 'no-store');
    log(
      `search q=${JSON.stringify(parsed.query.q)} category=${parsed.query.category ?? '*'} sort=${parsed.query.sort} ` +
        `results=${items.length} enrichment=${enrichment.status}${enrichment.reason ? `(${enrichment.reason})` : ''} ` +
        `providerMs=${enrichment.durationMs}`,
    );
    res.json(body);
  });

  app.use('/api', (_req, res) => {
    const body: ApiErrorBody = { error: { code: 'NOT_FOUND', message: 'Unknown API route' } };
    res.status(404).json(body);
  });

  if (clientDir && existsSync(join(clientDir, 'index.html'))) {
    app.use(express.static(clientDir));
  }

  const onError: ErrorRequestHandler = (error, _req, res, _next) => {
    log(`unhandled error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    const body: ApiErrorBody = { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } };
    res.status(500).json(body);
  };
  app.use(onError);

  return app;
}
