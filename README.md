# Search & Discovery mini-app

A small full-stack slice of a food-delivery search experience. Customers search a local catalog of 36 dishes and grocery items, filter by category and sort the results. Each result is enriched with live availability, price and delivery estimate from a simulated upstream provider that is slow at times and sometimes fails.

- **Server:** Node.js, Express 5, TypeScript (`strict`), zod for runtime validation
- **Client:** Svelte 5 (runes) + Vite 8, TypeScript, plain CSS
- **Tests:** Vitest + Supertest

> **Video walkthrough:** _VIDEO LINK TO BE ADDED BEFORE SUBMISSION_

Design decisions and trade-offs are in [SOLUTION.md](SOLUTION.md).

## Prerequisites

- **Node.js 24 LTS** (recommended; see `.nvmrc`). Node 22.12+ also works (`engines` field).
- npm 10+

```bash
nvm use        # optional, picks up .nvmrc
```

## Commands

| Command | What it does |
| --- | --- |
| `npm ci` | Clean install from the lockfile (exact pinned versions) |
| `npm run dev` | API on <http://localhost:3000> with reload, plus the Vite dev server on <http://localhost:5173>. **Open 5173.** Vite proxies `/api` to Express. |
| `npm run check` | Type-checks the server and tests with `tsc`, and the Svelte client with `svelte-check` (warnings fail the check) |
| `npm test` | Runs the test suite once |
| `npm run build` | Builds the client to `dist/client` and compiles the server to `dist/server` |
| `npm start` | Runs the built server. It serves the API **and** the built client on <http://localhost:3000> |

Typical first run:

```bash
npm ci
npm run check && npm test
npm run dev                # development, open http://localhost:5173
# or
npm run build && npm start # production-style, open http://localhost:3000
```

### How development and production fit together

```text
development                             production (npm run build && npm start)
browser → Vite :5173 ──/api──▶ Express :3000     browser → Express :3000
          (HMR, Svelte)        (tsx watch)                  ├─ /api/*   → JSON API
                                                            └─ /*       → dist/client (static)
```

Both arrangements give the browser a single origin, so CORS is never needed.

## Simulated provider configuration

The provider is an in-process module (`src/server/provider/provider.ts`). Configure it with environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port for the API (and the built client in `npm start`) |
| `PROVIDER_MIN_LATENCY_MS` | `100` | Shortest simulated provider response time |
| `PROVIDER_MAX_LATENCY_MS` | `1100` | Longest simulated provider response time |
| `PROVIDER_FAILURE_RATE` | `0.1` | Probability (0–1) that a provider call fails |
| `PROVIDER_TIMEOUT_MS` | `1000` | How long the API waits for the provider before answering without live details |
| `PROVIDER_SEED` | _(unset)_ | Integer seed for repeatable latency/failure sequences. Unset means `Math.random` |

With the defaults, most searches are fully enriched. About 10% hit a provider failure and about 10% exceed the 1 s wait. Invalid values stop the server at startup with a clear error.

Demo recipes (macOS/Linux shells; in PowerShell use `$env:PROVIDER_FAILURE_RATE=1; npm run dev`):

```bash
PROVIDER_FAILURE_RATE=1 npm run dev                                    # always fails → degraded banner
PROVIDER_FAILURE_RATE=0 npm run dev                                    # always succeeds
PROVIDER_MIN_LATENCY_MS=3000 PROVIDER_MAX_LATENCY_MS=3000 npm run dev  # always times out (wait is 1 s)
PROVIDER_MIN_LATENCY_MS=1500 PROVIDER_MAX_LATENCY_MS=1500 PROVIDER_TIMEOUT_MS=4000 npm run dev
                                                                       # slow but succeeds → see stale-results styling
PROVIDER_SEED=42 npm run dev                                           # same sequence every restart
```

The API logs one line per search, for example:

```text
[api] search q="pizza" category=* sort=popularity results=6 enrichment=complete providerMs=642
[api] search q="" abandoned: client disconnected, provider call aborted
```

Each search response also has a `Server-Timing` header (`search;dur=…, provider;dur=…`). You can see it in the browser's DevTools under Network → Timing.

## API

All responses are JSON. Errors use one shape:

```json
{ "error": { "code": "INVALID_QUERY", "message": "Invalid search parameters", "details": [{ "field": "category", "message": "category must be one of: burgers, pizza, sushi, healthy, desserts, groceries" }] } }
```

### `GET /api/search`

| Parameter | Required | Values | Behaviour |
| --- | --- | --- | --- |
| `q` | no | free text, ≤ 100 chars | Trimmed. Matches **name, category, restaurant and tags**. Matching ignores case, accents and extra spaces. Every word must match (AND), in any order. Missing or blank means "browse everything". |
| `category` | no | `burgers`, `pizza`, `sushi`, `healthy`, `desserts`, `groceries` | Missing or blank means all categories. Unknown value → `400`. |
| `sort` | no | `popularity` (default), `name` | `popularity`: most popular first, ties broken by name then id (deterministic). `name`: A–Z. Unknown value → `400`. |

Repeated parameters (`?q=a&q=b`) → `400`. Unknown extra parameters are ignored.

Example:

```bash
curl "http://localhost:3000/api/search?q=chocolate&category=desserts&sort=popularity"
```

```json
{
  "query": { "q": "chocolate", "category": "desserts", "sort": "popularity" },
  "total": 2,
  "items": [
    {
      "id": "itm-025",
      "name": "Chocolate Brownie",
      "description": "Dense dark chocolate brownie with a fudgy centre.",
      "category": "desserts",
      "restaurant": "Sugar Lab",
      "tags": ["chocolate", "vegetarian"],
      "popularity": 84,
      "live": { "status": "available", "priceCents": 11690, "currency": "ZAR", "deliveryMinutes": { "min": 17, "max": 27 } }
    },
    {
      "id": "itm-029",
      "name": "Vegan Chocolate Mousse",
      "description": "Silky avocado and cocoa mousse.",
      "category": "desserts",
      "restaurant": "Green Fork Kitchen",
      "tags": ["chocolate", "vegan"],
      "popularity": 41,
      "live": { "status": "available", "priceCents": 19890, "currency": "ZAR", "deliveryMinutes": { "min": 16, "max": 26 } }
    }
  ],
  "enrichment": { "status": "complete", "durationMs": 642 }
}
```

`live` is one of:

| `status` | Meaning | Extra fields |
| --- | --- | --- |
| `available` | Provider answered; item can be ordered | `priceCents` (integer cents), `currency: "ZAR"`, `deliveryMinutes: { min, max }` |
| `unavailable` | Provider answered; item cannot be ordered now | — |
| `unknown` | No usable answer for this item. **Not** "out of stock", and **not** a zero price | `reason`: `timeout`, `provider_error` or `not_returned` |

`enrichment.status` summarises the provider call:

| Status | When | HTTP |
| --- | --- | --- |
| `complete` | Provider answered for every item | 200 |
| `partial` | Provider answered but omitted some items (those are `unknown/not_returned`) | 200 |
| `unavailable` | Provider failed or timed out; catalog results are still returned, each `unknown`. `reason` is `timeout` or `provider_error` | 200 |
| `skipped` | No matches, so the provider was not called | 200 |

Degraded example (provider failed):

```json
{
  "query": { "q": "burger", "category": null, "sort": "popularity" },
  "total": 6,
  "items": [{ "id": "itm-001", "name": "Classic Smash Burger", "...": "...", "live": { "status": "unknown", "reason": "provider_error" } }],
  "enrichment": { "status": "unavailable", "reason": "provider_error", "durationMs": 312 }
}
```

### `GET /api/categories`

```json
{ "categories": [{ "slug": "burgers", "label": "Burgers" }, { "slug": "pizza", "label": "Pizza" }] }
```

(abridged; returns all six)

### `GET /api/health`

```json
{ "status": "ok" }
```

## Project layout

```text
src/
  shared/contract.ts          API types shared by server and client
  server/
    index.ts                  reads config, wires the provider, starts listening
    app.ts                    Express app factory (routes, static files, errors)
    config.ts                 environment variables, validated with zod
    catalog/                  catalog.json + startup validation
    search/search.ts          pure search / filter / sort
    search/query.ts           query-string validation
    provider/                 simulated upstream provider + seedable PRNG
    enrichment/enrich.ts      batch call, bounded wait, failure semantics
  client/
    App.svelte                state machine, latest-request guard, page layout
    components/               SearchForm, ResultsList, ResultCard, EnrichmentNotice
    lib/                      api client, latest-request helper, formatting
test/
  server/                     search, query validation, provider, enrichment, HTTP API
  client/                     latest-request helper, formatting
```

## Known limitations

- The catalog is static and in memory; there is no persistence, pagination or relevance ranking (results are sorted, not scored).
- No typeahead, URL-synced state or caching (optional stretch goals, deliberately left out; see SOLUTION.md).
- Svelte components have no automated tests. UI behaviour was checked with a scripted headless browser during development (recorded in SOLUTION.md), not with a committed end-to-end suite.
- The client trusts the shape of our own API responses (TypeScript types, no runtime validation on the client).
- No rate limiting, security headers (e.g. helmet) or structured logging. These would be needed before production.
- Verified on Node 22 (Linux). Node 24 is the recommended target; run `npm ci && npm run check && npm test && npm run build` on your machine to confirm.
