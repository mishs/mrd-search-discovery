import type { RequestHandler } from 'express';
import type { EnrichmentSummary } from '../shared/contract.js';

/**
 * Lightweight, in-process instrumentation: request counts, latency summaries
 * and provider outcomes, readable at GET /api/metrics.
 *
 * Deliberately small: no histogram library, no exporter. Latency percentiles
 * come from a bounded window of recent samples, so memory stays constant.
 * In production these numbers would go to a metrics backend (Prometheus,
 * CloudWatch, ...) instead of an endpoint.
 */

export interface LatencySummary {
  samples: number;
  avg: number;
  p50: number;
  p95: number;
  max: number;
}

export interface RouteMetrics {
  count: number;
  byStatus: Record<string, number>;
  latencyMs: LatencySummary;
}

export interface MetricsSnapshot {
  startedAt: string;
  uptimeSeconds: number;
  requests: Record<string, RouteMetrics>;
  enrichment: {
    complete: number;
    partial: number;
    unavailable: { timeout: number; provider_error: number };
    skipped: number;
    providerLatencyMs: LatencySummary;
  };
  /** Live-details cache effectiveness: items answered from cache vs fetched. */
  cache: { hits: number; misses: number; hitRate: number };
}

/** Keeps the most recent `capacity` samples. */
class SampleWindow {
  private readonly values: number[] = [];
  constructor(private readonly capacity: number) {}

  add(value: number): void {
    this.values.push(value);
    if (this.values.length > this.capacity) this.values.shift();
  }

  summary(): LatencySummary {
    const sorted = [...this.values].sort((a, b) => a - b);
    const n = sorted.length;
    if (n === 0) return { samples: 0, avg: 0, p50: 0, p95: 0, max: 0 };
    // Nearest-rank percentile: good enough for a dashboard-in-a-curl.
    const at = (p: number) => sorted[Math.min(n - 1, Math.ceil((p / 100) * n) - 1)] ?? 0;
    const round = (v: number) => Math.round(v * 10) / 10;
    return {
      samples: n,
      avg: round(sorted.reduce((sum, v) => sum + v, 0) / n),
      p50: round(at(50)),
      p95: round(at(95)),
      max: round(sorted[n - 1] ?? 0),
    };
  }
}

export interface Metrics {
  recordRequest(route: string, status: number | 'aborted', durationMs: number): void;
  /** `itemCount` is the number of items that needed live details. */
  recordEnrichment(summary: EnrichmentSummary, itemCount: number): void;
  snapshot(): MetricsSnapshot;
  /** Express middleware that times every request it sees. */
  middleware: RequestHandler;
}

export function createMetrics(options: { now?: () => number; windowSize?: number } = {}): Metrics {
  const now = options.now ?? (() => performance.now());
  const windowSize = options.windowSize ?? 500;
  const startedAtWall = new Date();
  const startedAt = now();

  const routes = new Map<string, { count: number; byStatus: Record<string, number>; latency: SampleWindow }>();
  const enrichment = { complete: 0, partial: 0, unavailable: { timeout: 0, provider_error: 0 }, skipped: 0 };
  const providerLatency = new SampleWindow(windowSize);
  const cache = { hits: 0, misses: 0 };

  const metrics: Metrics = {
    recordRequest(route, status, durationMs) {
      let entry = routes.get(route);
      if (!entry) {
        entry = { count: 0, byStatus: {}, latency: new SampleWindow(windowSize) };
        routes.set(route, entry);
      }
      entry.count++;
      const key = String(status);
      entry.byStatus[key] = (entry.byStatus[key] ?? 0) + 1;
      entry.latency.add(durationMs);
    },

    recordEnrichment(summary, itemCount) {
      cache.hits += summary.cacheHits;
      cache.misses += itemCount - summary.cacheHits;
      if (summary.status === 'unavailable') {
        enrichment.unavailable[summary.reason ?? 'provider_error']++;
      } else {
        enrichment[summary.status]++;
      }
      // Only count searches that actually waited on the provider.
      if (summary.status !== 'skipped' && summary.cacheHits < itemCount) providerLatency.add(summary.durationMs);
    },

    snapshot() {
      return {
        startedAt: startedAtWall.toISOString(),
        uptimeSeconds: Math.round((now() - startedAt) / 1000),
        requests: Object.fromEntries(
          [...routes].map(([route, entry]) => [
            route,
            { count: entry.count, byStatus: { ...entry.byStatus }, latencyMs: entry.latency.summary() },
          ]),
        ),
        enrichment: {
          ...enrichment,
          unavailable: { ...enrichment.unavailable },
          providerLatencyMs: providerLatency.summary(),
        },
        cache: {
          ...cache,
          hitRate: cache.hits + cache.misses === 0 ? 0 : Math.round((cache.hits / (cache.hits + cache.misses)) * 100) / 100,
        },
      };
    },

    middleware(req, res, next) {
      const start = now();
      res.on('close', () => {
        // Use the matched route pattern, not the raw URL, so query strings don't explode the key space.
        const route = `${req.method} ${req.route?.path ?? '(unmatched)'}`;
        metrics.recordRequest(route, res.writableFinished ? res.statusCode : 'aborted', now() - start);
      });
      next();
    },
  };

  return metrics;
}
