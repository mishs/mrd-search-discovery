import { describe, expect, it } from 'vitest';
import { createLatestRequest } from '../../src/client/lib/latest';

/** A promise we can resolve by hand, to control the order responses arrive in. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('createLatestRequest', () => {
  it('aborts the previous request when a new one starts', () => {
    const latest = createLatestRequest();
    const first = latest.start();
    const second = latest.start();
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
  });

  it('ignores an older response that arrives after a newer one', async () => {
    const latest = createLatestRequest();
    let screen = '';

    async function search(term: string, response: Promise<string>) {
      const ticket = latest.start();
      const result = await response;
      if (ticket.isLatest()) screen = result;
    }

    const slow = deferred<string>();
    const fast = deferred<string>();
    const older = search('piz', slow.promise);
    const newer = search('pizza', fast.promise);

    fast.resolve('results for pizza');
    await newer;
    slow.resolve('results for piz'); // arrives late, e.g. it was already resolving when aborted
    await older;

    expect(screen).toBe('results for pizza');
  });

  it('cancel() aborts in-flight work and invalidates its ticket', () => {
    const latest = createLatestRequest();
    const ticket = latest.start();
    latest.cancel();
    expect(ticket.signal.aborted).toBe(true);
    expect(ticket.isLatest()).toBe(false);
  });
});
