import { describe, expect, it } from 'vitest';
import { LoadState } from './load-state.data';
import { loadStateWords } from './load-state-words';

/*
 * The shared lower-case words (UI residue cleanup UR-3) — what admin
 * rhythm's and the client profile's `data-state` print today, byte for
 * byte, total over the dictionary.
 */
describe('loadStateWords', () => {
  it('words every LoadState as today’s data-state value', () => {
    expect(loadStateWords).toEqual({
      LOADING: 'loading',
      READY: 'ready',
      FAILED: 'failed',
      EMPTY: 'empty',
    });
  });

  it('is total over the dictionary, one word per state', () => {
    expect(Object.keys(loadStateWords).sort()).toEqual(
      Object.values(LoadState).sort(),
    );
    const words = Object.values(loadStateWords);
    expect(new Set(words).size).toBe(words.length);
  });
});
