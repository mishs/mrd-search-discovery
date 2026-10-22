import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against the *built* app (dist/), the same artefact
 * `npm start` serves. Each provider behaviour gets its own server so the
 * scenarios are deterministic and can run in parallel (URLs in e2e/servers.ts). The cache is off so
 * every search exercises the provider.
 */
const server = (port: number, env: Record<string, string>) => ({
  command: 'node dist/server/index.js',
  url: `http://localhost:${port}/api/health`,
  env: { PORT: String(port), LIVE_DETAILS_CACHE_TTL_MS: '0', ...env },
  reuseExistingServer: false,
  timeout: 20_000,
});

// Lets environments with a preinstalled Chromium skip `playwright install`.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    trace: 'retain-on-failure',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    server(4100, { PROVIDER_FAILURE_RATE: '0', PROVIDER_MIN_LATENCY_MS: '0', PROVIDER_MAX_LATENCY_MS: '50' }),
    server(4101, { PROVIDER_FAILURE_RATE: '1', PROVIDER_MIN_LATENCY_MS: '0', PROVIDER_MAX_LATENCY_MS: '0' }),
    server(4102, {
      PROVIDER_FAILURE_RATE: '0',
      PROVIDER_MIN_LATENCY_MS: '300',
      PROVIDER_MAX_LATENCY_MS: '900',
      PROVIDER_TIMEOUT_MS: '2000',
    }),
  ],
});
