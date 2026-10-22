/**
 * HTTP contract shared by the Express API and the Svelte client.
 *
 * Types plus two constant lists (categories and sort options) so both sides
 * agree on the allowed values. Types are not validation: the server checks
 * incoming query strings at runtime with zod (src/server/search/query.ts).
 */

export const CATEGORY_SLUGS = [
  'burgers',
  'pizza',
  'sushi',
  'healthy',
  'desserts',
  'groceries',
] as const;
export type CategorySlug = (typeof CATEGORY_SLUGS)[number];

export const SORT_OPTIONS = ['popularity', 'name'] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];

export interface Category {
  slug: CategorySlug;
  label: string;
}

/** Static catalog data: what we know without asking the provider. */
export interface CatalogItem {
  id: string;
  name: string;
  description: string;
  category: CategorySlug;
  restaurant: string;
  tags: string[];
  /** 0–100. Higher is more popular. Ties are expected. */
  popularity: number;
}

export interface DeliveryWindow {
  min: number;
  max: number;
}

/**
 * Live details for one item. Three distinct states:
 * - available:   the provider answered and the item can be ordered.
 * - unavailable: the provider answered and the item cannot be ordered right now.
 * - unknown:     we did not get an answer for this item. This is NOT "out of stock"
 *                and NOT a zero price; the UI must say "we don't know".
 */
export type LiveDetails =
  | {
      status: 'available';
      /** Integer cents (minor units) to avoid floating point money. */
      priceCents: number;
      currency: 'ZAR';
      deliveryMinutes: DeliveryWindow;
    }
  | { status: 'unavailable' }
  | { status: 'unknown'; reason: UnknownReason };

export type UnknownReason = 'timeout' | 'provider_error' | 'not_returned';

export interface SearchResultItem extends CatalogItem {
  live: LiveDetails;
}

/**
 * - complete:    live details for every item (from the provider and/or the cache).
 * - partial:     some items have live details, some are `unknown` (provider omitted
 *                them, or it failed but other items were answered from the cache).
 * - unavailable: no item has live details; every item is `unknown`.
 * - skipped:     no matching items, so the provider was not called.
 */
export type EnrichmentStatus = 'complete' | 'partial' | 'unavailable' | 'skipped';

export interface EnrichmentSummary {
  status: EnrichmentStatus;
  /** Why the provider gave no answer; present when it failed or timed out. */
  reason?: 'timeout' | 'provider_error';
  /** Time spent waiting for the provider, in milliseconds (0 if it wasn't called). */
  durationMs: number;
  /** How many items were answered from the short-lived live-details cache. */
  cacheHits: number;
}

export interface SearchQuery {
  q: string;
  category: CategorySlug | null;
  sort: SortOption;
}

export interface SearchResponse {
  query: SearchQuery;
  total: number;
  items: SearchResultItem[];
  enrichment: EnrichmentSummary;
}

export type SuggestionKind = 'item' | 'restaurant' | 'category';

/** A typeahead suggestion. Searching for `label` is guaranteed to return results. */
export interface Suggestion {
  label: string;
  kind: SuggestionKind;
}

export interface SuggestionsResponse {
  q: string;
  suggestions: Suggestion[];
}

export interface CategoriesResponse {
  categories: Category[];
}

export interface ApiErrorBody {
  error: {
    code: 'INVALID_QUERY' | 'NOT_FOUND' | 'INTERNAL_ERROR';
    message: string;
    details?: { field: string; message: string }[];
  };
}
