<script lang="ts">
  import { SORT_OPTIONS, type Category, type CategorySlug, type SearchQuery, type SortOption } from '../../shared/contract';

  interface Props {
    categories: Category[];
    categoriesFailed: boolean;
    /** Form values are bindable so the parent can restore them from the URL (links, back/forward). */
    q: string;
    category: CategorySlug | '';
    sort: SortOption;
    onsearch: (query: SearchQuery) => void;
  }

  let {
    categories,
    categoriesFailed,
    q = $bindable(),
    category = $bindable(),
    sort = $bindable(),
    onsearch,
  }: Props = $props();

  const sortLabels: Record<SortOption, string> = {
    popularity: 'Most popular',
    name: 'Name (A–Z)',
  };

  function currentQuery(): SearchQuery {
    return { q: q.trim(), category: category || null, sort };
  }

  function submit(event: SubmitEvent) {
    event.preventDefault();
    onsearch(currentQuery());
  }

  // Changing a filter or sort is an explicit user action, so it searches straight away
  // via an event handler (not an $effect watching the values).
  function refine() {
    onsearch(currentQuery());
  }
</script>

<form role="search" onsubmit={submit}>
  <div class="field query">
    <label for="search-q">Search</label>
    <input
      id="search-q"
      type="search"
      name="q"
      bind:value={q}
      maxlength="100"
      placeholder="e.g. pizza, sushi, Sugar Lab, vegan"
      autocomplete="off"
      enterkeyhint="search"
    />
  </div>

  <div class="field">
    <label for="search-category">Category</label>
    <select id="search-category" name="category" bind:value={category} onchange={refine}>
      <option value="">All categories</option>
      {#each categories as option (option.slug)}
        <option value={option.slug}>{option.label}</option>
      {/each}
    </select>
  </div>

  <div class="field">
    <label for="search-sort">Sort by</label>
    <select id="search-sort" name="sort" bind:value={sort} onchange={refine}>
      {#each SORT_OPTIONS as option (option)}
        <option value={option}>{sortLabels[option]}</option>
      {/each}
    </select>
  </div>

  <button type="submit">Search</button>

  {#if categoriesFailed}
    <p class="hint">Categories couldn't be loaded, so filtering is limited. Search still works.</p>
  {/if}
</form>

<style>
  form {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.75rem;
    align-items: end;
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }

  @media (min-width: 40rem) {
    form {
      grid-template-columns: minmax(12rem, 2fr) minmax(9rem, 1fr) minmax(9rem, 1fr) auto;
    }
  }

  .field {
    display: grid;
    gap: 0.25rem;
  }

  label {
    font-weight: 600;
    font-size: 0.875rem;
  }

  .hint {
    grid-column: 1 / -1;
    margin: 0;
    color: var(--muted);
    font-size: 0.875rem;
  }
</style>
