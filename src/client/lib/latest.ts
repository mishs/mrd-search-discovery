/**
 * "Latest request wins" helper.
 *
 * Each start() aborts the previous request and returns a ticket. Before writing
 * results, errors or loading flags, callers check ticket.isLatest(): an older
 * response that arrives late (or an older request's error/finally) can then
 * never overwrite the state of a newer one. Aborting alone is not enough,
 * because a response may already be resolving when abort() is called.
 */
export interface RequestTicket {
  signal: AbortSignal;
  isLatest: () => boolean;
}

export function createLatestRequest() {
  let controller: AbortController | null = null;
  let generation = 0;

  return {
    start(): RequestTicket {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      const id = ++generation;
      return { signal: current.signal, isLatest: () => id === generation };
    },
    /** Cancel whatever is in flight (e.g. when the component is destroyed). */
    cancel(): void {
      controller?.abort();
      controller = null;
      generation++;
    },
  };
}
