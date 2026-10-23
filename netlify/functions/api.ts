import serverless from 'serverless-http';
import { createConfiguredApp } from '../../src/server/bootstrap.js';
import { loadConfig } from '../../src/server/config.js';

/**
 * Hosted demo only: the same Express app as `npm start`, run as a Netlify Function.
 * netlify.toml rewrites /api/* here, so the app sees its usual /api/... paths.
 * The static client is served by Netlify from dist/client, not by Express.
 * Configuration comes from the same environment variables as the local server.
 */
const app = createConfiguredApp(loadConfig(), {
  log: (message) => console.log(`[api] ${message}`),
});

export const handler = serverless(app);
