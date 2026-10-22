import type { CategorySlug, Suggestion } from '../../shared/contract';
import { createLatestRequest } from './latest';

/**
 * Typeahead request policy: keeps suggestion traffic to what is useful.
 *
 * - Waits for a pause in typing (`delayMs`) so one request is sent per burst,
 *   not one per keystroke.
 * - Sends nothing below `minChars`.
 * - Remembers recent answers (small LRU), so backspacing or retyping a prefix
 *   is answered instantly without a request.
 * - Aborts the in-flight request when a newer one starts and ignores late
 *   answers (same latest-request guard as search).
 */

export type LoadSuggestions = (q: string, category: CategorySlug | null, signal: AbortSignal) => Promise<Suggestion[]>;

export interface SuggestionLoaderOptions {
  load: LoadSuggestions;
  delayMs?: number;
  minChars?: number;
  cacheSize?: number;
}

export interface SuggestionLoader {
  /** Ask for suggestions for what the user has typed; `onResult` is called at most once per call, if still latest. */
  request(q: string, category: CategorySlug | null, onResult: (suggestions: Suggestion[]) => void): void;
  /** Drop any pending or in-flight request (input cleared, search submitted, component destroyed). */
  cancel(): void;
}

export function createSuggestionLoader(options: SuggestionLoaderOptions): SuggestionLoader {
  const { load, delayMs = 150, minChars = 2, cacheSize = 50 } = options;
  const latest = createLatestRequest();
  const cache = new Map<string, Suggestion[]>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const remember = (key: string, suggestions: Suggestion[]) => {
    cache.delete(key);
    cache.set(key, suggestions);
    if (cache.size > cacheSize) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  };

  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    latest.cancel();
  };

  return {
    request(q, category, onResult) {
      cancel();
      const text = q.trim().replace(/\s+/g, ' ');
      if (text.length < minChars) {
        onResult([]);
        return;
      }

      const key = `${category ?? '*'}|${text.toLowerCase()}`;
      const cached = cache.get(key);
      if (cached) {
        remember(key, cached); // refresh recency
        onResult(cached);
        return;
      }

      timer = setTimeout(() => {
        timer = undefined;
        const ticket = latest.start();
        load(text, category, ticket.signal).then(
          (suggestions) => {
            remember(key, suggestions);
            if (ticket.isLatest()) onResult(suggestions);
          },
          () => {
            // Suggestions are a nicety: on failure or abort, just show none.
            if (ticket.isLatest()) onResult([]);
          },
        );
      }, delayMs);
    },
    cancel,
  };
}
