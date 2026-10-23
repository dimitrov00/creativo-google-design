/**
 * Compile-time-only checks of the shared read-state vocabulary (UI residue
 * cleanup §2.1, P0 (2)) — no runtime `expect()`/`it()`; `nx typecheck` runs
 * it through `tsconfig.spec.json`. The helpers are local: this `type:util`
 * lib depends on nothing, so it cannot borrow `@core/testing`'s.
 *
 * 1. `LoadState` and `PagingState` are EXACTLY their dictionaries' values.
 * 2. `LoadSlice.WithEmpty<T>` narrows on `loadState`: READY exposes `data`,
 *    no other state does.
 * 3. `LoadSlice<T>` excludes `EMPTY`; `WithEmpty<T>` adds it.
 * 4. `loadStateWords` is total over `LoadState`.
 */
import { LoadSlice } from './load-slice.data';
import { LoadState } from './load-state.data';
import { loadStateWords } from './load-state-words';
import { PagingState } from './paging-state.data';

type Expect<T extends true> = T;
/** Exact type equality (not mere mutual assignability). */
type Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;

// (1) The dictionaries' values are their types, exactly.
export type DictionariesHold = [
  Expect<Equals<LoadState, 'LOADING' | 'READY' | 'FAILED' | 'EMPTY'>>,
  Expect<Equals<PagingState, 'MORE' | 'LOADING' | 'FAILED' | 'END'>>,
  Expect<Equals<(typeof LoadState)[keyof typeof LoadState], LoadState>>,
  Expect<Equals<(typeof PagingState)[keyof typeof PagingState], PagingState>>,
];

// (3) A plain slice never carries EMPTY; WithEmpty adds exactly EMPTY.
export type SliceStates = [
  Expect<
    Equals<
      LoadSlice<number>['loadState'],
      | typeof LoadState.Loading
      | typeof LoadState.Failed
      | typeof LoadState.Ready
    >
  >,
  Expect<Equals<LoadSlice.WithEmpty<number>['loadState'], LoadState>>,
  Expect<Equals<Extract<LoadSlice<number>, LoadSlice.Empty>, never>>,
  Expect<
    Equals<
      Exclude<LoadSlice.WithEmpty<number>, LoadSlice<number>>,
      LoadSlice.Empty
    >
  >,
];

// (4) The shared words table is keyed by every state.
export type WordsTotal = Expect<Equals<keyof typeof loadStateWords, LoadState>>;

// (2) Narrowing on the discriminator.
declare const slice: LoadSlice.WithEmpty<{ readonly name: string }>;

export function narrowsOnLoadState(): string | null {
  if (slice.loadState === LoadState.Ready) {
    const name: string = slice.data.name;
    return name;
  }
  if (slice.loadState === LoadState.Empty) {
    // @ts-expect-error — an EMPTY slice carries no data
    return slice.data;
  }
  if (slice.loadState === LoadState.Failed) {
    // @ts-expect-error — a FAILED slice carries no data
    return slice.data;
  }
  // @ts-expect-error — a LOADING slice carries no data
  return slice.data;
}

// A plain slice rejects EMPTY at the type level.
// @ts-expect-error — `LoadSlice<T>` has no EMPTY member
export const noEmpty: LoadSlice<number> = LoadSlice.empty;

// The companion's constructors answer their variants.
export const constructors: [
  LoadSlice.Loading,
  LoadSlice.Failed,
  LoadSlice.Empty,
  LoadSlice.Ready<number>,
] = [LoadSlice.loading, LoadSlice.failed, LoadSlice.empty, LoadSlice.ready(1)];
