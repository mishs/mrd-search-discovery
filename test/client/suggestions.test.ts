import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Suggestion } from '../../src/shared/contract';
import { createSuggestionLoader, type LoadSuggestions } from '../../src/client/lib/suggestions';

const suggestion = (label: string): Suggestion => ({ label, kind: 'item' });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('createSuggestionLoader', () => {
  it('sends one request after a pause in typing, not one per keystroke', async () => {
    const load = vi.fn<LoadSuggestions>(async (q) => [suggestion(`${q}!`)]);
    const loader = createSuggestionLoader({ load, delayMs: 150 });
    const onResult = vi.fn();

    for (const typed of ['pi', 'piz', 'pizz', 'pizza']) {
      loader.request(typed, null, onResult);
      await vi.advanceTimersByTimeAsync(50);
    }
    expect(load).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(150);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith('pizza', null, expect.any(AbortSignal));
    expect(onResult).toHaveBeenLastCalledWith([suggestion('pizza!')]);
  });

  it('sends nothing below the minimum length and clears suggestions', async () => {
    const load = vi.fn<LoadSuggestions>(async () => []);
    const loader = createSuggestionLoader({ load, minChars: 2 });
    const onResult = vi.fn();
    loader.request(' p ', null, onResult);
    await vi.advanceTimersByTimeAsync(1000);
    expect(load).not.toHaveBeenCalled();
    expect(onResult).toHaveBeenCalledWith([]);
  });

  it('answers a repeated query from memory without a request', async () => {
    const load = vi.fn<LoadSuggestions>(async () => [suggestion('Pizza')]);
    const loader = createSuggestionLoader({ load, delayMs: 100 });
    const onResult = vi.fn();

    loader.request('pi', null, onResult);
    await vi.advanceTimersByTimeAsync(100);
    loader.request('pin', null, onResult);
    await vi.advanceTimersByTimeAsync(100);
    loader.request('PI ', null, onResult); // backspace back to a known prefix (case/space-insensitive)

    expect(load).toHaveBeenCalledTimes(2);
    expect(onResult).toHaveBeenLastCalledWith([suggestion('Pizza')]);
  });

  it('keeps cached answers separate per category', async () => {
    const load = vi.fn<LoadSuggestions>(async (_q, category) => [suggestion(category ?? 'all')]);
    const loader = createSuggestionLoader({ load, delayMs: 0 });
    const onResult = vi.fn();
    loader.request('ch', null, onResult);
    await vi.advanceTimersByTimeAsync(0);
    loader.request('ch', 'desserts', onResult);
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(2);
    expect(onResult).toHaveBeenLastCalledWith([suggestion('desserts')]);
  });

  it('aborts the in-flight request and ignores its late answer when a newer one starts', async () => {
    let resolveFirst!: (s: Suggestion[]) => void;
    const signals: AbortSignal[] = [];
    const load = vi.fn<LoadSuggestions>((q, _c, signal) => {
      signals.push(signal);
      return q === 'sa' ? new Promise((resolve) => (resolveFirst = resolve)) : Promise.resolve([suggestion('Salmon')]);
    });
    const loader = createSuggestionLoader({ load, delayMs: 0 });
    const onResult = vi.fn();

    loader.request('sa', null, onResult);
    await vi.advanceTimersByTimeAsync(0);
    loader.request('sal', null, onResult);
    await vi.advanceTimersByTimeAsync(0);
    resolveFirst([suggestion('Salads (stale)')]);
    await vi.advanceTimersByTimeAsync(0);

    expect(signals[0]?.aborted).toBe(true);
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith([suggestion('Salmon')]);
  });

  it('cancel() drops a pending request entirely', async () => {
    const load = vi.fn<LoadSuggestions>(async () => []);
    const loader = createSuggestionLoader({ load, delayMs: 150 });
    loader.request('pizza', null, vi.fn());
    loader.cancel();
    await vi.advanceTimersByTimeAsync(500);
    expect(load).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shows no suggestions when the request fails', async () => {
    const load = vi.fn<LoadSuggestions>(async () => {
      throw new Error('network');
    });
    const loader = createSuggestionLoader({ load, delayMs: 0 });
    const onResult = vi.fn();
    loader.request('pizza', null, onResult);
    await vi.advanceTimersByTimeAsync(0);
    expect(onResult).toHaveBeenCalledWith([]);
  });
});
