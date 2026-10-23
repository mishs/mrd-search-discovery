# Solution notes

## Summary

A one-repository full-stack app. An Express + TypeScript API searches a local catalog and adds live price, availability and delivery data from a simulated provider. A Svelte 5 client presents the results and stays usable when that provider is slow or failing.

The core flow was built and verified first. The four optional stretch goals were then added one at a time, in a deliberate order: **instrumentation**, so there is something to measure with; **caching**, whose effect the metrics show; **URL-synced state**; and **typeahead**. A Playwright end-to-end suite and CI on Node 22 and 24 came last.

## Architecture

```text
┌──────────────────────── Svelte client (src/client) ────────────────────────┐
│ SearchForm ─ SearchInput (combobox) ──onsearch──▶ App.svelte                 │
│      │  typeahead: lib/suggestions.ts            view state machine          │
│      │  (pause before requesting, min chars,     createLatestRequest():      │
│      │   remembered answers, latest wins)        abort + only-latest-writes  │
│      ▼                                           URL ⇄ query (lib/urlState)  │
│ GET /api/suggestions                     GET /api/search   timing measures   │
└──────────────┬───────────────────────────────────┬─────────────────────────┘
               │ same origin: Vite proxy in dev, Express static in production
┌──────────────▼───────────────────────────────────▼─────────────────────────┐
│ Express API (src/server)            metrics middleware → GET /api/metrics   │
│                                                                             │
│ /api/suggestions: zod → prebuilt prefix index (catalog only, no provider)   │
│ /api/search:                                                                │
│   1. parseSearchQuery(req.query)          zod → 400 on bad input            │
│   2. searchCatalog(catalog, query)        pure filter / match / sort        │
│   3. enrichItems(matches, provider, …)                                      │
│        ├─ no matches → skip provider                                        │
│        ├─ fresh cached answers reused (LiveDetailsCache, TTL)               │
│        ├─ one batch call for the rest, raced against a deadline             │
│        └─ failure/timeout → affected items live = unknown, never R0         │
│   4. 200 { query, total, items, enrichment } + Server-Timing                │
│                                                                             │
│ LiveDetailsProvider (interface) ◀── createSimulatedProvider                 │
│   variable latency · failure rate · seedable · abortable                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

`src/shared/contract.ts` defines the request and response types used on both sides, so a contract change shows up as a type error in the client.

**Separation of concerns.** Search, suggestions, validation, provider, cache, enrichment and metrics are plain modules with no Express dependency. `createApp(deps)` puts them together and receives the catalog, provider, timeout, cache and metrics. Tests inject deterministic versions, so nothing in a test depends on randomness or real time.

**Why REST, not GraphQL.** The contract is one screen with a fixed response shape. Batching means one in-process call, `provider.getLiveDetails(ids)`, for all matches. GraphQL is an interface choice and wouldn't batch the underlying work by itself. It would add a schema, a server library and client tooling for no benefit here.

## Decision records

### ADR 1: Svelte 5 + Vite client, separate Express API, one repository

- **Context.** The brief requires an Express + TypeScript server and allows Svelte or vanilla JS. The team uses Svelte.
- **Decision.** A Svelte 5 single-page client built by Vite, plus an Express 5 API, in one package. In development Vite proxies `/api` to Express. In production Express serves the built client from `dist/client`. Both give one origin and no CORS.
- **Alternatives.**
  - *SvelteKit:* its server routes would replace the Express server the brief explicitly asks for, and SSR/routing aren't needed for one screen.
  - *Vanilla JS:* fewer dependencies, but manual DOM updates for many UI states, plus a combobox, are more error-prone.
  - *npm workspaces/monorepo:* clearer boundaries, but too much ceremony for this size.
- **Consequences.** One `npm ci`, one set of scripts and one lockfile, with shared types imported directly. The trade-off is that client and server dependencies share one `package.json`. Svelte 5 runes are used throughout: `$state`, `$derived`, typed `$props`, `$bindable` for the form values, callback props and event attributes. `runes: true` is set in `svelte.config.js` so legacy reactivity can't creep in.

### ADR 2: Failure semantics for live details

- **Context.** The provider is slow at times and sometimes fails. Catalog data is always available locally.
- **Decision.**
  - A search always returns its catalog matches. Live details are a separate, typed layer: `available | unavailable | unknown(reason)`.
  - `unknown` is never shown as R0 or "out of stock". Provider entries are treated as untrusted: a malformed price becomes `unknown` and is never cached.
  - Provider trouble is a **200** with an explicit `enrichment.status` (`unavailable`, or `partial` when cached answers covered some items), not a 5xx: the response is still useful. 4xx is for invalid input; 5xx for our own bugs.
  - One batch call per search, raced against `PROVIDER_TIMEOUT_MS`. The wait is bounded even if a provider ignores its `AbortSignal`. The signal is still aborted so well-behaved providers stop, and timers are cleared in `finally`.
  - A browser disconnect (e.g. a newer search aborted the request) aborts the provider call, and no response is written.
  - No matches → no provider call (`skipped`).
- **Alternatives.**
  - *Fail with 502/504:* hides results the customer could still use.
  - *Per-item calls:* N calls per search, harder to bound.
  - *Stream live details after the catalog results (SSE or a second request):* the fastest first paint, but more moving parts and race cases. It's the next step if provider latency grows.
- **Consequences.** The client handles three live states and an enrichment summary, and in return can say exactly what it knows. Worst-case search latency is capped at roughly the timeout.

### ADR 3: Scope and sequencing

- **Context.** The brief estimates ~4 hours and lists four optional stretch goals.
- **Decision.**
  - Build and verify the mandatory flow first: search, category filter, popularity sort with a stable tie-break (plus name A–Z), enrichment, the five UI states, tests and docs.
  - Then add the stretch goals in an order that respects their dependencies: **measure** (instrumentation), then **optimise** (caching, with hit rate visible), then **URL state** (which moved form state up into `App`), then **typeahead** (which reuses the latest-request guard and the lifted form state).
  - Each goal went on its own short-lived branch with docs and tests in the same change.
- **Not done, deliberately.**
  - *Fuzzy matching / Fuse.js:* it provides typo tolerance, not the autocomplete UI, keyboard handling or request lifecycle, and 36 items don't need it. Prefix matching keeps suggestions consistent with search, so every suggestion returns results.
  - *GraphQL:* see Architecture.
  - *Price sort:* prices are live and sometimes unknown, so the order would be unstable during an outage.
  - *Client-side caching of search results:* see ADR 4.
  - *Pagination, a database, auth and a global state library.*
- **Consequences.** Every feature has tests and documentation. The remaining gaps are listed under Limitations.

### ADR 4: Caching and request-reduction policy

- **Context.** "Small caching to improve responsiveness" applies to data with very different freshness needs: live prices can change, while the catalog only changes on deploy.
- **Decision.**
  - **Server-side, live details:** a per-item TTL cache (`LIVE_DETAILS_CACHE_TTL_MS`, default 30 s, `0` disables it).
    - Data in a response is never older than the TTL: when a search will wait for the provider, entries that could expire during that wait are fetched again. Results on screen don't expire; they stay until the next search.
    - Only provider entries that pass validation are cached; failures, timeouts and malformed entries never are, so an outage isn't remembered.
    - Misses are fetched in one batch, and no call is made when everything is cached.
    - At most 1000 entries, oldest evicted first.
  - **Typeahead requests:**
    - nothing under 2 characters;
    - one request per 150 ms pause in typing;
    - an in-memory memo of the last 50 answers (per category);
    - `Cache-Control: private, max-age=300` on suggestions, because they come from the catalog only.
  - **Not cached on the client:** search responses. The server owns the freshness rule for prices; a client cache would bypass it.
- **Alternatives.**
  - *Cache whole search responses by query:* cheap, but couples price freshness to query shape and re-fetches overlapping items.
  - *HTTP caching of `/api/search`:* hands freshness control to the browser for live data.
  - *Redis:* the right step for several instances, but unnecessary for one process.
- **Consequences.** Repeated and overlapping searches get faster and send less load to the provider, with a documented maximum staleness. The cache is per instance; horizontal scaling would need a shared cache or would accept lower hit rates.

## Key implementation details

- **Search** (`search/search.ts`): text is normalised with NFD, accents stripped, lower-cased and whitespace collapsed. Every query word must appear in the name, category label, restaurant or tags. An empty query browses everything. Sorting uses explicit tie-breakers (name, then id), and normalised text is computed once per item.
- **Suggestions** (`search/suggest.ts`): a prefix index built once from the catalog. Every typed word must start a word in the label. That is stricter than search's substring rule, so a suggestion always returns results under the same filter; a property test checks this across categories. Results are ranked by match position, then popularity, and capped at 8.
- **Validation** (`search/query.ts`): shared zod field schemas for `q` and `category`. Arrays from repeated params, unknown values and over-long `q` produce a 400 that names the field. `req.query` is untyped at runtime.
- **Money**: integer cents end to end, formatted only for display with `Intl.NumberFormat('en-ZA', { currency: 'ZAR' })`.
- **Request races**:
  - `client/lib/latest.ts`: `start()` aborts the previous fetch and returns a ticket. State is written only if `ticket.isLatest()`, because abort alone can't stop a response that is already resolving. Both search and typeahead use it.
  - The view is a single state machine, so there's no `finally { loading = false }` that an older request could run after a newer one starts.
- **URL state** (`client/lib/urlState.ts`):
  - On load, the URL is read leniently and rewritten to its canonical form with `replaceState`.
  - Each user search adds one history entry with `pushState`.
  - `<svelte:window onpopstate>` restores the form and re-runs the search without pushing again. Retries never touch history.
- **Provider entries** (`enrichment/enrich.ts`): the provider is a trust boundary. `parseProviderEntry` validates each entry and returns a clean copy before anything converts or caches it. `{}`, a non-boolean `available`, a missing or non-finite delivery window, or a non-integer price becomes `unknown`; never out of stock, never an exception that fails the search.
- **Typeahead UI** (`components/SearchInput.svelte`): the WAI-ARIA combobox pattern with `aria-activedescendant`. Focus stays in the input. ↑/↓ highlight an option, Enter picks it, and Esc closes the list without clearing the text. Option `mousedown` is prevented so a click doesn't blur the input first. Suggestions are requested only from real typing, never from programmatic changes, and the number of suggestions is announced.
  - Options remember the text and category they were loaded for and are selectable only while both still match, so any change (typed, URL restore, Back/Forward, category select) invalidates them at once without a request. Escape and category changes also cancel a pending request, so a late answer can't reopen the list.
- **Recovery message** (`client/lib/recovery.ts`): "Live prices are back" appears only when the provider was last known to be down and a response proves it answered for every item. Searches with no matches or answered entirely from the cache prove nothing, so they neither announce a recovery nor forget the outage.
- **Stale results**: during loading, the previous results stay visible but faded, `aria-busy`, and labelled "Showing previous results while updating…". On error they are cleared.
- **Instrumentation**:
  - `metrics.ts` counts requests per route pattern and status (including client aborts) and records latency avg/p50/p95/max over a bounded window, response completeness, cancelled searches, provider-call outcomes with malformed-entry counts, and cache hit rate. They are served at `/api/metrics`. Cancellation is checked before recording, so an abandoned search is not counted as a provider error.
  - This is in-process diagnostics, not monitoring or alerting.
  - Each search logs one line, and `Server-Timing` reports `search`, `provider` and `cache`.
  - In the browser, each search adds a `search` performance measure; in dev mode, a console line also splits out server and provider time.
- **Effects**: `onMount` (initial search and categories, with abort on unmount) and `onDestroy` (cancel pending suggestions). Nothing user-triggered runs through `$effect`.

## Testing strategy

Behaviour is tested at the boundaries where bugs would hurt customers:

| Area | File | What is covered |
| --- | --- | --- |
| Search/filter/sort | `test/server/search.test.ts` | name, category, restaurant and tag matching; case, whitespace and accents; multi-word AND; empty query; no results; filter; stable tie-break regardless of input order; name sort; no mutation |
| Suggestions | `test/server/suggest.test.ts` | word-prefix matching; accents; multi-word; ranking; category scope; cap; **every suggestion returns results** (property test) |
| Input validation | `test/server/query.test.ts` | defaults, trimming, unknown values, repeated params, over-long query, shared rules for suggestions |
| Enrichment | `test/server/enrich.test.ts` | available/unavailable; one batch call; skip on no matches; failure → unknown (never R0 or out of stock); timeout when the provider ignores abort; no timers left; partial; **untrusted entries:** `{}`, non-boolean `available`, infinite or missing delivery window, fractional price, negative or inverted window, `null`, non-Map response → unknown and never cached, extra fields dropped; provider-call outcome (timeout behind a partial response, aborted); disconnect aborts the provider; **cache:** misses-only fetch, no call when all cached, `unavailable` cached but malformed not, failure keeps cached items (`partial`) and caches nothing, entries that could expire during the wait are re-fetched (fake clock) |
| Cache | `test/server/liveDetailsCache.test.ts` | TTL expiry with an injected clock, refresh on write, eviction, disabled at TTL 0, `minRemainingMs` |
| Metrics | `test/server/metrics.test.ts` | counts by route and status incl. aborted, percentile maths, bounded window, completeness kept apart from provider outcomes, partial timeout and partial failure keep their reason, malformed-entry count, a real client abort recorded as cancelled (not a provider error), cache hit rate, `/api/metrics` through Express |
| Provider | `test/server/provider.test.ts` | latency range (fake timers), failure roll, stable integer prices, seed repeatability, abortable delay |
| HTTP API | `test/server/api.test.ts` | happy path, filter + sort, 400s, degraded 200, malformed provider entries still answer 200 with unknown details, no provider call on zero matches, cache reuse across requests, suggestions endpoint, JSON 404 |
| Client logic | `test/client/*.test.ts` | latest-request guard; recovery message (unavailable → skipped, cached, partial, successful provider call); suggestion loader (one request per pause in typing, min length, memo, per-category keys, abort and late answer ignored, cancel, failure); URL parse/serialise round trip; Server-Timing parsing; price formatting |
| Browser (E2E) | `e2e/search.spec.ts` | built app against three servers (healthy, failing, slow): search/filter with prices, deep link + Back/Forward, keyboard typeahead, failure shows no price, last filter wins under latency, 375 px overflow |
| Typeahead lifecycle (E2E) | `e2e/suggestions-lifecycle.spec.ts` | with delayed suggestion responses: Enter after the query changes searches the typed text, not an old highlighted option; Escape during a pending request keeps the list closed; old options can't be reopened after a category change |
| Binding order (E2E) | `e2e/binding-order.spec.ts` | the exact request sent after typing two characters, paste, clear, category change and sort change, to check that handlers read the updated bound values |

Randomness and time are always injected, so no unit test is flaky; the E2E suite was run repeatedly with consistent results. To check that the tests catch real bugs, these were each broken on purpose during development: the sort tie-break, the enrichment timer cleanup, the "never cache malformed answers" rule and the cache TTL expiry. Each change made a test fail.

### Verification actually performed

Run in a Linux development environment (Node v22.22.0, npm 10.9.4) on 22 Oct 2026. These are automated checks, not a manual review by a person:

| Check | Command / method | Result |
| --- | --- | --- |
| Clean install | fresh `git clone`, `npm ci` | ✅ locally and in every CI run |
| Types | `npm run check` | ✅ 0 errors, 0 warnings |
| Unit + API tests | `npm test` | ✅ 14 files, 123 tests (after the independent-review fixes) |
| E2E | `npm run test:e2e` (Chromium) | ✅ 10 tests, 3 consecutive green runs after the review fixes (6 tests, 4 runs before) |
| Build | `npm run build` | ✅ client ≈ 55 kB JS (≈ 21 kB gzip), 5 kB CSS |
| Built start | `npm start`, `curl` `/`, `/api/*` | ✅ client and API from one origin |
| Dev arrangement | `npm run dev` via the Vite proxy | ✅ `/api/*` proxied; dev timing log visible in console |
| UI states (scripted Chromium) | desktop + 375 px | ✅ keyboard-only search; empty; degraded → retry → recovered; timeout ≈1.4 s; stale results faded and labelled; rapid filter changes (5 of 6 aborted, correct final screen); server down → error → retry |
| Typeahead (scripted Chromium) | | ✅ no request at 1 char; one request for "piz" typed quickly; remembered answer on retype; ↓↓ Enter picks "Pepperoni Pizza" and searches; Esc keeps text; Enter with nothing highlighted submits the typed text; mouse pick; category scoping; mobile layout |
| URL state (scripted Chromium) | | ✅ deep link with invalid category canonicalised without an extra history entry; Back/Back/Forward restore form and results; reload keeps state; title reflects query |
| Server-side cancellation | API log | ✅ "abandoned: client disconnected, provider call aborted" |
| Second environment (core build) | Linux arm64 VM, Node v22.23.4 | ✅ same results for the core commit |
| CI | GitHub Actions on Node 22 and 24 + E2E | ✅ green on every PR head and every merge to `main`; final `main` (`ccccc48`): [run 39821278042](https://github.com/mishs/mrd-search-discovery/actions/runs/39821278042) |

**Not yet verified by a person:** a manual review in a real browser, screen-reader testing (VoiceOver/NVDA), Safari/Firefox, macOS and Windows hosts.

## AI assistance

How AI was used, the prompts behind the work and what I verified are described in [docs/ai-usage.md](docs/ai-usage.md).

## Limitations and next steps

**Limitations:**
- The catalog is static and in memory, sorted but not relevance-scored, with no pagination.
- Metrics and the cache are per process and reset on restart. Concurrent searches that miss the cache for the same items each call the provider (no request coalescing).
- There are no isolated component tests (UI behaviour is covered end to end).
- The hosted Netlify demo runs the same Express app as a function, so its cache and metrics are per instance and reset on cold starts, and a browser abort does not cancel the provider wait server-side. The local server keeps the full behaviour. Details in [README → Live demo](README.md#live-demo-netlify).
- The client doesn't validate response shapes at runtime.
- There is no rate limiting or security headers, and `/api/metrics` is unauthenticated.
- Live-region announcements don't repeat when the text is identical.
- A category suggestion runs a text search rather than setting the category filter.
- Results on screen don't expire. Cache freshness is guaranteed for the API response, not for a page left open.
- Browser checks run in Chromium only.

**Next steps, in priority order:**

1. Progressive enrichment: return catalog results immediately and stream live details (SSE) for a faster first paint.
2. Component tests for `SearchInput` and the result states (Vitest browser mode or Testing Library).
3. Production hardening: helmet, rate limiting, structured logs, metrics exported to a backend, auth on diagnostics, and an OpenAPI description of the contract.
4. Shared cache (Redis) with the same freshness rule if the API runs on several instances.
5. Relevance ranking, combining text-match quality with popularity, if the catalog grows.
