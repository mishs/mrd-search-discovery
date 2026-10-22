import type {
  CatalogItem,
  EnrichmentSummary,
  LiveDetails,
  SearchResultItem,
  UnknownReason,
} from '../../shared/contract.js';
import type { LiveDetailsProvider, ProviderItemDetails } from '../provider/provider.js';
import type { LiveDetailsCache } from './liveDetailsCache.js';

export class ProviderTimeoutError extends Error {
  override name = 'ProviderTimeoutError';
}

export interface EnrichOptions {
  /** Maximum time we wait for the provider before answering without live details. */
  timeoutMs: number;
  /** Aborted when the HTTP client goes away, so we stop provider work we no longer need. */
  signal?: AbortSignal;
  /** Optional short-lived cache of provider answers (see liveDetailsCache.ts). */
  cache?: LiveDetailsCache;
  now?: () => number;
}

export interface EnrichResult {
  items: SearchResultItem[];
  enrichment: EnrichmentSummary;
}

/** Provider data is untrusted: only a well-formed answer may become a price. */
function isWellFormed(details: ProviderItemDetails): boolean {
  if (!details.available) return true;
  const { priceCents, deliveryMinutes } = details;
  return (
    Number.isInteger(priceCents) &&
    priceCents > 0 &&
    Number.isFinite(deliveryMinutes.min) &&
    deliveryMinutes.min >= 0 &&
    deliveryMinutes.max >= deliveryMinutes.min
  );
}

function toLiveDetails(details: ProviderItemDetails | undefined): LiveDetails {
  if (details === undefined) return { status: 'unknown', reason: 'not_returned' };
  if (!isWellFormed(details)) return { status: 'unknown', reason: 'provider_error' };
  if (!details.available) return { status: 'unavailable' };
  return {
    status: 'available',
    priceCents: details.priceCents,
    currency: 'ZAR',
    deliveryMinutes: { ...details.deliveryMinutes },
  };
}

/**
 * One provider call with a hard deadline. Resolves with the provider's answer or
 * rejects with ProviderTimeoutError / the provider's error. The deadline holds
 * even if the provider ignores the abort signal; the signal is still aborted so
 * cooperative providers stop work. Nothing is left running afterwards.
 */
async function fetchWithDeadline(
  provider: LiveDetailsProvider,
  ids: readonly string[],
  timeoutMs: number,
  outerSignal: AbortSignal | undefined,
): Promise<Map<string, ProviderItemDetails>> {
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort(outerSignal?.reason);
  if (outerSignal?.aborted) controller.abort(outerSignal.reason);
  outerSignal?.addEventListener('abort', onOuterAbort, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new ProviderTimeoutError(`Provider did not respond within ${timeoutMs}ms`);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });

  const call = provider.getLiveDetails(ids, controller.signal);
  // If the timeout wins the race, the provider's later rejection must not become an unhandled rejection.
  call.catch(() => undefined);

  try {
    return await Promise.race([call, timeout]);
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener('abort', onOuterAbort);
  }
}

/**
 * Adds live availability, price and delivery estimates to catalog matches.
 *
 * Guarantees:
 * - No matches: the provider is not called (status "skipped").
 * - Fresh cached answers are reused; one batch call fetches only the rest, and
 *   no call is made when everything is cached.
 * - Bounded wait (see fetchWithDeadline).
 * - Failure or timeout never becomes a price or "out of stock": affected items
 *   are `unknown` with a reason, and the catalog results still show. Items
 *   answered from the cache keep their live details ("partial").
 */
export async function enrichItems(
  items: readonly CatalogItem[],
  provider: LiveDetailsProvider,
  options: EnrichOptions,
): Promise<EnrichResult> {
  const now = options.now ?? (() => performance.now());

  if (items.length === 0) {
    return { items: [], enrichment: { status: 'skipped', durationMs: 0, cacheHits: 0 } };
  }

  const known = new Map<string, ProviderItemDetails>();
  for (const item of items) {
    const cached = options.cache?.get(item.id);
    if (cached) known.set(item.id, cached);
  }
  const cacheHits = known.size;
  const toFetch = items.map((item) => item.id).filter((id) => !known.has(id));

  let failure: Exclude<UnknownReason, 'not_returned'> | undefined;
  let durationMs = 0;

  if (toFetch.length > 0) {
    const started = now();
    try {
      const fetched = await fetchWithDeadline(provider, toFetch, options.timeoutMs, options.signal);
      for (const [id, details] of fetched) {
        if (!toFetch.includes(id)) continue; // ignore anything we didn't ask for
        known.set(id, details);
        if (isWellFormed(details)) options.cache?.set(id, details);
      }
    } catch (error) {
      failure = error instanceof ProviderTimeoutError ? 'timeout' : 'provider_error';
    }
    durationMs = Math.round(now() - started);
  }

  const enriched: SearchResultItem[] = items.map((item) => {
    const details = known.get(item.id);
    if (details === undefined && failure) return { ...item, live: { status: 'unknown', reason: failure } };
    return { ...item, live: toLiveDetails(details) };
  });

  const unknownCount = enriched.filter((item) => item.live.status === 'unknown').length;
  let enrichment: EnrichmentSummary;
  if (unknownCount === 0) {
    enrichment = { status: 'complete', durationMs, cacheHits };
  } else if (unknownCount === enriched.length) {
    enrichment = { status: 'unavailable', ...(failure ? { reason: failure } : {}), durationMs, cacheHits };
  } else {
    enrichment = { status: 'partial', ...(failure ? { reason: failure } : {}), durationMs, cacheHits };
  }
  return { items: enriched, enrichment };
}
