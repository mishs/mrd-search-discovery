import { describe, expect, it } from 'vitest';
import { createLiveDetailsCache } from '../../src/server/enrichment/liveDetailsCache.js';
import type { ProviderItemDetails } from '../../src/server/provider/provider.js';

const details = (priceCents = 8990): ProviderItemDetails => ({
  available: true,
  priceCents,
  deliveryMinutes: { min: 20, max: 30 },
});

describe('createLiveDetailsCache', () => {
  it('serves an entry until its TTL elapses, then forgets it', () => {
    let now = 1_000;
    const cache = createLiveDetailsCache({ ttlMs: 30_000, now: () => now });
    cache.set('a', details());

    now += 29_999;
    expect(cache.get('a')).toEqual(details());
    now += 1;
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('refreshes the TTL when an entry is written again', () => {
    let now = 0;
    const cache = createLiveDetailsCache({ ttlMs: 100, now: () => now });
    cache.set('a', details(1000));
    now = 90;
    cache.set('a', details(2000));
    now = 150;
    expect(cache.get('a')?.priceCents).toBe(2000);
  });

  it('evicts the oldest entry beyond maxEntries', () => {
    const cache = createLiveDetailsCache({ ttlMs: 1_000, maxEntries: 2, now: () => 0 });
    cache.set('a', details());
    cache.set('b', details());
    cache.set('c', details());
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeDefined();
    expect(cache.get('c')).toBeDefined();
  });

  it('stores nothing when the TTL is zero (cache disabled)', () => {
    const cache = createLiveDetailsCache({ ttlMs: 0 });
    cache.set('a', details());
    expect(cache.size).toBe(0);
  });

  it('honours minRemainingMs: only entries fresh for that much longer are returned', () => {
    let clock = 0;
    const cache = createLiveDetailsCache({ ttlMs: 1000, now: () => clock });
    cache.set('a', { available: false, priceCents: 0, deliveryMinutes: { min: 0, max: 0 } });
    clock = 600;
    expect(cache.get('a', 300)).toBeDefined(); // expires at 1000 > 900
    expect(cache.get('a', 400)).toBeUndefined(); // 1000 is not after 1000
    expect(cache.get('a')).toBeDefined(); // still fresh right now, and kept
  });
});
