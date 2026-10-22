import { CATEGORY_SLUGS, SORT_OPTIONS, type CategorySlug, type SearchQuery, type SortOption } from '../../shared/contract';

/**
 * Two-way mapping between a search and the page URL, so a link restores the
 * same query, filter and sort, and back/forward move between searches.
 *
 * Parsing is lenient on purpose: a hand-edited or stale link with an unknown
 * category or sort falls back to the default rather than showing an error,
 * and the app then rewrites the URL to its canonical form. (The API is strict;
 * the client never sends it values outside the allowed lists.)
 */

export const DEFAULT_QUERY: SearchQuery = { q: '', category: null, sort: 'popularity' };
const MAX_Q_LENGTH = 100;

const isCategory = (value: string | null): value is CategorySlug =>
  value !== null && (CATEGORY_SLUGS as readonly string[]).includes(value);
const isSort = (value: string | null): value is SortOption =>
  value !== null && (SORT_OPTIONS as readonly string[]).includes(value);

export function queryFromUrl(search: string): SearchQuery {
  const params = new URLSearchParams(search);
  const category = params.get('category');
  const sort = params.get('sort');
  return {
    q: (params.get('q') ?? '').trim().slice(0, MAX_Q_LENGTH),
    category: isCategory(category) ? category : null,
    sort: isSort(sort) ? sort : DEFAULT_QUERY.sort,
  };
}

/** Canonical query string: defaults are omitted, so the plain page URL means "browse everything". */
export function urlFromQuery(query: SearchQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.category) params.set('category', query.category);
  if (query.sort !== DEFAULT_QUERY.sort) params.set('sort', query.sort);
  const search = params.toString();
  return search ? `?${search}` : '';
}
