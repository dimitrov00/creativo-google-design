import { describe, expect, it } from 'vitest';
import { LoadState } from './load-state.data';

/*
 * The ONE read-state vocabulary (UI residue cleanup §2.1): its four values,
 * SCREAMING_SNAKE (Law 6.2), pinned byte for byte.
 */
describe('LoadState', () => {
  it('names the four read states with SCREAMING values', () => {
    expect(LoadState).toEqual({
      Loading: 'LOADING',
      Ready: 'READY',
      Failed: 'FAILED',
      Empty: 'EMPTY',
    });
  });

  it('holds every value once, each its own upper case', () => {
    const values = Object.values(LoadState);
    expect(new Set(values).size).toBe(values.length);
    for (const value of values) {
      expect(value).toBe(value.toUpperCase());
      expect(value).toMatch(/^[A-Z][A-Z_]*$/);
    }
  });
});
