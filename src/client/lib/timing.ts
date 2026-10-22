/**
 * Client-side timing for searches, viewable in two places:
 * - DevTools → Performance → Timings: a "search" measure per completed search.
 * - DevTools console (development builds only): one line per search that splits
 *   total time into server search time and provider wait, using the API's
 *   Server-Timing header (exposed on same-origin resource timing entries).
 */

export interface SearchTiming {
  totalMs: number;
  /** Server-Timing metrics by name, e.g. { search: 0.2, provider: 640 }. */
  server: Record<string, number>;
}

export function summariseServerTiming(entries: readonly { name: string; duration: number }[]): Record<string, number> {
  return Object.fromEntries(entries.map((entry) => [entry.name, entry.duration]));
}

export function recordSearchTiming(url: string, startTime: number, label: string): SearchTiming {
  const measure = performance.measure('search', { start: startTime, end: performance.now(), detail: { label } });

  const absoluteUrl = new URL(url, location.href).href;
  const resource = (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).findLast(
    (entry) => entry.name === absoluteUrl,
  );
  const server = summariseServerTiming(resource?.serverTiming ?? []);
  // The resource timing buffer is finite (250 entries by default); we've read what we need.
  performance.clearResourceTimings();

  const timing = { totalMs: Math.round(measure.duration), server };
  if (import.meta.env.DEV) {
    const parts = Object.entries(server).map(([name, ms]) => `${name} ${Math.round(ms)}ms`);
    console.debug(`[search] ${label}: ${timing.totalMs}ms total${parts.length ? ` (${parts.join(', ')})` : ''}`);
  }
  return timing;
}
