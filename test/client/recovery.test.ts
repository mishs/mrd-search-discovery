import { describe, expect, it } from 'vitest';
import type { EnrichmentSummary, SearchResponse } from '../../src/shared/contract';
import { nextRecovery, providerEvidence, type RecoveryState } from '../../src/client/lib/recovery';

const response = (total: number, enrichment: Partial<EnrichmentSummary>): SearchResponse => ({
  query: { q: '', category: null, sort: 'popularity' },
  total,
  items: [],
  enrichment: { status: 'complete', durationMs: 100, cacheHits: 0, ...enrichment },
});

const down = response(3, { status: 'unavailable', reason: 'provider_error' });
const fresh = response(3, { status: 'complete', cacheHits: 1 });
const skipped = response(0, { status: 'skipped', durationMs: 0 });
const allCached = response(3, { status: 'complete', durationMs: 0, cacheHits: 3 });
const partialFailure = response(3, { status: 'partial', reason: 'timeout', cacheHits: 2 });
const partialOmitted = response(3, { status: 'partial' });
const unusable = response(3, { status: 'unavailable' }); // provider answered, but nothing usable

const run = (...responses: SearchResponse[]) => {
  let state: RecoveryState = { knownDown: false };
  const recovered: boolean[] = [];
  for (const r of responses) {
    const next = nextRecovery(state, r);
    recovered.push(next.recovered);
    state = { knownDown: next.knownDown };
  }
  return { recovered, state };
};

describe('providerEvidence', () => {
  it('classifies what each response proves about the provider', () => {
    expect(providerEvidence(down)).toBe('down');
    expect(providerEvidence(partialFailure)).toBe('down');
    expect(providerEvidence(fresh)).toBe('up');
    expect(providerEvidence(partialOmitted)).toBe('up');
    expect(providerEvidence(skipped)).toBe('unknown');
    expect(providerEvidence(allCached)).toBe('unknown');
    expect(providerEvidence(unusable)).toBe('unknown');
  });
});

describe('nextRecovery', () => {
  it('unavailable -> skipped is not a recovery, and the outage is remembered', () => {
    const { recovered, state } = run(down, skipped);
    expect(recovered).toEqual([false, false]);
    expect(state.knownDown).toBe(true);
  });

  it('unavailable -> fully cached is not a recovery', () => {
    expect(run(down, allCached).recovered).toEqual([false, false]);
  });

  it('unavailable -> partial is not announced as "back"', () => {
    expect(run(down, partialFailure).recovered).toEqual([false, false]);
    const omitted = run(down, partialOmitted);
    expect(omitted.recovered).toEqual([false, false]);
    expect(omitted.state.knownDown).toBe(false); // the provider did answer
  });

  it('unavailable -> successful provider call is a recovery', () => {
    expect(run(down, fresh).recovered).toEqual([false, true]);
  });

  it('unavailable -> skipped -> successful provider call is still a recovery', () => {
    expect(run(down, skipped, fresh).recovered).toEqual([false, false, true]);
  });

  it('says nothing when the provider was never known to be down', () => {
    expect(run(fresh, fresh).recovered).toEqual([false, false]);
  });
});
