import { describe, expect, it } from 'vitest';
import { CATEGORY_SLUGS } from '../../src/shared/contract.js';
import { catalog } from '../../src/server/catalog/catalog.js';
import { searchCatalog } from '../../src/server/search/search.js';
import { createSuggestionIndex } from '../../src/server/search/suggest.js';

const index = createSuggestionIndex(catalog);
const labels = (q: string, category: (typeof CATEGORY_SLUGS)[number] | null = null) =>
  index.suggest(q, category).map((s) => s.label);

describe('createSuggestionIndex', () => {
  it('suggests items, restaurants and categories whose words start with the input', () => {
    const suggestions = index.suggest('piz', null);
    expect(suggestions).toContainEqual({ label: 'Pizza', kind: 'category' });
    expect(suggestions).toContainEqual({ label: 'Pepperoni Pizza', kind: 'item' });
    expect(labels('forno')).toEqual(['Forno Rosso']);
  });

  it('matches word starts only, not arbitrary substrings', () => {
    expect(labels('izza')).toEqual([]);
  });

  it('ignores case and accents', () => {
    expect(labels('CREME BR')).toEqual(['Crème Brûlée']);
    expect(labels('jalapen')).toEqual(['Jalapeño Popper Burger']);
  });

  it('requires every typed word to match, in any order', () => {
    expect(labels('pizza pep')).toEqual(['Pepperoni Pizza']);
  });

  it('ranks labels that start with the input first, then by popularity', () => {
    // "Salmon Roses" (90) and "Salmon Poke Bowl" (79) start with "salmon".
    expect(labels('salmon')).toEqual(['Salmon Roses (6)', 'Salmon Poke Bowl']);
    expect(labels('chicken')[0]).toBe('Chicken Caesar Salad');
  });

  it('respects the category filter and omits category suggestions when one is chosen', () => {
    expect(labels('ch', 'desserts')).toEqual(['Chocolate Brownie', 'Vegan Chocolate Mousse']);
    expect(index.suggest('pi', 'pizza').every((s) => s.kind !== 'category')).toBe(true);
  });

  it('caps the number of suggestions and returns nothing for blank input', () => {
    expect(index.suggest('s', null, 5)).toHaveLength(5);
    expect(index.suggest('   ', null)).toEqual([]);
  });

  it('only suggests labels that return results when searched (under the same filter)', () => {
    const prefixes = ['a', 'b', 'c', 'f', 'g', 'm', 'p', 's', 'v', 'ch', 'sa', 'gr'];
    for (const category of [null, ...CATEGORY_SLUGS]) {
      for (const prefix of prefixes) {
        for (const { label } of index.suggest(prefix, category, 20)) {
          const results = searchCatalog(catalog, { q: label, category, sort: 'popularity' });
          expect(results.length, `"${label}" in ${category ?? 'all'}`).toBeGreaterThan(0);
        }
      }
    }
  });
});
