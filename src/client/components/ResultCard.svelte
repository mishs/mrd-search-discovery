<script lang="ts">
  import type { SearchResultItem } from '../../shared/contract';
  import { formatDelivery, formatPrice } from '../lib/format';

  interface Props {
    item: SearchResultItem;
    categoryName: string;
  }

  let { item, categoryName }: Props = $props();
</script>

<article>
  <p class="meta">{categoryName} · {item.restaurant}</p>
  <h3>{item.name}</h3>
  <p class="description">{item.description}</p>

  <div class="live">
    {#if item.live.status === 'available'}
      <span class="price">{formatPrice(item.live.priceCents)}</span>
      <span class="delivery">Delivery {formatDelivery(item.live.deliveryMinutes)}</span>
    {:else if item.live.status === 'unavailable'}
      <span class="badge">Currently unavailable</span>
    {:else}
      <span class="unknown">Price and delivery time unavailable right now</span>
    {/if}
  </div>
</article>

<style>
  article {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    width: 100%;
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }

  h3 {
    margin: 0;
    font-size: 1.0625rem;
  }

  p {
    margin: 0;
  }

  .meta {
    color: var(--muted);
    font-size: 0.8125rem;
  }

  .description {
    flex: 1;
    font-size: 0.9375rem;
  }

  .live {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.25rem 0.75rem;
    margin-top: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--border);
  }

  .price {
    font-weight: 700;
    font-size: 1.125rem;
  }

  .delivery,
  .unknown {
    color: var(--muted);
    font-size: 0.875rem;
  }

  .badge {
    padding: 0.125rem 0.5rem;
    border-radius: 999px;
    background: var(--badge-bg);
    color: var(--badge-fg);
    font-size: 0.8125rem;
    font-weight: 600;
  }
</style>
