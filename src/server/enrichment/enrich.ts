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

/**
 * What happened to the one provider call, kept apart from how complete the
 * response is: a search can be "partial" because of a timeout, a failure or
 * malformed entries, and a cancelled search is not a provider error.
 */
export type ProviderCallOutcome = 'ok' | 'timeout' | 'provider_error' | 'aborted';

export interface ProviderCallSummary {
  outcome: ProviderCallOutcome;
  durationMs: number;
  /** Entries the provider returned that failed validation (shown as unknown, never cached). */
  malformedEntries: number;
}

export interface EnrichResult {
  items: SearchResultItem[];
  enrichment: EnrichmentSummary;
  /** Absent when the provider was not called (no matches, or everything cached). */
  providerCall?: ProviderCallSummary;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isMinutes = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/**
 * Provider data is untrusted. Returns a clean copy of a well-formed entry, or
 * undefined. Only the result of this function is ever cached or converted.
 * - `available` must be a boolean: `{}` is malformed, not "out of stock".
 * - An available item needs a positive integer price and a finite delivery
 *   window of whole minutes with min <= max.
 */
export function parseProviderEntry(raw: unknown): ProviderItemDetails | undefined {
  if (!isRecord(raw) || typeof raw.available !== 'boolean') return undefined;
  if (!raw.available) return { available: false, priceCents: 0, deliveryMinutes: { min: 0, max: 0 } };

  const { priceCents, deliveryMinutes } = raw;
  if (typeof priceCents !== 'number' || !Number.isSafeInteger(priceCents) || priceCents <= 0) return undefined;
  if (!isRecord(deliveryMinutes)) return undefined;
  const { min, max } = deliveryMinutes;
  if (!isMinutes(min) || !isMinutes(max) || max < min) return undefined;
  return { available: true, priceCents, deliveryMinutes: { min, max } };
}

function toLiveDetails(details: ProviderItemDetails | undefined): LiveDetails {
  if (details === undefined) return { status: 'unknown', reason: 'not_returned' };
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
 * - Freshness holds when the response is built, not only at lookup: if we are
 *   going to wait for the provider, a cached entry that could expire during
 *   that wait (up to `timeoutMs`) is fetched again instead of reused.
 * - Bounded wait (see fetchWithDeadline).
 * - Failure, timeout or a malformed entry never becomes a price or "out of
 *   stock": affected items are `unknown` with a reason, and the catalog results
 *   still show. Items answered from the cache keep their live details ("partial").
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
  if (options.cache && known.size < items.length) {
    // We will wait up to timeoutMs: don't reuse an entry that could expire meanwhile.
    for (const id of [...known.keys()]) {
      if (!options.cache.get(id, options.timeoutMs)) known.delete(id);
    }
  }
  const cacheHits = known.size;
  const toFetch = items.map((item) => item.id).filter((id) => !known.has(id));
  const requested = new Set(toFetch);
  const malformed = new Set<string>();

  let failure: Exclude<UnknownReason, 'not_returned'> | undefined;
  let durationMs = 0;
  let providerCall: ProviderCallSummary | undefined;

  if (toFetch.length > 0) {
    const started = now();
    let outcome: ProviderCallOutcome = 'ok';
    try {
      const fetched: unknown = await fetchWithDeadline(provider, toFetch, options.timeoutMs, options.signal);
      if (!(fetched instanceof Map)) throw new Error('Provider returned a malformed response');
      for (const [id, raw] of fetched as Map<unknown, unknown>) {
        if (typeof id !== 'string' || !requested.has(id)) continue; // ignore anything we didn't ask for
        const details = parseProviderEntry(raw);
        if (details === undefined) {
          malformed.add(id);
          continue;
        }
        known.set(id, details);
        options.cache?.set(id, details);
      }
    } catch (error) {
      failure = error instanceof ProviderTimeoutError ? 'timeout' : 'provider_error';
      outcome = options.signal?.aborted ? 'aborted' : failure;
    }
    durationMs = Math.round(now() - started);
    providerCall = { outcome, durationMs, malformedEntries: malformed.size };
  }

  const enriched: SearchResultItem[] = items.map((item) => {
    const details = known.get(item.id);
    if (details !== undefined) return { ...item, live: toLiveDetails(details) };
    if (malformed.has(item.id)) return { ...item, live: { status: 'unknown', reason: 'provider_error' } };
    if (failure) return { ...item, live: { status: 'unknown', reason: failure } };
    return { ...item, live: toLiveDetails(undefined) };
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
  return { items: enriched, enrichment, ...(providerCall ? { providerCall } : {}) };
}
