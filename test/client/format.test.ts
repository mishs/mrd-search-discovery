import { describe, expect, it } from 'vitest';
import { formatDelivery, formatPrice } from '../../src/client/lib/format';

describe('formatting', () => {
  it('formats integer cents as rand', () => {
    // ICU versions differ on the en-ZA decimal separator ("R 89,90" in Node, "R 89.90" in Chromium).
    expect(formatPrice(8990)).toMatch(/^R\s?89[.,]90$/);
  });

  it('formats a delivery window', () => {
    expect(formatDelivery({ min: 20, max: 30 })).toBe('20–30 min');
  });
});
