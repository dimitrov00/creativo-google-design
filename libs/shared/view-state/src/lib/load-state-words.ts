import { LoadState } from './load-state.data';

/*
 * The ONE shared words table of the load state (UI residue cleanup UR-3) —
 * the lower-case word a page's `data-state` prints where it spells a failed
 * read `failed` and an empty one `empty` (admin rhythm, the client profile).
 * A page whose e2e contract spells a state otherwise keeps ONE page table
 * `satisfies Record<LoadState, string>` over the same dictionary — reuse of
 * the dictionary with a per-contract spelling, never a copy of it.
 */

/** Each load state as a page's `data-state` spells it where it says `failed`/`empty`. */
export const loadStateWords = {
  [LoadState.Loading]: 'loading',
  [LoadState.Ready]: 'ready',
  [LoadState.Failed]: 'failed',
  [LoadState.Empty]: 'empty',
} as const satisfies Record<LoadState, string>;
