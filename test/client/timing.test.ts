import { describe, expect, it } from 'vitest';
import { summariseServerTiming } from '../../src/client/lib/timing';

describe('summariseServerTiming', () => {
  it('maps Server-Timing entries by name', () => {
    expect(
      summariseServerTiming([
        { name: 'search', duration: 0.4 },
        { name: 'provider', duration: 640 },
      ]),
    ).toEqual({ search: 0.4, provider: 640 });
  });

  it('returns an empty object when the header is absent', () => {
    expect(summariseServerTiming([])).toEqual({});
  });
});
