<script lang="ts">
  import { onMount } from 'svelte';
  import type { Category, SearchQuery, SearchResponse } from '../shared/contract';
  import { ApiError, fetchCategories, isAbortError, searchItems, searchUrl } from './lib/api';
  import { recordSearchTiming } from './lib/timing';
  import { createLatestRequest } from './lib/latest';
  import SearchForm from './components/SearchForm.svelte';
  import ResultsList from './components/ResultsList.svelte';
  import EnrichmentNotice from './components/EnrichmentNotice.svelte';

  /**
   * One explicit state machine instead of separate loading/error/data flags,
   * so impossible combinations (loading + error + fresh data) cannot happen.
   */
  type ViewState =
    | { kind: 'idle' }
    | { kind: 'loading'; query: SearchQuery; previous: SearchResponse | null }
    | { kind: 'success'; data: SearchResponse; recovered: boolean }
    | { kind: 'error'; query: SearchQuery; message: string };

  let view = $state<ViewState>({ kind: 'idle' });
  let categories = $state<Category[]>([]);
  let categoriesFailed = $state(false);

  // Not reactive on purpose: bookkeeping that the template never reads.
  const latest = createLatestRequest();
  let lastResponse: SearchResponse | null = null;

  // A plain function is enough: Svelte tracks the $state it reads when the template calls it.
  function categoryLabel(slug: string): string {
    return categories.find((c) => c.slug === slug)?.label ?? slug;
  }

  /** Visible results: the current ones, or the previous ones (marked stale) while loading. */
  const shown = $derived.by(() => {
    if (view.kind === 'success') return { data: view.data, stale: false };
    if (view.kind === 'loading' && view.previous) return { data: view.previous, stale: true };
    return null;
  });

  /** Text for the polite live region, so screen-reader users hear progress and outcomes. */
  const announcement = $derived.by(() => {
    switch (view.kind) {
      case 'idle':
        return '';
      case 'loading':
        return 'Searching…';
      case 'error':
        return ''; // the error itself is announced via role="alert"
      case 'success': {
        const { total, enrichment } = view.data;
        const count = total === 0 ? 'No results' : `${total} result${total === 1 ? '' : 's'}`;
        if (enrichment.status === 'unavailable') return `${count}. Live prices are unavailable right now.`;
        if (view.recovered) return `${count}. Live prices are back.`;
        return `${count}.`;
      }
    }
  });

  async function runSearch(query: SearchQuery) {
    const ticket = latest.start();
    view = { kind: 'loading', query, previous: lastResponse };
    const startedAt = performance.now();

    try {
      const data = await searchItems(query, ticket.signal);
      if (!ticket.isLatest()) return; // a newer search owns the screen now
      recordSearchTiming(searchUrl(query), startedAt, JSON.stringify(query.q || '(all)'));
      const recovered =
        lastResponse?.enrichment.status === 'unavailable' && data.enrichment.status !== 'unavailable';
      lastResponse = data;
      view = { kind: 'success', data, recovered };
    } catch (error) {
      if (!ticket.isLatest() || isAbortError(error)) return;
      lastResponse = null; // don't show results that no longer match the controls
      view = {
        kind: 'error',
        query,
        message: error instanceof ApiError ? error.message : 'Something went wrong. Please try again.',
      };
    }
    // Deliberately no `finally { loading = false }`: with a state machine there is
    // nothing to reset, and an older request's finally can't clobber a newer one.
  }

  function retry() {
    if (view.kind === 'error') void runSearch(view.query);
    else if (view.kind === 'success') void runSearch(view.data.query);
  }

  // onMount rather than $effect: this is one-off setup, not a reaction to state.
  // An $effect re-runs whenever $state it reads synchronously changes; runSearch reads
  // none today, but that would silently break if it ever did. Cleanup aborts in-flight requests.
  onMount(() => {
    const controller = new AbortController();
    fetchCategories(controller.signal)
      .then((body) => (categories = body.categories))
      .catch((error: unknown) => {
        if (!isAbortError(error)) categoriesFailed = true;
      });

    void runSearch({ q: '', category: null, sort: 'popularity' });

    return () => {
      controller.abort();
      latest.cancel();
    };
  });
</script>

<header>
  <h1>Find something to eat</h1>
  <p>Search dishes, restaurants and groceries. Prices and delivery times are live.</p>
</header>

<main>
  <SearchForm {categories} {categoriesFailed} onsearch={runSearch} />

  <p class="visually-hidden" role="status" aria-live="polite">{announcement}</p>

  <section aria-labelledby="results-heading">
    <h2 id="results-heading" class="visually-hidden">Results</h2>

    {#if view.kind === 'loading' && !view.previous}
      <p class="status">Loading results…</p>
    {:else if view.kind === 'error'}
      <div class="error" role="alert">
        <p><strong>Search failed.</strong> {view.message}</p>
        <button type="button" onclick={retry}>Try again</button>
      </div>
    {/if}

    {#if shown}
      {@const { data, stale } = shown}
      <div class="summary">
        <p>
          {#if data.total === 0}
            No results
          {:else}
            <strong>{data.total}</strong> result{data.total === 1 ? '' : 's'}
          {/if}
          {#if data.query.q}for “{data.query.q}”{/if}
          {#if data.query.category}in {categoryLabel(data.query.category)}{/if}
        </p>
        {#if stale}
          <p class="updating">Showing previous results while updating…</p>
        {/if}
      </div>

      {#if !stale && view.kind === 'success'}
        <EnrichmentNotice enrichment={data.enrichment} recovered={view.recovered} onretry={retry} />
      {/if}

      {#if data.total === 0}
        <p class="empty">Try a different word, check the spelling, or choose “All categories”.</p>
      {:else}
        <ResultsList items={data.items} {stale} {categoryLabel} />
      {/if}
    {/if}
  </section>
</main>

<style>
  header,
  main {
    max-width: 72rem;
    margin-inline: auto;
    padding-inline: 1rem;
  }

  header {
    padding-block: 1.5rem 0.5rem;
  }

  h1 {
    margin: 0;
    font-size: clamp(1.5rem, 4vw, 2rem);
  }

  header p {
    margin: 0.25rem 0 0;
    color: var(--muted);
  }

  .summary {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.5rem 1rem;
    margin-block: 1rem 0.5rem;
  }

  .summary p {
    margin: 0;
  }

  .updating {
    color: var(--muted);
    font-style: italic;
  }

  .status,
  .empty {
    color: var(--muted);
  }

  .error {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    margin-block: 1rem;
    padding: 0.75rem 1rem;
    border: 1px solid var(--danger);
    border-radius: var(--radius);
    background: var(--danger-bg);
  }

  .error p {
    margin: 0;
  }
</style>
