import type { CatalogItem, CategorySlug, Suggestion, SuggestionKind } from '../../shared/contract.js';
import { CATEGORY_LABELS } from '../catalog/catalog.js';
import { normalise } from './search.js';

/**
 * Typeahead suggestions over item names, restaurants and category labels.
 *
 * Matching: every typed word must be the *start* of a word in the label
 * ("pe pi" → "Pepperoni Pizza"), ignoring case and accents. This is stricter
 * than search's substring match, so any suggestion, once searched, returns
 * results: its label words all appear in the matched items' searchable text.
 *
 * Ranking: label starts with the query → first word matches → anywhere;
 * then by popularity; then alphabetically. No fuzzy matching (see SOLUTION.md).
 *
 * The index is built once from the catalog and reused for every request.
 */

interface Candidate {
  label: string;
  kind: SuggestionKind;
  normalisedLabel: string;
  words: string[];
  popularity: number;
  /** Categories this suggestion can return results in (for the category filter). */
  categories: Set<CategorySlug>;
}

const KIND_ORDER: Record<SuggestionKind, number> = { item: 0, restaurant: 1, category: 2 };

const wordsOf = (text: string): string[] => normalise(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

export interface SuggestionIndex {
  suggest(q: string, category: CategorySlug | null, limit?: number): Suggestion[];
}

export function createSuggestionIndex(catalog: readonly CatalogItem[]): SuggestionIndex {
  const candidates = new Map<string, Candidate>();

  const add = (label: string, kind: SuggestionKind, popularity: number, category: CategorySlug) => {
    const key = `${kind}:${normalise(label)}`;
    const existing = candidates.get(key);
    if (existing) {
      existing.popularity = Math.max(existing.popularity, popularity);
      existing.categories.add(category);
      return;
    }
    candidates.set(key, {
      label,
      kind,
      normalisedLabel: normalise(label),
      words: wordsOf(label),
      popularity,
      categories: new Set([category]),
    });
  };

  for (const item of catalog) {
    add(item.name, 'item', item.popularity, item.category);
    add(item.restaurant, 'restaurant', item.popularity, item.category);
    add(CATEGORY_LABELS[item.category], 'category', item.popularity, item.category);
  }
  const all = [...candidates.values()];

  return {
    suggest(q, category, limit = 8) {
      const query = normalise(q);
      const terms = wordsOf(q);
      if (terms.length === 0) return [];

      const scored: { candidate: Candidate; rank: number }[] = [];
      for (const candidate of all) {
        if (category !== null && !candidate.categories.has(category)) continue;
        if (category !== null && candidate.kind === 'category') continue; // already filtered to it
        const matches = terms.every((term) => candidate.words.some((word) => word.startsWith(term)));
        if (!matches) continue;
        const rank = candidate.normalisedLabel.startsWith(query)
          ? 0
          : candidate.words[0]?.startsWith(terms[0] ?? '')
            ? 1
            : 2;
        scored.push({ candidate, rank });
      }

      return scored
        .sort(
          (a, b) =>
            a.rank - b.rank ||
            b.candidate.popularity - a.candidate.popularity ||
            KIND_ORDER[a.candidate.kind] - KIND_ORDER[b.candidate.kind] ||
            a.candidate.label.localeCompare(b.candidate.label, 'en'),
        )
        .slice(0, limit)
        .map(({ candidate }) => ({ label: candidate.label, kind: candidate.kind }));
    },
  };
}
