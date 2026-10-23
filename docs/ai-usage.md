# How AI was used

This page describes how I used AI while working on this submission: the tools I used, the instructions I gave them, the decisions that shaped the implementation, and how I am checking the result. I want to give you a clear picture of both the assistance I received and the work I remain responsible for.

## Tools and roles

| Tool | Role |
| --- | --- |
| **ChatGPT** | Helped me analyse the brief, compare approaches and draft the kickoff prompt for Claude. I also used it to review the wording of this page. |
| **Claude Code** | My primary implementation assistant. It generated application code, tests and documentation, proposed implementation details and ran automated checks. |
| **Me** | I set the goals, constraints and review gates. I own the decisions, final verification and submission. |

The application code was **AI-written under my direction**. My contribution includes framing the problem, choosing constraints with AI assistance, deciding where to expand the scope, and reviewing the resulting work. I distinguish the checks Claude ran from the checks I complete myself.

Initially aimed to complete implementation within three hours and reserve another hour for my review and video. I later asked Claude to prioritise quality and include the stretch goals. That expanded the scope; the original target should be read as my initial plan, rather than the actual time spent.

## Prompts actually sent

I have included selected prompt excerpts below so you can see how I directed the work. Claude compiled these from our session, and I am checking them against the original messages before finalising this page. Marked private omissions explicitly and kept summaries separate from quoted instructions.

### 1. ChatGPT planning conversation (not reproduced)

I used ChatGPT to break down the assignment, compare it with my experience and draft the kickoff prompt below. We also discussed REST versus GraphQL, whether Fuse.js was justified, and how to handle provider failures and overlapping requests.

### 2. Kickoff prompt to Claude (recorded excerpt)

Drafted with ChatGPT's help and described in my session record as edited by me.

```text
You are my implementation partner for the Mr D Senior Front End Engineer
take-home assessment. Build a small and contextually defensible solution.

TIME BUDGET
Target 180 minutes for implementation, tests, review and documentation.
Reserve the following 60 minutes for my manual review and video
recording and submission. Track actual elapsed time honestly.


WORKING ARRANGEMENT
You are the primary code writer.
ChatGPT is helping with requirements and independent review.
I own decisions and final verification.
Do not coordinate concurrent writers on the same files.

Inspect the current directory, git state, applicable instructions and supplied
assignment before changing anything. Preserve existing user work.
If a source location is missing, ask only for the missing location.
Do not assume paths from another agent's environment exist locally.

AUTHORITATIVE REQUIREMENTS
The supplied assignment PDF is the source of truth.
The recruiter additionally requires:
- public GitHub repository;
- 5–10-minute explainer video;
- disclosure of actual AI prompts and how AI was used;
- ability to discuss code and architecture tradeoffs.

Core application:
- Node.js, Express and strict TypeScript server.
- Svelte client with TypeScript, HTML and CSS.
- Local JSON catalog of roughly 30–40 items across categories.
- Free-text search over name and at least one additional field.
- At least one filter and one sort.
- In-process simulated provider with variable latency and occasional failure.
- Enrichment with availability, price and delivery estimate when available.
- Responsive UI, loading and error states.
- Automated coverage of an important server path.
- Working development/build/start/test scripts.
- README.md and SOLUTION.md.

Do not substitute SvelteKit server routes for the required Express server.

DEFAULT DESIGN
Use Svelte with Vite and a separate Express API within one repository.
Use a currently supported Node LTS compatible with dependencies; record
the actual selected version. Verify current official documentation.
Pin dependencies through the lockfile.

Prefer:
- 36 fictional catalog items;
- category filter;
- popularity descending sort with a stable tie-break;
- explicit search submission;
- one batch enrichment call for matching items;
- a bounded provider wait;
- integer minor-unit prices and ZAR display;
- local component state;
- a simple typed API contract shared between client and server.

Avoid databases, auth, cart/checkout, microservices, generic repositories,
global state libraries and elaborate UI frameworks.
No typeahead, caching or URL sync unless all mandatory work is verified
and time remains.

FIRST CHECKPOINT
Produce a short acceptance matrix, proposed API contract and five main risks.
Proceed with sensible defaults; do not wait for approval on routine choices.
Explain any material departure from this design before implementing it.

IMPLEMENTATION REQUIREMENTS
1. Validate HTTP query input at runtime; strict TypeScript is not validation.
2. Define empty-query behaviour, search matching and invalid-filter semantics.
3. Keep search/filter/sort logic testable independently of Express.
4. Model available, unavailable and unknown live details distinctly.
5. Provider failure must not become zero price or out-of-stock.
6. Return catalog matches with explicit degraded enrichment where appropriate.
7. Skip provider work for empty results.
8. Ensure older success/error/finally handlers cannot overwrite newer state.
9. Use AbortController and a latest-request guard where appropriate.
10. Ensure cleanup and timeouts do not leave uncontrolled background work.
11. Use current idiomatic Svelte:
    - $state for mutable reactive state;
    - $derived for derived values;
    - typed $props;
    - event handlers for user-triggered work;
    - deliberate effects and cleanup only where justified.
12. Use semantic forms, labels, keyboard access, visible focus and useful
    loading/error announcements.
13. Make stale previous results, if retained, visibly distinct from current
    results. Otherwise clear them consistently.
14. Show empty, loading, degraded, failed and recovered states.
15. Provide deterministic local provider configuration for demonstration
    and deterministic injected behaviour in tests.
16. Default provider behaviour must still include variable latency and
    occasional failure.
17. Use a dev proxy and a documented production/local-start arrangement.
    Verify API routes and built client assets work in that arrangement.

TESTS AND VERIFICATION
Prioritise:
- matching across required fields, case and whitespace;
- category filtering and stable sorting;
- invalid input;
- provider failure and timeout semantics;
- no-result handling;
- latest-request behaviour where practical.

Prefer meaningful behaviour tests over implementation snapshots.
Do not use random failures in tests.
Run type checking, tests and build.
Verify documented clean-install and built-start commands.
Check mobile layout, keyboard operation, slow/failing provider and recovery.
Record actual commands and results. Mark unrun checks explicitly.
Never claim browser/manual checks happened if they did not.

GIT AND DELIVERY
Use one short-lived feature branch when appropriate to the existing repo.
Do not fabricate TDD history, reviews, timestamps or human approvals.
Do not publish, change repository visibility, send messages or submit the
assessment automatically. Prepare a reviewable local result first.

PUBLIC DOCUMENTATION
README.md:
- prerequisites and exact install/dev/check/test/build/start commands;
- endpoint parameters and request/response examples;
- provider simulation configuration;
- known limitations;
- video-link placeholder clearly marked until supplied.

SOLUTION.md:
- concise architecture;
- three small decision records with alternatives and consequences:
  Svelte/Vite + Express, failure semantics, and timebox/scope choices;
- testing strategy and actual verification;
- AI assistance summary;
- genuine limitations and sensible next steps.

docs/ai-usage.md:
- exact prompts actually sent, including this kickoff;
- tool used and task;
- assistance produced;
- real accepted/changed/rejected decisions;
- actual verification evidence.

AI PROVENANCE
This kickoff prompt was drafted with ChatGPT assistance.
Record that accurately.
Never generate retrospective prompts and label them as prompts I sent.
You may suggest follow-up prompts in my voice, but label them "suggested,
not yet used" until I actually send them.
Do not describe AI-written code as independently handwritten by me.
Do not claim I reviewed something until I confirm it.
Keep decision rationales concise; do not fabricate a thought process.
Do not publish personal data, credentials, recruiter messages
or the original assignment PDF. Mark any necessary redactions transparently.


INDEPENDENT REVIEW
Once core functionality works, perform a read-only review against:
requirements, JS async behaviour, TypeScript boundaries, API validation,
provider semantics, races, accessibility, CSS, performance, test quality,
Git hygiene and reproducible execution.

Each finding must include severity, file/line, failure scenario, impact,
minimal fix and verification. Distinguish defects from optional improvements.
Fix critical issues within the timebox and rerun affected checks.

FINAL HANDOFF
Provide:
1. completed acceptance checklist with evidence;
2. actual verification results and unrun checks;
3. changed-file summary and commit identifier;
4. actual AI usage summary;
5. limitations and unresolved findings;
6. five concepts I must explain before submitting;
7. video outline and final submission checklist.

Begin by inspecting the supplied assignment and repository.
```

### 3. Session message to Claude (recorded excerpt, private details omitted)

This gave Claude the starting location and planning document. 

```text
I've attached the folder in which we can generate the project codebase folder.

* entry and deciding file for now is [local path redacted]/draft-main-prompt.md
* From there you can generate your plan and how we are going to implement.
```

### 4. Follow-up instructions to Claude after the first handoff (recorded excerpt)

At this point, I asked Claude to include the stretch goals and propose an updated execution plan. I delegated implementation leadership to it while retaining responsibility for reviewing and accepting the result. The attached planning document also contained ChatGPT's advice on REST, Fuse.js, typeahead and caching.

```text
1. Prioritise quality over finishing at in 3 hours
2. Once timely done with the mandatory requirements, treat the "Optional stretch goals ..." in assignment attachment as a requirement rather than optional.
3. In implementation, especially with the history timeline - it should be in a chronological order.
4. See attached 'MR-D-Claude-Code-Consideration-Prompt.md' which is in addition to your feedback, and parallel to it - consider my considerations in response to your feedback and 'Implementation status'; then incorporate what's sensible for an updated plan of execution:

```

### 5. Repository set-up confirmation (summary)

I created the empty repository myself and kept it private while the work was reviewed. The push, PR and merge history is recorded under [How the work reached GitHub](#how-the-work-reached-github).

## What the AI produced

Claude's implementation handoff covered:

- A first checkpoint with an acceptance matrix, a proposed API contract and the main implementation risks.
- The server: a local catalog, startup and query validation, search/filter/sort logic, an in-process provider and bounded enrichment.
- The Svelte client: request-state handling, protection against obsolete responses, components and responsive styling.
- Automated tests, scripted browser checks, README.md and SOLUTION.md.
- Following my scope expansion: instrumentation, provider-detail caching, URL-synced state, typeahead, Playwright tests and GitHub Actions configuration.

Reconciled with the repository (`main` at `bf99fc6`, after the review fixes): 123 unit and API tests in 14 files (`test/server`, `test/client`) and 10 Playwright end-to-end tests (`e2e/`). Before the review fixes (`ccccc48`) the counts were 93 tests in 13 files and 6 end-to-end tests. Those counts come from the final test output and the GitHub Actions runs linked below, not from an intermediate handoff.

## Decisions: accepted, changed, rejected

These are the main choices I asked for or received for review, together with the reasoning behind them. I have kept the source of each choice visible. Where Claude proposed a detail, my acceptance remains pending until I confirm it through review.

| Decision | Status | Why |
| --- | --- | --- |
| Svelte + Vite client, Express API | Included in my AI-assisted kickoff | A small frontend with the Express backend required by the brief. |
| REST; no GraphQL or Fuse.js | ChatGPT advice reflected in the plan; final implementation review pending | Batching does not require GraphQL, and straightforward matching is sufficient for this catalog. |
| Provider failure/timeout → catalog results with unknown live details | Included in my kickoff | Keep discovery useful without presenting a failed lookup as zero price or unavailable stock. |
| Cancellation and a latest-request guard | Included in my kickoff | An older request must not overwrite the results of a newer one. |
| Name A–Z sort alongside popularity | Claude's proposal; my review pending | Gives the sort control a useful alternative at low implementation cost. |
| Immediate filter/sort searches; submitted text search | Claude's proposal; my review pending | Treat discrete control changes explicitly while keeping text entry predictable. |
| Initial load in onMount | Claude's proposal; my review pending | Keep one-off setup separate from reactive updates. |
| Retain previous results while loading and mark them stale | Claude's proposal; my review pending | Preserve context while making the pending update clear. |
| Stretch goals brought into scope | My follow-up instruction | Extend the core experience, accepting the extra implementation and review work. |
| Instrumentation → cache → URL state → typeahead | Claude's proposed execution order | Establish visibility before optimisation and build related features in a useful sequence. |
| Provider-detail cache with a 30-second TTL; failures not cached | Claude's implementation; my review pending | Balance repeated lookups against price freshness. In the code (`src/server/enrichment/liveDetailsCache.ts`): keyed by item id, entries expire after `LIVE_DETAILS_CACHE_TTL_MS` (default 30 000 ms, `0` disables it), at most 1 000 entries with the oldest evicted first, and only real provider answers are stored. Failures, timeouts and malformed entries are never cached. Covered by `test/server/liveDetailsCache.test.ts` and the provider-failure case in `test/server/enrich.test.ts`. The cache is in-process, so it is per instance. |
| Prefix suggestions with request reduction | Claude's implementation; my review pending | Use catalog data for suggestions without fetching live details on every keystroke. |
| Category suggestion performs a text search | Claude's simplification; my review pending | Keep one selection behaviour. With a category filter active, suggestions are limited to that category and category labels are not offered (`src/server/search/suggest.ts`). Tests: "respects the category filter and omits category suggestions when one is chosen" and "only suggests labels that return results when searched (under the same filter)" in `test/server/suggest.test.ts`. |
| Toolchain versions and TypeScript settings | Recorded from the lockfile; my review pending | Node 24 LTS in `.nvmrc` (engines `>=22.12.0`, CI on 22 and 24). Express 5.3.0, TypeScript 6.0.3, zod 4.6.7, Svelte 5.57.2, Vite 8.3.5, Vitest 5.0.5, Supertest 7.3.1, Playwright 1.64.1, tsx 4.23.15, svelte-check 4.7.7. TypeScript runs with `strict`, `noUncheckedIndexedAccess` and `verbatimModuleSyntax` on server and client, plus `noImplicitOverride` on the server. |

I will add concrete changes or rejected suggestions once I have confirmed the relevant review decisions. The guarantee that a suggestion returns results under the active category filter is covered by an automated test; I have not yet confirmed it by hand.

## Independent review and what changed

After the feature PRs were merged, I obtained an independent review of `main` at `ccccc48` and gave its findings to Claude to address. Claude's changes were merged in [PR #10](https://github.com/mishs/mrd-search-discovery/pull/10). The hosted-demo setup is in [PR #9](https://github.com/mishs/mrd-search-discovery/pull/9) and has not been deployed. Each finding below is recorded with what Claude changed; my own review of each change is still pending.

| Finding | What changed | Status |
| --- | --- | --- |
| Malformed provider entries: `{}` treated as out of stock and cached, an infinite delivery time accepted, an entry without a delivery window crashing the search | Each entry is validated before it is converted or cached. Malformed entries show as unknown, are never cached and don't fail the search. Unit and API regressions added | Accepted; my review pending |
| Old typeahead options selectable after the query changed; Escape not cancelling a pending request; old options reopening after a category change | Options are selectable only while they match the current text and category. Escape and category changes cancel pending requests. Three browser regressions with delayed responses | Accepted; my review pending |
| Possible Svelte binding/event ordering problem in `oninput` and `onchange` | Investigated before changing anything. A browser check records the exact request after typing, paste, clear, category and sort changes, and each carried the updated value. Not reproduced on Svelte 5.57.2 in Chromium, so no code change | Not confirmed; my review pending |
| "Live prices are back" shown when nothing proved the provider had recovered | The message appears only when a response proves the provider answered for every item. Unit tests cover unavailable → skipped, cached, partial and successful | Accepted; my review pending |
| Metrics losing the reason for partial failures, and counting client cancellations as provider errors | Provider-call outcomes are counted apart from response completeness, and cancellation is checked first. Regressions for partial timeout, malformed entries and a real client abort | Accepted; my review pending |
| Cached entries could expire while waiting for the provider; results on screen don't expire | Entries that could expire during the wait are fetched again, so a response is never older than the cache TTL (fake-clock test). Results on screen are documented as not expiring | Accepted; my review pending |
| Documentation and hosted demo | README and SOLUTION reconciled with the new behaviour. Netlify setup prepared with its limitations and how to read diagnostics there; nothing deployed | Accepted; my review pending |

Automated results after these changes: `npm run check` clean, 123 unit and API tests in 14 files, and 10 Playwright tests (3 consecutive green local runs) in Chromium. CI passed on the PR head ([run 39875336786](https://github.com/mishs/mrd-search-discovery/actions/runs/39875336786)) and again after the merge to `main` ([run 39879856571](https://github.com/mishs/mrd-search-discovery/actions/runs/39879856571)). Several new regressions were run against the previous code first and failed there. The instrumentation is in-process diagnostics; it is not external monitoring or alerting.

## Verification evidence

Claude's automated-check results are in [SOLUTION.md → Verification actually performed](../SOLUTION.md#verification-actually-performed). Two kinds of evidence are kept apart there:

- **Local checks** run by Claude in a Linux development environment (Node 22): type check, unit/API tests, e2e, build, built start and scripted browser checks.
- **GitHub Actions runs** on GitHub's runners: every PR and every merge to `main` ran type check, tests, build and a smoke test of the built server on Node 22 and 24, plus the Playwright job from PR #6 onwards. All of them passed. The current `main` commit `bf99fc6` passed in [run 39879856571](https://github.com/mishs/mrd-search-discovery/actions/runs/39879856571).

What Claude confirmed itself (automated, not a person's review):

- `npm ci`, `npm run check` (0 errors, 0 warnings), `npm test` (123 tests) and `npm run build` on Node 22 in Linux.
- The built server answered `/` and the API routes with the expected status codes (200, 400 for an invalid category, 404 for an unknown route), and `/api/metrics` showed provider outcomes separately.
- The 10 Playwright tests passed in Chromium three times in a row. The new review regressions failed against the code from before the fixes.
- The suspected Svelte binding-order problem did not reproduce (Svelte 5.57.2, Chromium): each request carried the updated value.
- GitHub Actions passed on Node 22 and 24 plus end-to-end for every PR head and every merge listed below.
- For the hosted demo (PR #9), a local Netlify build packaged the function, and the packaged function answered the API routes correctly. It has not been deployed.

Still to be confirmed by me before submission:

- My manual browser review: search, filter, sort, slow or failing provider responses, recovery, mobile layout and keyboard interaction.
- Running the documented setup and application commands on my own machine.
- My review of the request flow, failure handling, caching, stale-response protection and the tests that cover them.
- The public repository contents and video access. (The CI result for the final `main` commit is recorded above; I still need to check the commit I submit is that one.)

I will update this section with what I actually checked and any remaining limitations. A configured workflow alone is not a completed CI run.

## How the work reached GitHub

I created the repositories and asked Claude to help with delivery. Claude pushed the branches and opened the pull requests. On 22 Oct 2026 the repository was recreated once, because GitHub Actions did not start any runs on the first copy.

The work landed as one PR per feature, in the order it was built. Each was merged only after CI passed on its exact head commit:

| PR | Change | CI on the PR head | Merged (UTC) |
| --- | --- | --- | --- |
| [#1](https://github.com/mishs/mrd-search-discovery/pull/1) | Search & discovery: Express API, simulated provider, Svelte UI | [✅](https://github.com/mishs/mrd-search-discovery/actions/runs/39817756009) | 16:55 |
| [#2](https://github.com/mishs/mrd-search-discovery/pull/2) | Instrumentation | [✅](https://github.com/mishs/mrd-search-discovery/actions/runs/39818798702) | 17:00 |
| [#3](https://github.com/mishs/mrd-search-discovery/pull/3) | Live-details cache | [✅](https://github.com/mishs/mrd-search-discovery/actions/runs/39818950447) | 17:01 |
| [#4](https://github.com/mishs/mrd-search-discovery/pull/4) | URL-synced state | [✅](https://github.com/mishs/mrd-search-discovery/actions/runs/39819102170) | 17:02 |
| [#5](https://github.com/mishs/mrd-search-discovery/pull/5) | Typeahead suggestions | [✅](https://github.com/mishs/mrd-search-discovery/actions/runs/39819269808) | 17:03 |
| [#6](https://github.com/mishs/mrd-search-discovery/pull/6) | End-to-end tests in CI | [✅](https://github.com/mishs/mrd-search-discovery/actions/runs/39819436260) | 17:05 |
| [#7](https://github.com/mishs/mrd-search-discovery/pull/7) | SOLUTION refresh | [✅](https://github.com/mishs/mrd-search-discovery/actions/runs/39819747644) | 17:17 |
| [#8](https://github.com/mishs/mrd-search-discovery/pull/8) | This AI-usage page | [✅](https://github.com/mishs/mrd-search-discovery/actions/runs/39875416022) | 00:09 (23 Oct) |
| [#10](https://github.com/mishs/mrd-search-discovery/pull/10) | Fixes from the independent review | [✅](https://github.com/mishs/mrd-search-discovery/actions/runs/39875336786) | 00:43 (23 Oct) |

PRs #1–#7 were merged on 22 Oct 2026. I merged #8 and #10 myself. The push to `main` after each merge also passed CI. I remain responsible for reviewing the final result before making the submission repository public.

This page records the AI contribution directly. I am keeping the Git account factual.

## Suggested follow-up prompts (suggested, not yet used)

- To ChatGPT, independent review: _"Review this repository as a Staff Engineer interviewer at a food-delivery company. Focus on async correctness (timeouts, aborts, races), API validation and failure semantics, Svelte 5 idioms and accessibility. For each finding give severity, file/line, failure scenario and the minimal fix."_
