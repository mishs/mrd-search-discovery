import { z } from 'zod';

const intFromEnv = (fallback: number) => z.coerce.number().int().min(0).default(fallback);

const configSchema = z
  .object({
    PORT: intFromEnv(3000),
    PROVIDER_MIN_LATENCY_MS: intFromEnv(100),
    PROVIDER_MAX_LATENCY_MS: intFromEnv(1100),
    PROVIDER_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0.1),
    PROVIDER_TIMEOUT_MS: intFromEnv(1000),
    PROVIDER_SEED: z.coerce.number().int().optional(),
    /** How long a provider answer may be reused. 0 disables the cache. */
    LIVE_DETAILS_CACHE_TTL_MS: intFromEnv(30_000),
  })
  .refine((c) => c.PROVIDER_MIN_LATENCY_MS <= c.PROVIDER_MAX_LATENCY_MS, {
    message: 'PROVIDER_MIN_LATENCY_MS must be <= PROVIDER_MAX_LATENCY_MS',
  });

export type Config = z.infer<typeof configSchema>;

/** Reads configuration from environment variables; invalid values stop the server at startup. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Treat empty strings as "not set" so `PROVIDER_SEED= npm run dev` behaves as expected.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  return configSchema.parse(cleaned);
}
