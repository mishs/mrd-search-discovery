<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { CategorySlug, Suggestion, SuggestionKind } from '../../shared/contract';
  import { fetchSuggestions } from '../lib/api';
  import { createSuggestionLoader } from '../lib/suggestions';

  /**
   * Search box with typeahead, following the WAI-ARIA combobox pattern (list
   * autocomplete): focus stays in the input; Up/Down move the highlighted
   * option (announced via aria-activedescendant); Enter picks it; Escape closes.
   */
  interface Props {
    id: string;
    value: string;
    /** Suggestions are scoped to the selected category, so each one returns results. */
    category: CategorySlug | null;
    onselect: (label: string) => void;
  }

  let { id, value = $bindable(), category, onselect }: Props = $props();

  const listId = $derived(`${id}-suggestions`);
  const kindLabels: Record<SuggestionKind, string> = { item: '', restaurant: 'Restaurant', category: 'Category' };

  let suggestions = $state<Suggestion[]>([]);
  /** The text and category the current suggestions were loaded for. */
  let loadedFor = $state<{ q: string; category: CategorySlug | null } | null>(null);
  let open = $state(false);
  let activeIndex = $state(-1);
  /** A suggestion request is waiting (debounce or network). */
  let pending = $state(false);

  // Options are selectable only while they still match the box and the filter. Any
  // change, typed or programmatic (URL restore, Back/Forward, category select),
  // invalidates them at once, without needing a request.
  const current = $derived(loadedFor !== null && loadedFor.q === value && loadedFor.category === category);
  const expanded = $derived(open && current && suggestions.length > 0);
  const activeId = $derived(expanded && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined);

  const loader = createSuggestionLoader({
    load: (q, scope, signal) => fetchSuggestions(q, scope, signal).then((body) => body.suggestions),
  });

  function close() {
    open = false;
    activeIndex = -1;
  }

  function cancelPending() {
    loader.cancel();
    pending = false;
  }

  // A pending answer for another category is no longer wanted.
  $effect(() => {
    void category;
    cancelPending();
    close();
  });

  // Suggestions are requested only from real typing, never when the value is set
  // programmatically (choosing a suggestion, restoring from the URL).
  function handleInput() {
    const requested = { q: value, category };
    close(); // the old options described different text
    pending = true;
    loader.request(requested.q, requested.category, (result) => {
      pending = false;
      suggestions = result;
      loadedFor = requested;
      activeIndex = -1;
      open = result.length > 0;
    });
  }

  function choose(suggestion: Suggestion) {
    value = suggestion.label;
    close();
    cancelPending();
    onselect(suggestion.label);
  }

  function handleKeydown(event: KeyboardEvent) {
    const count = current ? suggestions.length : 0;
    switch (event.key) {
      case 'ArrowDown':
        if (count === 0) return;
        event.preventDefault();
        open = true;
        activeIndex = (activeIndex + 1) % count;
        break;
      case 'ArrowUp':
        if (!expanded) return;
        event.preventDefault();
        activeIndex = activeIndex <= 0 ? count - 1 : activeIndex - 1;
        break;
      case 'Enter': {
        const active = expanded ? suggestions[activeIndex] : undefined;
        if (active) {
          event.preventDefault(); // pick the suggestion instead of submitting what was typed
          choose(active);
        } else {
          close(); // let the form submit the typed text
          cancelPending();
        }
        break;
      }
      case 'Escape':
        if (expanded || pending) {
          event.preventDefault(); // dismiss the suggestions; don't also clear the field
          close();
          cancelPending();
        }
        break;
    }
  }

  function handleBlur() {
    close();
    cancelPending();
  }

  onDestroy(() => loader.cancel());
</script>

<div class="combobox">
  <input
    {id}
    type="search"
    name="q"
    role="combobox"
    aria-autocomplete="list"
    aria-expanded={expanded}
    aria-controls={listId}
    aria-activedescendant={activeId}
    bind:value
    oninput={handleInput}
    onkeydown={handleKeydown}
    onblur={handleBlur}
    maxlength="100"
    placeholder="e.g. pizza, sushi, Sugar Lab, vegan"
    autocomplete="off"
    enterkeyhint="search"
  />

  <ul id={listId} role="listbox" aria-label="Suggestions" hidden={!expanded}>
    {#each suggestions as suggestion, index (suggestion.kind + suggestion.label)}
      <!-- Keyboard interaction lives on the input (aria-activedescendant pattern); -->
      <!-- mousedown is prevented so clicking an option doesn't blur the input first. -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <li
        id="{listId}-{index}"
        role="option"
        aria-selected={index === activeIndex}
        onmousedown={(event) => event.preventDefault()}
        onclick={() => choose(suggestion)}
      >
        <span>{suggestion.label}</span>
        {#if kindLabels[suggestion.kind]}<span class="kind">{kindLabels[suggestion.kind]}</span>{/if}
      </li>
    {/each}
  </ul>

  <p class="visually-hidden" role="status" aria-live="polite">
    {expanded ? `${suggestions.length} suggestion${suggestions.length === 1 ? '' : 's'}. Use up and down arrows to choose.` : ''}
  </p>
</div>

<style>
  .combobox {
    position: relative;
  }

  ul {
    position: absolute;
    inset-inline: 0;
    top: calc(100% + 0.25rem);
    z-index: 10;
    max-height: 18rem;
    overflow-y: auto;
    margin: 0;
    padding: 0.25rem;
    list-style: none;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    box-shadow: 0 0.5rem 1.5rem rgb(0 0 0 / 0.15);
  }

  li {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 1rem;
    padding: 0.5rem 0.75rem;
    border-radius: calc(var(--radius) - 0.125rem);
    cursor: pointer;
  }

  li:hover,
  li[aria-selected='true'] {
    background: var(--highlight);
  }

  .kind {
    color: var(--muted);
    font-size: 0.8125rem;
  }
</style>
