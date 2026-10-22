# Solution notes

## Summary

A one-repository full-stack app. An Express + TypeScript API searches a local catalog and adds live price and availability data from a simulated provider. A Svelte 5 client presents the results and stays usable when that provider is slow or failing. The design aims to stay small and explicit, with clear failure semantics, rather than broad.

## Architecture

```text
┌──────────────── Svelte client (src/client) ────────────────┐
│ SearchForm ──onsearch──▶ App.svelte (view state machine)    │
│                          │  createLatestRequest(): abort +  │
│                          │  "only the latest may write"     │
│                          ▼                                  │
│                    lib/api.ts  fetch('/api/search?…')       │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP (same origin: Vite proxy in dev,
                           │ Express static in production)
┌──────────────── Express API (src/server) ──────────────────┐
│ GET /api/search                                             │
│   1. parseSearchQuery(req.query)   zod → 400 on bad input   │
│   2. searchCatalog(catalog, query) pure filter/match/sort   │
│   3. enrichItems(matches, provider, {timeoutMs, signal})    │
│        ├─ no matches → skip provider                        │
│        ├─ one batch call, raced against a timeout           │
│        └─ failure/timeout → items kept, live = unknown      │
│   4. respond 200 { query, total, items, enrichment }        │
│                                                             │
│ LiveDetailsProvider (interface) ◀── createSimulatedProvider │
│   variable latency · failure rate · seedable · abortable    │
└─────────────────────────────────────────────────────────────┘
```

`src/shared/contract.ts` defines the request and response types used on both sides, so a contract change shows up as a type error in the client.

**Separation of concerns.** Search, validation, provider and enrichment are plain functions with no Express dependency. `createApp(deps)` puts them together and receives the catalog, provider and timeout, so tests inject a deterministic provider and nothing in a test depends on randomness or real time.

## Decision records

### ADR 1: Svelte 5 + Vite client, separate Express API, one repository

- **Context.** The brief requires an Express + TypeScript server and allows Svelte or vanilla JS. The team uses Svelte.
- **Decision.** A Svelte 5 single-page client built by Vite, plus an Express 5 API, in one package. In development Vite proxies `/api` to Express. In production Express serves the built client from `dist/client`. Both give one origin and no CORS.
- **Alternatives.**
  - *SvelteKit:* its server routes would replace the Express server the brief explicitly asks for, and SSR/routing aren't needed for one screen.
  - *Vanilla JS:* fewer dependencies, but manual DOM updates for several UI states is more error-prone and less relevant to the team.
  - *npm workspaces/monorepo:* clearer boundaries, but too much ceremony for this size.
- **Consequences.** One `npm ci`, one set of scripts and one lockfile. Shared types are imported directly. The trade-off is that client and server dependencies share one `package.json`. Svelte 5 runes are used throughout (`$state`, `$derived`, typed `$props`, callback props, event attributes), and `runes: true` is set in `svelte.config.js` so legacy reactivity can't creep in.

### ADR 2: Failure semantics for live details

- **Context.** The provider is slow at times and sometimes fails. Catalog data (names, descriptions) is always available locally.
- **Decision.**
  - A search always returns its catalog matches. Live details are a separate, typed layer: `available | unavailable | unknown(reason)`.
  - `unknown` is never shown as R0 or "out of stock". Provider entries are treated as untrusted, so a malformed price (e.g. `0`) also becomes `unknown`.
  - Provider trouble is a **200 with `enrichment.status: "unavailable"`**, not a 5xx: the response is still useful. 4xx is reserved for invalid input; 5xx for our own bugs.
  - One batch call per search, raced against `PROVIDER_TIMEOUT_MS`. The wait is bounded even if a provider ignores its `AbortSignal`. The signal is still aborted so well-behaved providers stop work, and timers are cleared in `finally`.
  - If the browser disconnects (e.g. a newer search aborted the request), the provider call is aborted and no response is written.
  - No matches → the provider is not called (`skipped`).
- **Alternatives.**
  - *Fail the whole request with 502/504:* simpler, but hides results the customer could still use.
  - *Per-item provider calls:* finer-grained, but N calls per search and harder to bound.
  - *Stream enrichment to the client afterwards (two requests or SSE):* the fastest first paint, but more moving parts and more race cases. It is a reasonable next step if provider latency grows.
- **Consequences.** The client must handle three live states and an enrichment summary. In return the UI can say exactly what it knows. Worst-case search latency is capped at roughly the timeout.

### ADR 3: Timebox and scope

- **Context.** The brief estimates ~4 hours and warns against over-engineering.
- **Decision.** Build the mandatory flow fully and verify it: search, one filter (category), sorting (popularity with a stable tie-break, plus name), enrichment, the five UI states, tests and docs. Search is explicit (on submit). Filter and sort changes search immediately because they are discrete user actions. The only extras are cheap ones that support the core: a `Server-Timing` header, a per-search log line, cached normalised search text, and long-lived caching of fingerprinted assets.
- **Not done, deliberately.**
  - *Typeahead:* needs debouncing, a suggestion endpoint and more race handling.
  - *URL-synced state.*
  - *Response caching:* caching live prices risks showing stale prices, so it needs a clear freshness policy first.
  - *Price sort:* prices are live and sometimes unknown, so ordering would be unstable.
  - *Pagination, a database, auth, a global state library and component tests.*
- **Consequences.** A smaller surface that is fully tested and documented. The items listed are the natural next steps (below).

## Key implementation details

- **Search** (`search/search.ts`): text is normalised with NFD, accents stripped, lower-cased and whitespace collapsed. Every query word must appear in the item's name, category label, restaurant or tags. An empty query browses everything. Sorting uses explicit tie-breakers (name, then id) so the order never depends on input order.
- **Validation** (`search/query.ts`): zod checks the raw query object. Arrays from repeated params, unknown categories or sorts, and over-long `q` all produce a 400 that names the field. Types alone don't validate: `req.query` is `unknown` at runtime.
- **Money**: integer cents end to end. They are converted only for display, with `Intl.NumberFormat('en-ZA', { currency: 'ZAR' })`.
- **Request races** (`client/lib/latest.ts`): `start()` aborts the previous fetch and returns a ticket. Results, errors and state changes are applied only if `ticket.isLatest()`. Aborting alone isn't enough, because a response can already be resolving when `abort()` is called. The view is a single state machine, so there's no `finally { loading = false }` that an old request could run after a new one starts.
- **Stale results**: while a new search loads, the previous results stay visible but faded, `aria-busy`, and labelled "Showing previous results while updating…". After an error they are cleared so they can't be mistaken for current results.
- **Accessibility**: a `role="search"` form with labelled controls, native keyboard behaviour, visible `:focus-visible` outlines, a polite live region announcing result counts and degraded or recovered states, `role="alert"` for failures, 44px touch targets, reduced-motion support and sufficient colour contrast.
- **Effects**: one `onMount` for the initial load and cleanup (aborting in-flight requests on unmount). Everything user-triggered goes through event handlers, and derived values use `$derived`.

## Testing strategy

Tests focus on behaviour at the boundaries where bugs would hurt customers, not on implementation details:

| Area | File | What is covered |
| --- | --- | --- |
| Search/filter/sort | `test/server/search.test.ts` | name, category, restaurant and tag matching; case, whitespace and accents; multi-word AND; empty query; no results; category filter; popularity order with stable tie-break regardless of input order; name sort; no mutation |
| Input validation | `test/server/query.test.ts` | defaults, trimming, valid values, unknown category/sort, repeated params, over-long query, unknown extra params |
| Enrichment | `test/server/enrich.test.ts` | available/unavailable mapping; a single batch call; provider skipped for no matches; failure → unknown (never R0 or out of stock); timeout with a provider that ignores abort; signal aborted and no timers left; partial results; malformed price; caller disconnect aborts the provider |
| Provider | `test/server/provider.test.ts` | latency within range (fake timers), failure roll, stable integer prices, seed repeatability, abortable delay clears its timer |
| HTTP API | `test/server/api.test.ts` | end-to-end through Express with injected providers: happy path, filter + sort, 400s, degraded 200, provider not called for zero matches, categories, JSON 404 |
| Client logic | `test/client/*.test.ts` | late older response cannot overwrite newer; abort on new request; cancel; price formatting |

Randomness and time are always injected (fixed sequences, seeds, fake timers), so no test is flaky. To check that the tests catch real bugs, the sort tie-break and, separately, the timer cleanup were removed during development; each change made the relevant test fail.

### Verification actually performed

Run in a Linux development environment (Node v22.22.0, npm 10.9.4) on 22 Oct 2026. These are automated checks, not a manual review by a person:

| Check | Command / method | Result |
| --- | --- | --- |
| Clean install | fresh `git clone`, then `npm ci` | ✅ 0 vulnerabilities |
| Types | `npm run check` | ✅ 0 errors, 0 warnings |
| Tests | `npm test` | ✅ 7 files, 51 tests passed |
| Build | `npm run build` | ✅ client ≈ 49 kB JS (≈ 19 kB gzip) |
| Built start | `npm start`, then `curl` `/`, `/api/categories`, `/api/search` | ✅ 200s; built client and API served from one origin |
| Dev arrangement | `npm run dev`, then `curl` via the Vite proxy on :5173 | ✅ `/api/*` proxied, index served |
| UI states | scripted headless Chromium (Playwright) against the built app | ✅ desktop and 375px mobile (no horizontal scroll); keyboard-only search; empty; provider failure → degraded banner; retry → recovered; timeout answers in ≈1.4 s; slow search keeps previous results faded and labelled; 6 rapid category changes → 5 aborted, final screen correct; server down → error + retry recovers |
| Server-side cancellation | API log during rapid category changes | ✅ "abandoned: client disconnected, provider call aborted" |
| Second environment | fresh clone in a Linux arm64 VM (Node v22.23.4): `npm ci`, `check`, `test`, `build`, built start + `curl` | ✅ same results (51 tests, 0 type errors, 200s) |

**Not yet verified:** a manual review by a person in a real browser, screen-reader testing (VoiceOver/NVDA), Safari/Firefox, macOS and Windows hosts, and running on Node 24.

## Limitations and next steps

**Limitations:** an in-memory static catalog; sorting but no relevance scoring; no pagination; no component or end-to-end tests committed; the client doesn't validate response shapes at runtime; no rate limiting, security headers or structured logging; live-region announcements don't repeat when the text is identical.

**Next steps, in priority order:**

1. Component tests for the UI states (Vitest + Testing Library) and a short Playwright smoke test in CI.
2. Progressive enrichment: return catalog results immediately and stream live details (SSE or a second request) to improve first paint.
3. URL-synced query, filter and sort (shareable links; back/forward navigation).
4. Typeahead with debouncing, minimum length and the existing latest-request guard.
5. A short-lived provider cache with an explicit staleness budget, so prices are never shown past a freshness window.
6. Production hardening: helmet, rate limiting, structured logs and metrics, and an OpenAPI description of the contract.
