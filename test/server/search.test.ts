import { describe, expect, it } from 'vitest';
import type { CatalogItem, SearchQuery } from '../../src/shared/contract.js';
import { catalog } from '../../src/server/catalog/catalog.js';
import { matchesQuery, normalise, searchCatalog } from '../../src/server/search/search.js';

const query = (overrides: Partial<SearchQuery> = {}): SearchQuery => ({
  q: '',
  category: null,
  sort: 'popularity',
  ...overrides,
});

const item = (overrides: Partial<CatalogItem>): CatalogItem => ({
  id: 'x',
  name: 'Item',
  description: '',
  category: 'burgers',
  restaurant: 'Somewhere',
  tags: [],
  popularity: 50,
  ...overrides,
});

const names = (items: CatalogItem[]) => items.map((i) => i.name);

describe('catalog data', () => {
  it('has 30-40 items across several categories', () => {
    expect(catalog.length).toBeGreaterThanOrEqual(30);
    expect(catalog.length).toBeLessThanOrEqual(40);
    expect(new Set(catalog.map((i) => i.category)).size).toBeGreaterThanOrEqual(4);
  });
});

describe('normalise', () => {
  it('lower-cases, strips accents and collapses whitespace', () => {
    expect(normalise('  Crème   BRÛLÉE \t')).toBe('creme brulee');
  });
});

describe('free-text matching', () => {
  it('matches on item name, ignoring case and surrounding/inner whitespace', () => {
    const results = searchCatalog(catalog, query({ q: '  SMASH    burger ' }));
    expect(names(results)).toEqual(['Classic Smash Burger']);
  });

  it('matches on category label (a field other than name)', () => {
    const results = searchCatalog(catalog, query({ q: 'sushi' }));
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.category === 'sushi')).toBe(true);
  });

  it('matches on restaurant name and tags', () => {
    expect(names(searchCatalog(catalog, query({ q: 'forno rosso' })))).toContain('Margherita Pizza');
    expect(matchesQuery(item({ tags: ['vegan'] }), 'VEGAN')).toBe(true);
  });

  it('is accent-insensitive in both directions', () => {
    expect(names(searchCatalog(catalog, query({ q: 'creme brulee' })))).toEqual(['Crème Brûlée']);
    expect(names(searchCatalog(catalog, query({ q: 'jalapeño' })))).toEqual(['Jalapeño Popper Burger']);
  });

  it('requires every word to match (AND, any order)', () => {
    const results = searchCatalog(catalog, query({ q: 'spicy chicken' }));
    expect(names(results).sort()).toEqual(['Crispy Chicken Burger', 'Peri-Peri Chicken Pizza']);
  });

  it('treats an empty or blank query as browse-all', () => {
    expect(searchCatalog(catalog, query({ q: '' }))).toHaveLength(catalog.length);
    expect(searchCatalog(catalog, query({ q: '   ' }))).toHaveLength(catalog.length);
  });

  it('returns an empty list when nothing matches', () => {
    expect(searchCatalog(catalog, query({ q: 'zzzz-not-a-dish' }))).toEqual([]);
  });
});

describe('category filter', () => {
  it('limits results to the chosen category', () => {
    const results = searchCatalog(catalog, query({ category: 'desserts' }));
    expect(results).toHaveLength(6);
    expect(results.every((r) => r.category === 'desserts')).toBe(true);
  });

  it('combines with the text query', () => {
    const results = searchCatalog(catalog, query({ q: 'chocolate', category: 'desserts' }));
    expect(names(results).sort()).toEqual(['Chocolate Brownie', 'Vegan Chocolate Mousse']);
    expect(searchCatalog(catalog, query({ q: 'chocolate', category: 'pizza' }))).toEqual([]);
  });
});

describe('sorting', () => {
  it('sorts by popularity descending, breaking ties by name', () => {
    const results = searchCatalog(catalog, query());
    const pops = results.map((r) => r.popularity);
    expect(pops).toEqual([...pops].sort((a, b) => b - a));
    // Two items share popularity 96: alphabetical tie-break.
    expect(names(results).slice(0, 2)).toEqual(['Classic Smash Burger', 'Pepperoni Pizza']);
  });

  it('gives the same order regardless of input order (stable, deterministic)', () => {
    const items = [
      item({ id: 'c', name: 'Bread', popularity: 87 }),
      item({ id: 'a', name: 'Milk', popularity: 87 }),
      item({ id: 'b', name: 'Bread', popularity: 87 }),
    ];
    const forward = searchCatalog(items, query()).map((i) => i.id);
    const reversed = searchCatalog([...items].reverse(), query()).map((i) => i.id);
    expect(forward).toEqual(['b', 'c', 'a']);
    expect(reversed).toEqual(forward);
  });

  it('sorts by name A-Z', () => {
    const results = names(searchCatalog(catalog, query({ sort: 'name' })));
    expect(results).toEqual([...results].sort((a, b) => a.localeCompare(b, 'en')));
  });

  it('does not mutate the source catalog', () => {
    const before = catalog.map((i) => i.id);
    searchCatalog(catalog, query({ sort: 'name' }));
    expect(catalog.map((i) => i.id)).toEqual(before);
  });
});
