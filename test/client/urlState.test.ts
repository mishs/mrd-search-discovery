import { describe, expect, it } from 'vitest';
import { DEFAULT_QUERY, queryFromUrl, urlFromQuery } from '../../src/client/lib/urlState';

describe('queryFromUrl', () => {
  it('returns defaults for an empty URL', () => {
    expect(queryFromUrl('')).toEqual(DEFAULT_QUERY);
  });

  it('reads q, category and sort', () => {
    expect(queryFromUrl('?q=peri+peri&category=pizza&sort=name')).toEqual({
      q: 'peri peri',
      category: 'pizza',
      sort: 'name',
    });
  });

  it('falls back to defaults for unknown category or sort instead of failing', () => {
    expect(queryFromUrl('?category=cars&sort=price')).toEqual(DEFAULT_QUERY);
  });

  it('trims and caps the query text', () => {
    expect(queryFromUrl(`?q=${encodeURIComponent('  sushi  ')}`).q).toBe('sushi');
    expect(queryFromUrl(`?q=${'x'.repeat(150)}`).q).toHaveLength(100);
  });
});

describe('urlFromQuery', () => {
  it('omits defaults so the bare URL means browse-all', () => {
    expect(urlFromQuery(DEFAULT_QUERY)).toBe('');
    expect(urlFromQuery({ q: '', category: null, sort: 'name' })).toBe('?sort=name');
  });

  it('round-trips through queryFromUrl, including characters that need encoding', () => {
    const query = { q: 'crème brûlée & co', category: 'desserts', sort: 'name' } as const;
    expect(queryFromUrl(urlFromQuery(query))).toEqual(query);
  });
});
