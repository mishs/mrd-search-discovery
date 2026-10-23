import { describe, expect, it } from 'vitest';
import { handler } from '../../netlify/functions/api.js';

/** The shape Netlify passes after rewriting /api/* to the function (path keeps /api/...). */
const event = (path: string, query: Record<string, string> = {}) => ({
  httpMethod: 'GET',
  path,
  headers: { host: 'demo.example' },
  multiValueHeaders: {},
  queryStringParameters: query,
  multiValueQueryStringParameters: Object.fromEntries(Object.entries(query).map(([k, v]) => [k, [v]])),
  body: null,
  isBase64Encoded: false,
});

const invoke = async (path: string, query?: Record<string, string>) =>
  (await handler(event(path, query), {})) as { statusCode: number; body: string };

describe('Netlify function (hosted demo)', () => {
  it('serves the same API routes as the local Express server', async () => {
    expect((await invoke('/api/health')).statusCode).toBe(200);

    const search = await invoke('/api/search', { q: 'pizza' });
    expect(search.statusCode).toBe(200);
    expect((JSON.parse(search.body) as { total: number }).total).toBeGreaterThan(0);
  });

  it('keeps validation and unknown-route errors', async () => {
    expect((await invoke('/api/search', { category: 'nope' })).statusCode).toBe(400);
    expect((await invoke('/api/nope')).statusCode).toBe(404);
  });
});
