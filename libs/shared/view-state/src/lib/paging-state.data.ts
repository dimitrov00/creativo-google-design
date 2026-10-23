/**
 * Where a list's next page stands — the field `pagingState` (Law 6.2), the
 * ONLY source of these strings (UI residue cleanup §2.1): the paging feet of
 * the visit lists, the client card's history and its ledger.
 */
export const PagingState = {
  /** Another page can be asked for: the «more» foot. */
  More: 'MORE',
  /** The next page is on its way: the busy foot. */
  Loading: 'LOADING',
  /** The next page failed: the «try again» foot. */
  Failed: 'FAILED',
  /** Every page is in: the end line. */
  End: 'END',
} as const;
export type PagingState = (typeof PagingState)[keyof typeof PagingState];
