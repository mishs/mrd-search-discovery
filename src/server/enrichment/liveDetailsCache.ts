import type { ProviderItemDetails } from '../provider/provider.js';

/**
 * Short-lived cache of provider answers, keyed by item id.
 *
 * Freshness policy (the reason this is safe to cache at all):
 * - An entry is served for at most `ttlMs` after the provider returned it.
 *   Callers that wait before responding pass `minRemainingMs` (enrich.ts passes
 *   the provider timeout), so the entry is still fresh when the response is sent.
 *   This bounds the age of data in an API response; the client keeps showing a
 *   response until the next search and does not expire it on screen.
 * - Only real provider answers are cached ("available" and "unavailable").
 *   Failures, timeouts and malformed entries are never cached, so an outage
 *   is not remembered after the provider recovers.
 * - Size is bounded; the oldest entry is evicted first.
 *
 * In-process and per-instance: fine for one server; several instances would
 * need a shared cache (e.g. Redis) or accept per-instance hit rates.
 */
export interface LiveDetailsCache {
  /** Returns the entry only if it is fresh now and for at least `minRemainingMs` more (default 0). */
  get(id: string, minRemainingMs?: number): ProviderItemDetails | undefined;
  set(id: string, details: ProviderItemDetails): void;
  readonly size: number;
}

export interface LiveDetailsCacheOptions {
  ttlMs: number;
  maxEntries?: number;
  now?: () => number;
}

export function createLiveDetailsCache(options: LiveDetailsCacheOptions): LiveDetailsCache {
  const { ttlMs, maxEntries = 1000, now = Date.now } = options;
  const entries = new Map<string, { details: ProviderItemDetails; expiresAt: number }>();

  return {
    get(id, minRemainingMs = 0) {
      const entry = entries.get(id);
      if (!entry) return undefined;
      const at = now();
      if (at >= entry.expiresAt) {
        entries.delete(id);
        return undefined;
      }
      return at + minRemainingMs < entry.expiresAt ? entry.details : undefined;
    },

    set(id, details) {
      if (ttlMs <= 0) return;
      // Re-insert so Map order reflects recency of writes; evict from the front.
      entries.delete(id);
      entries.set(id, { details, expiresAt: now() + ttlMs });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },

    get size() {
      return entries.size;
    },
  };
}
