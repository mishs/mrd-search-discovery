<script lang="ts">
  import type { SearchResultItem } from '../../shared/contract';
  import ResultCard from './ResultCard.svelte';

  interface Props {
    items: SearchResultItem[];
    /** True while a newer search is loading: these results are from the previous search. */
    stale: boolean;
    categoryLabel: (slug: string) => string;
  }

  let { items, stale, categoryLabel }: Props = $props();
</script>

<ul aria-busy={stale} class:stale>
  {#each items as item (item.id)}
    <li>
      <ResultCard {item} categoryName={categoryLabel(item.category)} />
    </li>
  {/each}
</ul>

<style>
  ul {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 17rem), 1fr));
    gap: 1rem;
    margin: 0;
    padding: 0;
    list-style: none;
    transition: opacity 150ms ease;
  }

  /* Previous results stay visible while loading, but clearly faded so they aren't mistaken for current ones. */
  .stale {
    opacity: 0.5;
    filter: grayscale(0.6);
  }

  li {
    display: flex;
  }
</style>
