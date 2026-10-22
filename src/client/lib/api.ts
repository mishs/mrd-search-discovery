import type {
  ApiErrorBody,
  CategoriesResponse,
  SearchQuery,
  SearchResponse,
  SuggestionsResponse,
  CategorySlug,
} from '../../shared/contract';

/** An error with a message that is safe and useful to show to the customer. */
export class ApiError extends Error {
  override name = 'ApiError';
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError("We couldn't reach the server. Check your connection and try again.");
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
    if (response.status === 400 && body?.error.details?.length) {
      throw new ApiError(body.error.details.map((d) => d.message).join('. '));
    }
    throw new ApiError('Something went wrong on our side. Please try again.');
  }
  return (await response.json()) as T;
}

export function fetchCategories(signal: AbortSignal): Promise<CategoriesResponse> {
  return getJson<CategoriesResponse>('/api/categories', signal);
}

export function fetchSuggestions(
  q: string,
  category: CategorySlug | null,
  signal: AbortSignal,
): Promise<SuggestionsResponse> {
  const params = new URLSearchParams({ q });
  if (category) params.set('category', category);
  return getJson<SuggestionsResponse>(`/api/suggestions?${params.toString()}`, signal);
}

export function searchUrl(query: SearchQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.category) params.set('category', query.category);
  params.set('sort', query.sort);
  return `/api/search?${params.toString()}`;
}

export function searchItems(query: SearchQuery, signal: AbortSignal): Promise<SearchResponse> {
  return getJson<SearchResponse>(searchUrl(query), signal);
}
