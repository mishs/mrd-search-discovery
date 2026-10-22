import type { CatalogItem, SearchQuery } from '../../shared/contract.js';
import { CATEGORY_LABELS } from '../catalog/catalog.js';

/**
 * Pure search, filter and sort over the in-memory catalog.
 * No Express, no I/O: easy to test and to reason about.
 */

/** Lower-case, strip accents (é → e), and collapse whitespace. */
export function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// Normalised text is computed once per catalog item and reused across searches.
const searchableTextCache = new WeakMap<CatalogItem, string>();

/** Fields searched: name, category label, restaurant and tags. */
function searchableText(item: CatalogItem): string {
  let text = searchableTextCache.get(item);
  if (text === undefined) {
    text = normalise([item.name, CATEGORY_LABELS[item.category], item.restaurant, ...item.tags].join(' '));
    searchableTextCache.set(item, text);
  }
  return text;
}

/**
 * Every word in the query must appear somewhere in the searchable text (AND).
 * An empty query matches everything, so an empty search means "browse".
 */
export function matchesQuery(item: CatalogItem, q: string): boolean {
  const terms = normalise(q).split(' ').filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = searchableText(item);
  return terms.every((term) => haystack.includes(term));
}

const byName = (a: CatalogItem, b: CatalogItem): number =>
  a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id);

const comparators: Record<SearchQuery['sort'], (a: CatalogItem, b: CatalogItem) => number> = {
  // Most popular first; ties broken by name, then id, so the order never depends on input order.
  popularity: (a, b) => b.popularity - a.popularity || byName(a, b),
  name: byName,
};

export function searchCatalog(items: readonly CatalogItem[], query: SearchQuery): CatalogItem[] {
  return items
    .filter((item) => query.category === null || item.category === query.category)
    .filter((item) => matchesQuery(item, query.q))
    .sort(comparators[query.sort]);
}
