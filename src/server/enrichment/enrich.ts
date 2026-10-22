import type {
  CatalogItem,
  EnrichmentSummary,
  LiveDetails,
  SearchResultItem,
} from '../../shared/contract.js';
import type { LiveDetailsProvider, ProviderItemDetails } from '../provider/provider.js';

export class ProviderTimeoutError extends Error {
  override name = 'ProviderTimeoutError';
}

export interface EnrichOptions {
  /** Maximum time we wait for the provider before answering without live details. */
  timeoutMs: number;
  /** Aborted when the HTTP client goes away, so we stop provider work we no longer need. */
  signal?: AbortSignal;
  now?: () => number;
}

export interface EnrichResult {
  items: SearchResultItem[];
  enrichment: EnrichmentSummary;
}

/** Treat provider data as untrusted: a malformed entry becomes "unknown", never R0. */
function toLiveDetails(details: ProviderItemDetails | undefined): LiveDetails {
  if (details === undefined) return { status: 'unknown', reason: 'not_returned' };
  if (!details.available) return { status: 'unavailable' };
  const { priceCents, deliveryMinutes } = details;
  const valid =
    Number.isInteger(priceCents) &&
    priceCents > 0 &&
    Number.isFinite(deliveryMinutes.min) &&
    deliveryMinutes.min >= 0 &&
    deliveryMinutes.max >= deliveryMinutes.min;
  if (!valid) return { status: 'unknown', reason: 'provider_error' };
  return { status: 'available', priceCents, currency: 'ZAR', deliveryMinutes: { ...deliveryMinutes } };
}

/**
 * Adds live availability, price and delivery estimates to catalog matches.
 *
 * Guarantees:
 * - No matches: the provider is not called (status "skipped").
 * - One batch call for all matches.
 * - Bounded wait: after `timeoutMs` we stop waiting even if the provider ignores
 *   the abort signal, and we abort it so well-behaved providers stop working.
 * - Failure or timeout never becomes a price or "out of stock": every item is
 *   returned as `unknown` with a reason, and the catalog results still show.
 */
export async function enrichItems(
  items: readonly CatalogItem[],
  provider: LiveDetailsProvider,
  options: EnrichOptions,
): Promise<EnrichResult> {
  const now = options.now ?? (() => performance.now());

  if (items.length === 0) {
    return { items: [], enrichment: { status: 'skipped', durationMs: 0 } };
  }

  const controller = new AbortController();
  const onOuterAbort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) controller.abort(options.signal.reason);
  options.signal?.addEventListener('abort', onOuterAbort, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new ProviderTimeoutError(`Provider did not respond within ${options.timeoutMs}ms`);
      controller.abort(error);
      reject(error);
    }, options.timeoutMs);
  });

  const started = now();
  const call = provider.getLiveDetails(
    items.map((item) => item.id),
    controller.signal,
  );
  // If the timeout wins the race, the provider's later rejection must not become an unhandled rejection.
  call.catch(() => undefined);

  try {
    const details = await Promise.race([call, timeout]);
    const enriched = items.map((item) => ({ ...item, live: toLiveDetails(details.get(item.id)) }));
    const missing = enriched.some((item) => item.live.status === 'unknown');
    return {
      items: enriched,
      enrichment: { status: missing ? 'partial' : 'complete', durationMs: Math.round(now() - started) },
    };
  } catch (error) {
    const reason = error instanceof ProviderTimeoutError ? 'timeout' : 'provider_error';
    return {
      items: items.map((item) => ({ ...item, live: { status: 'unknown', reason } })),
      enrichment: { status: 'unavailable', reason, durationMs: Math.round(now() - started) },
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onOuterAbort);
  }
}
