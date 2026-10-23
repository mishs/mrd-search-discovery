# Search & Discovery mini-app

A small full-stack slice of a food-delivery search experience. Customers search a local catalog of 36 dishes and grocery items, filter by category and sort the results. Each result is enriched with live availability, price and delivery estimate from a simulated upstream provider that is slow at times and sometimes fails.

- **Server:** Node.js, Express 5, TypeScript (`strict`), zod for runtime validation
- **Client:** Svelte 5 (runes) + Vite 8, TypeScript, plain CSS
- **Tests:** Vitest + Supertest

> **Video walkthrough:** _VIDEO LINK TO BE ADDED BEFORE SUBMISSION_

Design decisions and trade-offs are in [SOLUTION.md](SOLUTION.md). How AI was used is in [docs/ai-usage.md](docs/ai-usage.md).

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
| `npm test` | Runs the unit and API tests once (Vitest) |
| `npm run test:e2e` | Builds, starts three servers with fixed provider behaviour (healthy, failing, slow) and runs the Playwright browser tests. First time: `npx playwright install chromium` |
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

## Live demo (Netlify)

> **Live demo:** _DEMO LINK TO BE ADDED AFTER DEPLOYMENT_

The hosted demo is for trying the app without installing anything. It runs the **same Express app**; only the hosting around it differs. Locally, `npm run dev` and `npm start` work exactly as described above.

```text
browser → Netlify CDN ─┬─ /*      → dist/client (static, built by npm run build)
                       └─ /api/*  → rewrite → Netlify Function "api"
                                              └─ serverless-http → the Express app (createConfiguredApp)
```

- `netlify.toml` sets the build (`npm run build`, publish `dist/client`, Node 24) and rewrites `/api/*` to the function. The browser still sees one origin, so no CORS.
- `netlify/functions/api.ts` wraps the app with [`serverless-http`](https://github.com/dougmoscrop/serverless-http), following [Netlify's Express guide](https://docs.netlify.com/build/frameworks/framework-setup-guides/express/).
- `src/server/bootstrap.ts` builds the app from config. The local server and the function both use it, so the catalog, provider, timeout and cache wiring are identical.
- The provider variables in the next section apply here too. Set them under **Site configuration → Environment variables** in Netlify. With the defaults, about 1 in 10 searches shows the degraded state, which is intended.

**Deploying** (one-off, from the Netlify dashboard): *Add new project (older dashboards: Add new site) → Import an existing project → GitHub*, choose this repository and keep the settings read from `netlify.toml`. The repository can stay private, but the site URL is public. From a terminal, `npx netlify-cli deploy` builds and creates a draft (preview) deploy; `--prod` publishes it.

**Hosting limitations of the demo** (they don't apply to `npm start`):

- **Per-instance memory.** The live-details cache and `/api/metrics` live in each function instance. They reset on a cold start, and two requests can reach different instances, so cache hits and metric counts are not consistent across requests.
- **Cold starts.** The first request after an idle period is slower while an instance starts.
- **No server-side cancellation.** The function response is buffered, so a browser abort does not reach Express and the provider wait is not cut short. It is still bounded by `PROVIDER_TIMEOUT_MS`, and the client's latest-request guard still discards stale responses.
- **No streaming.** Responses are buffered, which matters only for the streamed-enrichment idea in SOLUTION.md.
- **Region.** Netlify's default function region is US East (Ohio), which adds round-trip time from other regions.
- **Public diagnostics.** `/api/metrics` is reachable on the public URL. It holds only counters and latencies.

**Diagnostics on the hosted demo.** Treat `/api/metrics` there as a snapshot of whichever instance answered, not a site-wide total. For per-request evidence that doesn't depend on the instance, use the `Server-Timing` header on each search (DevTools → Network → Timing) and the one-line-per-search log in Netlify's function logs (*Logs → Functions → api*). None of this is monitoring or alerting. A real deployment would export metrics to a shared backend and keep the endpoint internal.
- **Platform limits.** Netlify's synchronous function limits (60 s execution, 6 MB buffered payload) are far above what this app uses. Plan quotas for function invocations apply.

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
| `LIVE_DETAILS_CACHE_TTL_MS` | `30000` | How long a provider answer may be reused (see [Caching](#caching)). `0` disables the cache |

With the defaults, most searches are fully enriched. About 10% hit a provider failure and about 10% exceed the 1 s wait. Invalid values stop the server at startup with a clear error.

Demo recipes (macOS/Linux shells; in PowerShell use `$env:PROVIDER_FAILURE_RATE=1; npm run dev`). Add `LIVE_DETAILS_CACHE_TTL_MS=0` when you want every search to reach the provider, otherwise repeated searches are answered from the cache:

```bash
PROVIDER_FAILURE_RATE=1 npm run dev                                    # always fails → degraded banner
PROVIDER_FAILURE_RATE=0 npm run dev                                    # always succeeds
PROVIDER_MIN_LATENCY_MS=3000 PROVIDER_MAX_LATENCY_MS=3000 npm run dev  # always times out (wait is 1 s)
PROVIDER_MIN_LATENCY_MS=1500 PROVIDER_MAX_LATENCY_MS=1500 PROVIDER_TIMEOUT_MS=4000 npm run dev
                                                                       # slow but succeeds → see stale-results styling
PROVIDER_SEED=42 npm run dev                                           # same sequence every restart
```

## Typeahead

Typing in the search box suggests dishes, groceries, restaurants and categories.

- **Fewer requests:** nothing is requested under 2 characters; one request is sent after a 150 ms pause in typing (not per keystroke); answers are remembered in memory (last 50, per category), so backspacing to an earlier prefix is instant; the browser may also reuse responses for 5 minutes. Older in-flight requests are aborted, and a late answer can never replace a newer one.
- **Keyboard:** ↓/↑ move through suggestions, Enter picks the highlighted one and searches (or submits what you typed if none is highlighted), Esc closes the list. Screen readers hear the number of suggestions and the highlighted option.
- Picking a suggestion runs a normal search for that text, so results and live prices behave exactly as for a typed search. Suggestions never trigger provider calls.

## Shareable URLs

The current search lives in the page URL, so links and the browser's Back/Forward buttons work:

```text
http://localhost:3000/?q=peri+peri&category=pizza&sort=name
```

- Defaults are omitted (`/` means browse everything; `sort=popularity` is never written).
- Unknown `category`/`sort` values in a link are ignored and the URL is rewritten to its canonical form (no error page for a stale link).
- Each search you run adds one history entry; Back restores the previous query, filter and sort into the form and re-runs it. Retrying doesn't add entries.

## Caching

Provider answers are cached on the server for `LIVE_DETAILS_CACHE_TTL_MS` (30 s by default):

- **Freshness:** live details in an API response are never older than the TTL. Entries are checked when looked up, and when a search will wait for the provider, an entry that could expire within that wait (`PROVIDER_TIMEOUT_MS`) is fetched again instead of reused.
- **On screen:** the browser doesn't expire results. A response stays visible until the next search, so a price on screen can be older than the TTL if the page is left open.
- **What is cached:** provider answers that pass validation, both `available` and `unavailable`, per item id. An entry needs a boolean `available`; an available one also needs a positive integer price in cents and a delivery window of whole minutes with `min <= max`.
- **What is never cached:** failures, timeouts and malformed entries (for example `{}` or an infinite delivery time), so an outage isn't remembered after the provider recovers. Malformed entries are shown as "unknown", never as out of stock, and never fail the search.
- **Effect:** a repeated or overlapping search only asks the provider for items it doesn't have fresh answers for, and makes no provider call at all when everything is cached (`enrichment.durationMs` is `0`).
- **Bounded:** at most 1000 entries, oldest evicted first. In-memory and per server instance.
- **Partial results:** if the provider fails while some items were cached, those items keep their live details and the response says `partial` with the failure reason.

`enrichment.cacheHits` in each search response, the `cache` section of `/api/metrics`, and the `cache` entry of the `Server-Timing` header show how well it is working.

The client deliberately does **not** cache search responses: the server owns the freshness rule for live prices.

## Instrumentation: how to view it

| Where | What you see |
| --- | --- |
| **API terminal** | One log line per search: query, result count, enrichment outcome, provider wait. Abandoned (client-aborted) searches are logged too. |
| **`GET /api/metrics`** | Request counts per route and status (including `aborted`), latency avg/p50/p95/max over the last 500 requests per route, how complete answered searches were, cancelled searches, provider-call outcomes (`ok`, `timeout`, `provider_error`, `aborted`) with malformed-entry count and latency, and cache hit rate. Open <http://localhost:3000/api/metrics> in a browser (it pretty-prints JSON), or `curl -s localhost:3000/api/metrics`. In dev the same path works through Vite on :5173. |
| **DevTools → Network → (search request) → Timing** | `Server-Timing` breakdown: `search` (catalog filter/sort), `provider` (time spent waiting for live details) and `cache` (hits out of matches). |
| **DevTools → Performance → Timings** | A `search` measure per completed search, end to end as the user experienced it. |
| **DevTools console** (`npm run dev` only) | `[search] "pizza": 422ms total (search 0ms, provider 414ms)` |

Example log lines:

```text
[api] search q="pizza" category=* sort=popularity results=6 enrichment=complete providerMs=642
[api] search q="" category=sushi sort=popularity abandoned: client disconnected, provider call aborted
```

Example `/api/metrics` (abridged):

```json
{
  "startedAt": "2026-10-22T13:24:40.592Z",
  "uptimeSeconds": 42,
  "requests": {
    "GET /api/search": { "count": 12, "byStatus": { "200": 10, "400": 1, "aborted": 1 },
                         "latencyMs": { "samples": 12, "avg": 480.1, "p50": 412.3, "p95": 1004.2, "max": 1010.9 } }
  },
  "enrichment": { "complete": 8, "partial": 1, "unavailable": 1, "skipped": 1 },
  "cancelledSearches": 1,
  "provider": { "calls": { "ok": 8, "timeout": 1, "provider_error": 1, "aborted": 1 }, "malformedEntries": 0,
                "latencyMs": { "samples": 10, "avg": 512.4, "p50": 498, "p95": 1001.2, "max": 1001.2 } },
  "cache": { "hits": 30, "misses": 66, "hitRate": 0.31 }
}
```

`enrichment` describes what the customer got; `provider` describes what happened to the provider call. They are counted separately because a `partial` response can come from a timeout, a failure or malformed entries, and a search the client abandoned is counted as cancelled rather than as a provider error.

This is in-process diagnostics for development and review, not external monitoring or alerting: numbers live in memory, reset on restart and trigger nothing. The metrics endpoint is unauthenticated because this is a local exercise; in production it would be internal-only or replaced by a metrics backend with alerts.

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
  "enrichment": { "status": "complete", "durationMs": 642, "cacheHits": 0 }
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
| `complete` | Every item has live details (from the provider and/or the cache) | 200 |
| `partial` | Some items have live details and some are `unknown`: the provider omitted them, or it failed (`reason` set) while other items came from the cache | 200 |
| `unavailable` | No item has live details; catalog results are still returned, each `unknown`. `reason` is `timeout` or `provider_error` when the provider failed | 200 |
| `skipped` | No matches, so the provider was not called | 200 |

Other summary fields: `durationMs` (time waiting for the provider; `0` if not called) and `cacheHits` (items answered from the cache).

Degraded example (provider failed):

```json
{
  "query": { "q": "burger", "category": null, "sort": "popularity" },
  "total": 6,
  "items": [{ "id": "itm-001", "name": "Classic Smash Burger", "...": "...", "live": { "status": "unknown", "reason": "provider_error" } }],
  "enrichment": { "status": "unavailable", "reason": "provider_error", "durationMs": 312, "cacheHits": 0 }
}
```

### `GET /api/suggestions`

Typeahead suggestions from the catalog only (no provider call).

| Parameter | Required | Behaviour |
| --- | --- | --- |
| `q` | no | Same rules as search. Every typed word must be the **start** of a word in the suggestion (`pe pi` → "Pepperoni Pizza"); case- and accent-insensitive. Blank → no suggestions. |
| `category` | no | Same values as search; suggestions are limited to that category and category suggestions are omitted. Unknown value → `400`. |

At most 8 suggestions, ranked by where the match starts, then popularity. Searching for any suggested label under the same category always returns results. Responses may be cached by the browser for 5 minutes (`Cache-Control: private, max-age=300`) because the catalog only changes on deploy.

```bash
curl "http://localhost:3000/api/suggestions?q=piz"
```

```json
{
  "q": "piz",
  "suggestions": [
    { "label": "Pizza", "kind": "category" },
    { "label": "Pepperoni Pizza", "kind": "item" },
    { "label": "Margherita Pizza", "kind": "item" }
  ]
}
```

(abridged) `kind` is `item`, `restaurant` or `category`.

### `GET /api/categories`

```json
{ "categories": [{ "slug": "burgers", "label": "Burgers" }, { "slug": "pizza", "label": "Pizza" }] }
```

(abridged; returns all six)

### `GET /api/metrics`

Diagnostics snapshot; see [Instrumentation](#instrumentation-how-to-view-it).

### `GET /api/health`

```json
{ "status": "ok" }
```

## Project layout

```text
src/
  shared/contract.ts          API types shared by server and client
  server/
    index.ts                  reads config, starts listening (local server)
    bootstrap.ts              builds the app from config; shared by the local server and the demo function
    app.ts                    Express app factory (routes, static files, errors)
    metrics.ts                request/provider counters and latency summaries
    config.ts                 environment variables, validated with zod
    catalog/                  catalog.json + startup validation
    search/search.ts          pure search / filter / sort
    search/query.ts           query-string validation (search and suggestions)
    search/suggest.ts         prebuilt prefix index for typeahead
    provider/                 simulated upstream provider + seedable PRNG
    enrichment/enrich.ts      cache lookup, batch call, bounded wait, failure semantics
    enrichment/liveDetailsCache.ts  TTL cache with explicit freshness policy
  client/
    App.svelte                state machine, latest-request guard, page layout
    components/               SearchForm, SearchInput (combobox), ResultsList, ResultCard, EnrichmentNotice
    lib/                      api client, latest-request helper, suggestion loader, URL state, formatting, timing
test/
  server/                     search, suggestions, validation, provider, enrichment, cache, metrics, HTTP API, demo function
  client/                     latest-request guard, suggestion loader, URL state, formatting, timing
e2e/                          Playwright browser tests against the built app
netlify/functions/api.ts      hosted demo: the same app as a Netlify Function (see netlify.toml)
.github/workflows/ci.yml      check · test · build on Node 22 and 24, then e2e
```

## Known limitations

- The catalog is static and in memory; there is no persistence, pagination or relevance ranking (results are sorted, not scored).
- Svelte components have no isolated component tests; UI behaviour is covered by the Playwright end-to-end suite and the unit-tested client logic.
- The client trusts the shape of our own API responses (TypeScript types, no runtime validation on the client).
- No rate limiting, security headers (e.g. helmet) or structured logging; metrics are in-process and reset on restart. These would be needed before production.
- Verified on Node 22 (Linux). Node 24 is the recommended target; run `npm ci && npm run check && npm test && npm run build` on your machine to confirm.
