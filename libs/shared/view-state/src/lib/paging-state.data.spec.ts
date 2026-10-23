import { describe, expect, it } from 'vitest';
import { PagingState } from './paging-state.data';

/*
 * Where a list's next page stands (UI residue cleanup §2.1): the four
 * values, SCREAMING_SNAKE (Law 6.2), pinned byte for byte.
 */
describe('PagingState', () => {
  it('names the four paging states with SCREAMING values', () => {
    expect(PagingState).toEqual({
      More: 'MORE',
      Loading: 'LOADING',
      Failed: 'FAILED',
      End: 'END',
    });
  });

  it('holds every value once, each its own upper case', () => {
    const values = Object.values(PagingState);
    expect(new Set(values).size).toBe(values.length);
    for (const value of values) {
      expect(value).toMatch(/^[A-Z][A-Z_]*$/);
    }
  });
});
