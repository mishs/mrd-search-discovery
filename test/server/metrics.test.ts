import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/server/app.js';
import { catalog } from '../../src/server/catalog/catalog.js';
import { createMetrics, type MetricsSnapshot } from '../../src/server/metrics.js';
import { baseDetailsFor, ProviderError, type LiveDetailsProvider } from '../../src/server/provider/provider.js';

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

  it('tallies enrichment outcomes and provider latency (skipped searches excluded)', () => {
    const metrics = createMetrics();
    metrics.recordEnrichment({ status: 'complete', durationMs: 100 });
    metrics.recordEnrichment({ status: 'unavailable', reason: 'timeout', durationMs: 1000 });
    metrics.recordEnrichment({ status: 'unavailable', reason: 'provider_error', durationMs: 50 });
    metrics.recordEnrichment({ status: 'skipped', durationMs: 0 });

    const { enrichment } = metrics.snapshot();
    expect(enrichment).toMatchObject({
      complete: 1,
      partial: 0,
      skipped: 1,
      unavailable: { timeout: 1, provider_error: 1 },
    });
    expect(enrichment.providerLatencyMs.samples).toBe(3);
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
    expect(body.enrichment.unavailable).toEqual({ timeout: 0, provider_error: 1 });
  });
});
