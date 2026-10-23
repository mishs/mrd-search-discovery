import type { SearchResponse } from '../../shared/contract';

/**
 * What a search response tells us about the live-pricing provider, so the UI
 * only says "live prices are back" when a response actually proves it.
 *
 * - down:    the provider failed or timed out for this search.
 * - up:      the provider was called and answered (some items were fetched, not
 *            all served from the cache, and no failure reason).
 * - unknown: nothing was learned. No matches (provider not called), every item
 *            from the cache, or an answer with no usable entries.
 */
export type ProviderEvidence = 'down' | 'up' | 'unknown';

export function providerEvidence(response: SearchResponse): ProviderEvidence {
  const { status, reason, cacheHits } = response.enrichment;
  if (reason) return 'down';
  if (status === 'skipped' || status === 'unavailable') return 'unknown';
  return cacheHits < response.total ? 'up' : 'unknown';
}

export interface RecoveryState {
  /** The last evidence we had says the provider is down. */
  knownDown: boolean;
}

/**
 * Folds one response into the state. `recovered` is true only when the provider
 * was last known to be down and this response proves it answered with every
 * item priced, so the "back" message never claims more than we know.
 */
export function nextRecovery(state: RecoveryState, response: SearchResponse): RecoveryState & { recovered: boolean } {
  const evidence = providerEvidence(response);
  if (evidence === 'down') return { knownDown: true, recovered: false };
  if (evidence === 'unknown') return { knownDown: state.knownDown, recovered: false };
  return { knownDown: false, recovered: state.knownDown && response.enrichment.status === 'complete' };
}
