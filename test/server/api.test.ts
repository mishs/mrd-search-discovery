import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { SearchResponse } from '../../src/shared/contract.js';
import { createApp } from '../../src/server/app.js';
import { catalog } from '../../src/server/catalog/catalog.js';
import { createLiveDetailsCache } from '../../src/server/enrichment/liveDetailsCache.js';
import { baseDetailsFor, ProviderError, type LiveDetailsProvider } from '../../src/server/provider/provider.js';

/** Deterministic provider: answers instantly using the simulated price book. */
const healthyProvider = (): LiveDetailsProvider => ({
  getLiveDetails: vi.fn(async (ids: readonly string[]) => new Map(ids.map((id) => [id, baseDetailsFor(id)]))),
});

const failingProvider = (): LiveDetailsProvider => ({
  getLiveDetails: vi.fn(async () => {
    throw new ProviderError('503');
  }),
});

const appWith = (provider: LiveDetailsProvider) => createApp({ catalog, provider, providerTimeoutMs: 1000 });

describe('GET /api/search', () => {
  it('returns matching, sorted, enriched results', async () => {
    const res = await request(appWith(healthyProvider())).get('/api/search').query({ q: 'pizza' });

    expect(res.status).toBe(200);
    const body = res.body as SearchResponse;
    expect(body.query).toEqual({ q: 'pizza', category: null, sort: 'popularity' });
    expect(body.total).toBe(body.items.length);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.enrichment.status).toBe('complete');
    expect(body.items.every((i) => i.live.status === 'available' || i.live.status === 'unavailable')).toBe(true);
    expect(res.headers['server-timing']).toMatch(/provider;dur=/);
  });

  it('applies category filter and name sort', async () => {
    const res = await request(appWith(healthyProvider()))
      .get('/api/search')
      .query({ category: 'groceries', sort: 'name' });
    const body = res.body as SearchResponse;
    expect(body.items.every((i) => i.category === 'groceries')).toBe(true);
    const names = body.items.map((i) => i.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
  });

  it('rejects an unknown category with a 400 and field details', async () => {
    const res = await request(appWith(healthyProvider())).get('/api/search').query({ category: 'cars' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_QUERY');
    expect(res.body.error.details[0].field).toBe('category');
  });

  it('rejects repeated parameters', async () => {
    const res = await request(appWith(healthyProvider())).get('/api/search?q=a&q=b');
    expect(res.status).toBe(400);
  });

  it('still returns catalog results, marked degraded, when the provider fails', async () => {
    const res = await request(appWith(failingProvider())).get('/api/search').query({ q: 'burger' });
    expect(res.status).toBe(200);
    const body = res.body as SearchResponse;
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.enrichment).toMatchObject({ status: 'unavailable', reason: 'provider_error' });
    expect(body.items.every((i) => i.live.status === 'unknown')).toBe(true);
  });

  it('does not call the provider when nothing matches', async () => {
    const provider = healthyProvider();
    const res = await request(appWith(provider)).get('/api/search').query({ q: 'no-such-dish' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 0, items: [], enrichment: { status: 'skipped' } });
    expect(provider.getLiveDetails).not.toHaveBeenCalled();
  });
});

describe('other routes', () => {
  it('lists categories', async () => {
    const res = await request(appWith(healthyProvider())).get('/api/categories');
    expect(res.status).toBe(200);
    expect(res.body.categories).toContainEqual({ slug: 'pizza', label: 'Pizza' });
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const res = await request(appWith(healthyProvider())).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('GET /api/search with the live-details cache', () => {
  it('answers a repeated search from the cache without calling the provider again', async () => {
    const provider = healthyProvider();
    const app = createApp({
      catalog,
      provider,
      providerTimeoutMs: 1000,
      liveDetailsCache: createLiveDetailsCache({ ttlMs: 30_000 }),
    });

    await request(app).get('/api/search').query({ q: 'pizza' });
    const second = await request(app).get('/api/search').query({ q: 'pizza' });

    expect(provider.getLiveDetails).toHaveBeenCalledTimes(1);
    expect((second.body as SearchResponse).enrichment).toMatchObject({ status: 'complete', cacheHits: 6, durationMs: 0 });
    expect(second.headers['server-timing']).toContain('cache;desc="6/6 hits"');
  });
});

describe('GET /api/suggestions', () => {
  it('returns capped, catalog-only suggestions without calling the provider', async () => {
    const provider = healthyProvider();
    const res = await request(appWith(provider)).get('/api/suggestions').query({ q: 'piz' });

    expect(res.status).toBe(200);
    expect(res.body.q).toBe('piz');
    expect(res.body.suggestions).toContainEqual({ label: 'Pizza', kind: 'category' });
    expect(res.body.suggestions.length).toBeLessThanOrEqual(8);
    expect(res.headers['cache-control']).toBe('private, max-age=300');
    expect(provider.getLiveDetails).not.toHaveBeenCalled();
  });

  it('scopes suggestions to the category filter', async () => {
    const res = await request(appWith(healthyProvider()))
      .get('/api/suggestions')
      .query({ q: 'ch', category: 'desserts' });
    expect(res.body.suggestions.map((s: { label: string }) => s.label)).toEqual([
      'Chocolate Brownie',
      'Vegan Chocolate Mousse',
    ]);
  });

  it('returns no suggestions for blank input and rejects an unknown category', async () => {
    const app = appWith(healthyProvider());
    expect((await request(app).get('/api/suggestions').query({ q: ' ' })).body.suggestions).toEqual([]);
    expect((await request(app).get('/api/suggestions').query({ q: 'a', category: 'cars' })).status).toBe(400);
  });
});
