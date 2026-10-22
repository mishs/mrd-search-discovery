import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatalogItem } from '../../src/shared/contract.js';
import { catalog } from '../../src/server/catalog/catalog.js';
import { enrichItems } from '../../src/server/enrichment/enrich.js';
import { createLiveDetailsCache } from '../../src/server/enrichment/liveDetailsCache.js';
import {
  ProviderError,
  type LiveDetailsProvider,
  type ProviderItemDetails,
} from '../../src/server/provider/provider.js';

const items: CatalogItem[] = catalog.slice(0, 3);
const [first, second, third] = items as [CatalogItem, CatalogItem, CatalogItem];

const details = (overrides: Partial<ProviderItemDetails> = {}): ProviderItemDetails => ({
  available: true,
  priceCents: 8990,
  deliveryMinutes: { min: 20, max: 30 },
  ...overrides,
});

const providerReturning = (map: Map<string, ProviderItemDetails>): LiveDetailsProvider => ({
  getLiveDetails: vi.fn(async () => map),
});

afterEach(() => {
  vi.useRealTimers();
});

describe('enrichItems', () => {
  it('maps provider answers to available and unavailable', async () => {
    const provider = providerReturning(
      new Map([
        [first.id, details()],
        [second.id, details({ available: false })],
        [third.id, details({ priceCents: 4590 })],
      ]),
    );
    const result = await enrichItems(items, provider, { timeoutMs: 1000 });

    expect(result.enrichment.status).toBe('complete');
    expect(result.items.map((i) => i.live)).toEqual([
      { status: 'available', priceCents: 8990, currency: 'ZAR', deliveryMinutes: { min: 20, max: 30 } },
      { status: 'unavailable' },
      { status: 'available', priceCents: 4590, currency: 'ZAR', deliveryMinutes: { min: 20, max: 30 } },
    ]);
  });

  it('calls the provider once with every matching id (batch)', async () => {
    const provider = providerReturning(new Map());
    await enrichItems(items, provider, { timeoutMs: 1000 });
    expect(provider.getLiveDetails).toHaveBeenCalledTimes(1);
    expect(provider.getLiveDetails).toHaveBeenCalledWith(
      [first.id, second.id, third.id],
      expect.any(AbortSignal),
    );
  });

  it('skips the provider entirely when there are no matches', async () => {
    const provider = providerReturning(new Map());
    const result = await enrichItems([], provider, { timeoutMs: 1000 });
    expect(provider.getLiveDetails).not.toHaveBeenCalled();
    expect(result).toEqual({ items: [], enrichment: { status: 'skipped', durationMs: 0, cacheHits: 0 } });
  });

  it('keeps catalog results but marks every item unknown when the provider fails', async () => {
    const provider: LiveDetailsProvider = {
      getLiveDetails: async () => {
        throw new ProviderError('503');
      },
    };
    const result = await enrichItems(items, provider, { timeoutMs: 1000 });

    expect(result.enrichment).toMatchObject({ status: 'unavailable', reason: 'provider_error' });
    expect(result.items.map((i) => i.name)).toEqual(items.map((i) => i.name));
    for (const item of result.items) {
      // Failure must never look like "free" or "out of stock".
      expect(item.live).toEqual({ status: 'unknown', reason: 'provider_error' });
    }
  });

  it('stops waiting after the timeout and aborts the provider call', async () => {
    vi.useFakeTimers();
    let receivedSignal: AbortSignal | undefined;
    // A provider that never answers and ignores abort: the wait must still be bounded.
    const provider: LiveDetailsProvider = {
      getLiveDetails: (_ids, signal) => {
        receivedSignal = signal;
        return new Promise(() => {});
      },
    };

    const pending = enrichItems(items, provider, { timeoutMs: 500 });
    await vi.advanceTimersByTimeAsync(500);
    const result = await pending;

    expect(result.enrichment).toMatchObject({ status: 'unavailable', reason: 'timeout' });
    expect(result.items.every((i) => i.live.status === 'unknown')).toBe(true);
    expect(receivedSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears its timeout when the provider answers in time', async () => {
    vi.useFakeTimers();
    const provider = providerReturning(new Map([[first.id, details()]]));
    await enrichItems([first], provider, { timeoutMs: 500 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports partial enrichment when the provider omits some items', async () => {
    const provider = providerReturning(new Map([[first.id, details()]]));
    const result = await enrichItems(items, provider, { timeoutMs: 1000 });
    expect(result.enrichment.status).toBe('partial');
    expect(result.items[1]?.live).toEqual({ status: 'unknown', reason: 'not_returned' });
  });

  it('treats a malformed price (e.g. 0) as unknown rather than showing R0', async () => {
    const provider = providerReturning(new Map([[first.id, details({ priceCents: 0 })]]));
    const result = await enrichItems([first], provider, { timeoutMs: 1000 });
    expect(result.items[0]?.live).toEqual({ status: 'unknown', reason: 'provider_error' });
  });

  it('aborts the provider call when the caller signal aborts (client went away)', async () => {
    let receivedSignal: AbortSignal | undefined;
    const provider: LiveDetailsProvider = {
      getLiveDetails: (_ids, signal) =>
        new Promise((_, reject) => {
          receivedSignal = signal;
          signal.addEventListener('abort', () => reject(signal.reason));
        }),
    };
    const outer = new AbortController();
    const pending = enrichItems(items, provider, { timeoutMs: 10_000, signal: outer.signal });
    outer.abort();
    await pending;
    expect(receivedSignal?.aborted).toBe(true);
  });
});

describe('enrichItems with a live-details cache', () => {
  const freshCache = () => createLiveDetailsCache({ ttlMs: 30_000, now: () => 0 });

  it('reuses fresh answers and asks the provider only for the rest', async () => {
    const cache = freshCache();
    cache.set(first.id, details({ priceCents: 1190 }));
    const provider = providerReturning(new Map([[second.id, details()], [third.id, details()]]));

    const result = await enrichItems(items, provider, { timeoutMs: 1000, cache });

    expect(provider.getLiveDetails).toHaveBeenCalledWith([second.id, third.id], expect.any(AbortSignal));
    expect(result.enrichment).toMatchObject({ status: 'complete', cacheHits: 1 });
    expect(result.items[0]?.live).toMatchObject({ status: 'available', priceCents: 1190 });
  });

  it('skips the provider entirely when every item is cached', async () => {
    const cache = freshCache();
    for (const item of items) cache.set(item.id, details());
    const provider = providerReturning(new Map());

    const result = await enrichItems(items, provider, { timeoutMs: 1000, cache });

    expect(provider.getLiveDetails).not.toHaveBeenCalled();
    expect(result.enrichment).toEqual({ status: 'complete', durationMs: 0, cacheHits: 3 });
  });

  it('caches "unavailable" answers but never malformed ones', async () => {
    const cache = freshCache();
    const provider = providerReturning(
      new Map([
        [first.id, details({ available: false })],
        [second.id, details({ priceCents: 0 })],
      ]),
    );
    await enrichItems([first, second], provider, { timeoutMs: 1000, cache });
    expect(cache.get(first.id)).toMatchObject({ available: false });
    expect(cache.get(second.id)).toBeUndefined();
  });

  it('on provider failure keeps cached items, marks the rest unknown, and caches nothing new', async () => {
    const cache = freshCache();
    cache.set(first.id, details());
    const provider: LiveDetailsProvider = {
      getLiveDetails: async () => {
        throw new ProviderError('503');
      },
    };

    const result = await enrichItems(items, provider, { timeoutMs: 1000, cache });

    expect(result.enrichment).toMatchObject({ status: 'partial', reason: 'provider_error', cacheHits: 1 });
    expect(result.items.map((i) => i.live.status)).toEqual(['available', 'unknown', 'unknown']);
    expect(cache.size).toBe(1);
  });
});
