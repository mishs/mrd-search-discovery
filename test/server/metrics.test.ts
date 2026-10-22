import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { SearchResponse } from '../../src/shared/contract.js';
import { createApp } from '../../src/server/app.js';
import { catalog } from '../../src/server/catalog/catalog.js';
import { createLiveDetailsCache } from '../../src/server/enrichment/liveDetailsCache.js';
import { createMetrics, type MetricsSnapshot } from '../../src/server/metrics.js';
import {
  baseDetailsFor,
  ProviderError,
  type LiveDetailsProvider,
  type ProviderItemDetails,
} from '../../src/server/provider/provider.js';
import { searchCatalog } from '../../src/server/search/search.js';

describe('createMetrics', () => {
  it('counts requests per route and status and summarises latency', () => {
    const metrics = createMetrics();
    metrics.recordRequest('GET /api/search', 200, 10);
    metrics.recordRequest('GET /api/search', 200, 30);
    metrics.recordRequest('GET /api/search', 400, 2);
    metrics.recordRequest('GET /api/search', 'aborted', 500);

    const route = metrics.snapshot().requests['GET /api/search'];
    expect(route?.count).toBe(4);
    expect(route?.byStatus).toEqual({ '200': 2, '400': 1, aborted: 1 });
    expect(route?.latencyMs).toEqual({ samples: 4, avg: 135.5, p50: 10, p95: 500, max: 500 });
  });

  it('keeps a bounded window of latency samples', () => {
    const metrics = createMetrics({ windowSize: 3 });
    for (const ms of [1000, 1, 2, 3]) metrics.recordRequest('GET /x', 200, ms);
    const route = metrics.snapshot().requests['GET /x'];
    expect(route?.count).toBe(4); // counts are cumulative
    expect(route?.latencyMs.max).toBe(3); // the 1000 ms sample has aged out
  });

  it('tallies response completeness separately from provider-call outcomes', () => {
    const metrics = createMetrics();
    const call = (outcome: 'ok' | 'timeout' | 'provider_error', durationMs: number) => ({
      outcome,
      durationMs,
      malformedEntries: 0,
    });
    metrics.recordSearch({
      summary: { status: 'complete', durationMs: 100, cacheHits: 0 },
      providerCall: call('ok', 100),
      itemCount: 3,
      cancelled: false,
    });
    metrics.recordSearch({
      summary: { status: 'unavailable', reason: 'timeout', durationMs: 1000, cacheHits: 0 },
      providerCall: call('timeout', 1000),
      itemCount: 2,
      cancelled: false,
    });
    // A partial response still records why the provider call failed.
    metrics.recordSearch({
      summary: { status: 'partial', reason: 'provider_error', durationMs: 50, cacheHits: 1 },
      providerCall: call('provider_error', 50),
      itemCount: 2,
      cancelled: false,
    });
    metrics.recordSearch({ summary: { status: 'skipped', durationMs: 0, cacheHits: 0 }, itemCount: 0, cancelled: false });

    const snapshot = metrics.snapshot();
    expect(snapshot.enrichment).toEqual({ complete: 1, partial: 1, unavailable: 1, skipped: 1 });
    expect(snapshot.provider.calls).toEqual({ ok: 1, timeout: 1, provider_error: 1, aborted: 0 });
    expect(snapshot.provider.latencyMs.samples).toBe(3);
  });

  it('counts a cancelled search as cancelled, not as a provider error or a completed search', () => {
    const metrics = createMetrics();
    metrics.recordSearch({
      summary: { status: 'unavailable', reason: 'provider_error', durationMs: 20, cacheHits: 0 },
      providerCall: { outcome: 'aborted', durationMs: 20, malformedEntries: 0 },
      itemCount: 2,
      cancelled: true,
    });
    const snapshot = metrics.snapshot();
    expect(snapshot.cancelledSearches).toBe(1);
    expect(snapshot.enrichment).toEqual({ complete: 0, partial: 0, unavailable: 0, skipped: 0 });
    expect(snapshot.provider.calls).toEqual({ ok: 0, timeout: 0, provider_error: 0, aborted: 1 });
    expect(snapshot.provider.latencyMs.samples).toBe(0);
  });

  it('reports cache hits, misses and hit rate; fully cached searches add no provider latency', () => {
    const metrics = createMetrics();
    metrics.recordSearch({
      summary: { status: 'complete', durationMs: 400, cacheHits: 0 },
      providerCall: { outcome: 'ok', durationMs: 400, malformedEntries: 0 },
      itemCount: 4,
      cancelled: false,
    });
    metrics.recordSearch({ summary: { status: 'complete', durationMs: 0, cacheHits: 4 }, itemCount: 4, cancelled: false });
    const snapshot = metrics.snapshot();
    expect(snapshot.cache).toEqual({ hits: 4, misses: 4, hitRate: 0.5 });
    expect(snapshot.provider.latencyMs.samples).toBe(1);
  });
});

describe('GET /api/metrics', () => {
  const okProvider: LiveDetailsProvider = {
    getLiveDetails: async (ids) => new Map(ids.map((id) => [id, baseDetailsFor(id)])),
  };

  it('reports route counts by matched pattern and enrichment outcomes', async () => {
    const app = createApp({ catalog, provider: okProvider, providerTimeoutMs: 1000 });
    await request(app).get('/api/search').query({ q: 'pizza' });
    await request(app).get('/api/search').query({ q: 'sushi' });
    await request(app).get('/api/search').query({ category: 'nope' });
    await request(app).get('/api/search').query({ q: 'no-such-dish' });

    const res = await request(app).get('/api/metrics');
    const body = res.body as MetricsSnapshot;
    expect(res.status).toBe(200);
    expect(body.requests['GET /api/search']).toMatchObject({ count: 4, byStatus: { '200': 3, '400': 1 } });
    expect(body.enrichment).toMatchObject({ complete: 2, skipped: 1 });
  });

  it('counts provider failures by reason', async () => {
    const failing: LiveDetailsProvider = {
      getLiveDetails: async () => {
        throw new ProviderError('503');
      },
    };
    const app = createApp({ catalog, provider: failing, providerTimeoutMs: 1000 });
    await request(app).get('/api/search').query({ q: 'burger' });
    const body = (await request(app).get('/api/metrics')).body as MetricsSnapshot;
    expect(body.enrichment.unavailable).toBe(1);
    expect(body.provider.calls).toMatchObject({ provider_error: 1, timeout: 0 });
  });

  it('keeps the reason when a partial response comes from a provider timeout', async () => {
    const hanging: LiveDetailsProvider = { getLiveDetails: () => new Promise(() => {}) };
    const cache = createLiveDetailsCache({ ttlMs: 30_000 });
    const [cachedItem] = searchCatalog(catalog, { q: 'pizza', category: null, sort: 'popularity' });
    if (cachedItem) cache.set(cachedItem.id, baseDetailsFor(cachedItem.id));
    const app = createApp({ catalog, provider: hanging, providerTimeoutMs: 20, liveDetailsCache: cache });

    const search = await request(app).get('/api/search').query({ q: 'pizza' });
    expect((search.body as SearchResponse).enrichment).toMatchObject({ status: 'partial', reason: 'timeout' });

    const body = (await request(app).get('/api/metrics')).body as MetricsSnapshot;
    expect(body.enrichment.partial).toBe(1);
    expect(body.provider.calls).toMatchObject({ timeout: 1, provider_error: 0 });
  });

  it('counts malformed provider entries', async () => {
    const malformed: LiveDetailsProvider = {
      getLiveDetails: async (ids) => new Map(ids.map((id) => [id, {} as ProviderItemDetails])),
    };
    const app = createApp({ catalog, provider: malformed, providerTimeoutMs: 1000 });
    const search = await request(app).get('/api/search').query({ q: 'sushi' });
    const total = (search.body as SearchResponse).total;

    const body = (await request(app).get('/api/metrics')).body as MetricsSnapshot;
    expect(body.provider).toMatchObject({ calls: { ok: 1 }, malformedEntries: total });
    expect(body.enrichment.unavailable).toBe(1);
  });

  it('records a client abort as a cancelled search, not a provider error', async () => {
    let providerStarted!: () => void;
    const started = new Promise<void>((resolve) => (providerStarted = resolve));
    const slow: LiveDetailsProvider = {
      getLiveDetails: (_ids, signal) =>
        new Promise((_, reject) => {
          providerStarted();
          signal.addEventListener('abort', () => reject(signal.reason));
        }),
    };
    const app = createApp({ catalog, provider: slow, providerTimeoutMs: 5000 });
    const server = app.listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      const controller = new AbortController();
      const pending = fetch(`http://127.0.0.1:${port}/api/search?q=pizza`, { signal: controller.signal }).catch(
        () => undefined,
      );
      await started;
      controller.abort();
      await pending;
      // Wait until the server has seen the disconnect and recorded the search.
      let body: MetricsSnapshot | undefined;
      for (let i = 0; i < 50; i++) {
        body = (await request(app).get('/api/metrics')).body as MetricsSnapshot;
        if (body.cancelledSearches > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(body?.cancelledSearches).toBe(1);
      expect(body?.provider.calls).toEqual({ ok: 0, timeout: 0, provider_error: 0, aborted: 1 });
      expect(body?.enrichment).toEqual({ complete: 0, partial: 0, unavailable: 0, skipped: 0 });
    } finally {
      server.close();
    }
  });
});
