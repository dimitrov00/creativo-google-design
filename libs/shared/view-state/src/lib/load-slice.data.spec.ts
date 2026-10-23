import { describe, expect, it } from 'vitest';
import { LoadSlice } from './load-slice.data';
import { LoadState } from './load-state.data';

/*
 * One read as a page draws it (UI residue cleanup §2.1): each constructor
 * answers its own `loadState`, a READY slice carries the very data it was
 * handed, and `dataOf` reads the data of a READY slice only.
 */
describe('LoadSlice', () => {
  it('answers each fixed slice with its own loadState and nothing else', () => {
    expect(LoadSlice.loading).toEqual({ loadState: LoadState.Loading });
    expect(LoadSlice.failed).toEqual({ loadState: LoadState.Failed });
    expect(LoadSlice.empty).toEqual({ loadState: LoadState.Empty });
  });

  it('wraps the data of a READY slice as it is', () => {
    const data = { name: 'Иван' };
    const slice = LoadSlice.ready(data);
    expect(slice.loadState).toBe(LoadState.Ready);
    expect(slice.data).toBe(data);
    expect(Object.keys(slice).sort()).toEqual(['data', 'loadState']);
  });

  it('builds a new READY slice per call, sharing no state', () => {
    const once = LoadSlice.ready(1);
    const twice = LoadSlice.ready(1);
    expect(twice).toEqual(once);
    expect(twice).not.toBe(once);
  });

  it('reads the data of a READY slice, and null for every other state', () => {
    const data = ['a', 'b'];
    expect(LoadSlice.dataOf(LoadSlice.ready(data))).toBe(data);
    expect(LoadSlice.dataOf(LoadSlice.loading)).toBeNull();
    expect(LoadSlice.dataOf(LoadSlice.failed)).toBeNull();
    expect(LoadSlice.dataOf(LoadSlice.empty)).toBeNull();
    expect(LoadSlice.dataOf(null)).toBeNull();
  });

  it('keeps falsy READY data — only the state decides', () => {
    expect(LoadSlice.dataOf(LoadSlice.ready(0))).toBe(0);
    expect(LoadSlice.dataOf(LoadSlice.ready(''))).toBe('');
    expect(LoadSlice.dataOf(LoadSlice.ready<string | null>(null))).toBeNull();
  });

  it('leaves the slice it reads untouched', () => {
    const slice = LoadSlice.ready({ count: 2 });
    const before = JSON.stringify(slice);
    LoadSlice.dataOf(slice);
    expect(JSON.stringify(slice)).toBe(before);
  });
});
