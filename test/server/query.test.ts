import { describe, expect, it } from 'vitest';
import { parseSearchQuery } from '../../src/server/search/query.js';

describe('parseSearchQuery', () => {
  it('applies defaults when nothing is provided', () => {
    expect(parseSearchQuery({})).toEqual({ ok: true, query: { q: '', category: null, sort: 'popularity' } });
  });

  it('trims values and treats blank category/sort as defaults', () => {
    expect(parseSearchQuery({ q: '  pizza ', category: ' ', sort: '' })).toEqual({
      ok: true,
      query: { q: 'pizza', category: null, sort: 'popularity' },
    });
  });

  it('accepts known category and sort values', () => {
    expect(parseSearchQuery({ category: 'sushi', sort: 'name' })).toEqual({
      ok: true,
      query: { q: '', category: 'sushi', sort: 'name' },
    });
  });

  it.each([
    [{ category: 'cars' }, 'category'],
    [{ sort: 'price' }, 'sort'],
    [{ q: ['a', 'b'] }, 'q'],
    [{ category: ['pizza', 'sushi'] }, 'category'],
    [{ q: 'x'.repeat(101) }, 'q'],
  ])('rejects %j with a message for %s', (input, field) => {
    const result = parseSearchQuery(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.details.map((d) => d.field)).toContain(field);
  });

  it('ignores unknown extra parameters', () => {
    expect(parseSearchQuery({ q: 'tea', utm_source: 'mail' }).ok).toBe(true);
  });
});
