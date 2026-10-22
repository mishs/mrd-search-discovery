<script lang="ts">
  import type { EnrichmentSummary } from '../../shared/contract';

  interface Props {
    enrichment: EnrichmentSummary;
    recovered: boolean;
    onretry: () => void;
  }

  let { enrichment, recovered, onretry }: Props = $props();

  const reasonText = $derived(
    enrichment.reason === 'timeout' ? 'The pricing service is responding slowly.' : 'The pricing service had a problem.',
  );
</script>

{#if enrichment.status === 'unavailable'}
  <div class="notice warning">
    <p>
      <strong>Live prices and delivery times are unavailable.</strong>
      {reasonText} You can still browse; try again in a moment.
    </p>
    <button type="button" onclick={onretry}>Retry live prices</button>
  </div>
{:else if enrichment.status === 'partial'}
  <div class="notice warning">
    <p>
      <strong>Some live prices couldn't be loaded.</strong>
      {#if enrichment.reason}{reasonText} The prices shown were fetched recently.{/if}
    </p>
    <button type="button" onclick={onretry}>Retry live prices</button>
  </div>
{:else if recovered}
  <div class="notice success">
    <p>Live prices and delivery times are back.</p>
  </div>
{/if}

<style>
  .notice {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
    margin-block: 0.5rem 1rem;
    padding: 0.75rem 1rem;
    border-radius: var(--radius);
    border: 1px solid;
  }

  .notice p {
    margin: 0;
    flex: 1 1 20rem;
  }

  .warning {
    border-color: var(--warning);
    background: var(--warning-bg);
  }

  .success {
    border-color: var(--success);
    background: var(--success-bg);
  }
</style>
