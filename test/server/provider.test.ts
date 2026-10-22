import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  abortableDelay,
  createSimulatedProvider,
  ProviderError,
} from '../../src/server/provider/provider.js';
import { createSeededRandom } from '../../src/server/provider/random.js';

afterEach(() => {
  vi.useRealTimers();
});

const sequence = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
};

describe('simulated provider', () => {
  it('waits a variable latency within the configured range, then answers', async () => {
    vi.useFakeTimers();
    // random() -> 0.5 for latency (100 + 0.5*200 = 200ms), 0.9 for the failure roll, 0 for drift.
    const provider = createSimulatedProvider({
      minLatencyMs: 100,
      maxLatencyMs: 300,
      failureRate: 0.1,
      random: sequence(0.5, 0.9, 0),
    });
    let settled = false;
    const pending = provider.getLiveDetails(['itm-001'], new AbortController().signal).then((r) => {
      settled = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(199);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(result.get('itm-001')).toMatchObject({ priceCents: expect.any(Number) });
  });

  it('fails when the failure roll is below the failure rate', async () => {
    const provider = createSimulatedProvider({
      minLatencyMs: 0,
      maxLatencyMs: 0,
      failureRate: 0.5,
      random: sequence(0, 0.1),
    });
    await expect(provider.getLiveDetails(['itm-001'], new AbortController().signal)).rejects.toBeInstanceOf(
      ProviderError,
    );
  });

  it('gives each item a stable integer price in cents', async () => {
    const provider = createSimulatedProvider({ minLatencyMs: 0, maxLatencyMs: 0, failureRate: 0, random: () => 0.3 });
    const a = await provider.getLiveDetails(['itm-005'], new AbortController().signal);
    const b = await provider.getLiveDetails(['itm-005'], new AbortController().signal);
    expect(a.get('itm-005')?.priceCents).toBe(b.get('itm-005')?.priceCents);
    expect(Number.isInteger(a.get('itm-005')?.priceCents)).toBe(true);
  });

  it('is repeatable with a seed', () => {
    const r1 = createSeededRandom(42);
    const r2 = createSeededRandom(42);
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()]);
  });
});

describe('abortableDelay', () => {
  it('rejects immediately and clears its timer when aborted', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = abortableDelay(10_000, controller.signal);
    expect(vi.getTimerCount()).toBe(1);
    controller.abort(new Error('stop'));
    await expect(pending).rejects.toThrow('stop');
    expect(vi.getTimerCount()).toBe(0);
  });
});
