import type { DeliveryWindow } from '../../shared/contract.js';
import { hashString } from './random.js';

/** What the upstream provider reports for one item. */
export interface ProviderItemDetails {
  available: boolean;
  priceCents: number;
  deliveryMinutes: DeliveryWindow;
}

/**
 * The seam between our service and the (simulated) upstream.
 * One batch call per search. Implementations should stop work when `signal` aborts.
 * Ids the provider knows nothing about are simply absent from the result.
 */
export interface LiveDetailsProvider {
  getLiveDetails(ids: readonly string[], signal: AbortSignal): Promise<Map<string, ProviderItemDetails>>;
}

export class ProviderError extends Error {
  override name = 'ProviderError';
}

export interface SimulatedProviderOptions {
  minLatencyMs: number;
  maxLatencyMs: number;
  /** Probability (0–1) that a call fails. */
  failureRate: number;
  /** Injected randomness: Math.random by default, a seeded PRNG for demos, fixed values in tests. */
  random: () => number;
}

/** Resolves after `ms`, or rejects as soon as `signal` aborts. Always clears its timer. */
export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Deterministic per-item "price book": the same item always has the same base price. */
export function baseDetailsFor(id: string): ProviderItemDetails {
  const hash = hashString(id);
  const rands = 29 + (hash % 170); // R29 – R198
  const fastest = 15 + ((hash >>> 8) % 25); // 15 – 39 minutes
  return {
    available: (hash >>> 16) % 9 !== 0, // roughly 1 in 9 items unavailable
    priceCents: rands * 100 + 90, // e.g. R89.90 -> 8990
    deliveryMinutes: { min: fastest, max: fastest + 10 },
  };
}

/**
 * In-process stand-in for an upstream availability/pricing service.
 * Variable latency, occasional failure, and it honours AbortSignal so a
 * timed-out or abandoned request leaves no timer running.
 */
export function createSimulatedProvider(options: SimulatedProviderOptions): LiveDetailsProvider {
  const { minLatencyMs, maxLatencyMs, failureRate, random } = options;

  return {
    async getLiveDetails(ids, signal) {
      const latency = minLatencyMs + Math.round(random() * (maxLatencyMs - minLatencyMs));
      await abortableDelay(latency, signal);

      if (random() < failureRate) {
        throw new ProviderError('Simulated upstream failure (HTTP 503)');
      }

      // Delivery estimates drift a little between calls, like a real service.
      const drift = Math.floor(random() * 6);
      return new Map(
        ids.map((id) => {
          const base = baseDetailsFor(id);
          return [
            id,
            {
              ...base,
              deliveryMinutes: { min: base.deliveryMinutes.min + drift, max: base.deliveryMinutes.max + drift },
            },
          ];
        }),
      );
    },
  };
}
