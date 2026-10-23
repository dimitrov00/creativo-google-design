import { LoadState } from './load-state.data';

/**
 * One read as a page draws it — its state, and the data once ready (UI
 * residue cleanup §2.1). A read that may answer with nothing to draw is
 * {@link LoadSlice.WithEmpty}; a plain `LoadSlice<T>` never carries `EMPTY`.
 * Narrow on `loadState` with `===` against a {@link LoadState} member.
 */
export type LoadSlice<T> =
  LoadSlice.Loading | LoadSlice.Failed | LoadSlice.Ready<T>;

export const LoadSlice = {
  /** The read has not answered yet. */
  loading: { loadState: LoadState.Loading } as LoadSlice.Loading,
  /** The read failed. */
  failed: { loadState: LoadState.Failed } as LoadSlice.Failed,
  /** The read answered with nothing to draw. */
  empty: { loadState: LoadState.Empty } as LoadSlice.Empty,
  /** The read answered with `data`. */
  ready<T>(data: T): LoadSlice.Ready<T> {
    return { loadState: LoadState.Ready, data };
  },
  /** The data of a READY slice, else null. */
  dataOf<T>(slice: LoadSlice.WithEmpty<T> | null): T | null {
    return slice?.loadState === LoadState.Ready ? slice.data : null;
  },
} as const;

/** ONE type-only namespace; each variant declared exactly once (Law 1). */
export namespace LoadSlice {
  /** No answer yet. */
  export type Loading = { readonly loadState: typeof LoadState.Loading };
  /** The read failed. */
  export type Failed = { readonly loadState: typeof LoadState.Failed };
  /** The read answered with nothing to draw. */
  export type Empty = { readonly loadState: typeof LoadState.Empty };
  /** The read answered — its data. */
  export type Ready<T> = {
    readonly loadState: typeof LoadState.Ready;
    readonly data: T;
  };
  /** A read that may answer with nothing to draw. */
  export type WithEmpty<T> = LoadSlice<T> | Empty;
}
