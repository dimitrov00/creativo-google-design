/**
 * Where one read stands — the field `loadState` (Law 6.2), the ONLY source
 * of these strings. ONE vocabulary for every screen's read state (UI
 * residue cleanup UR-2): the feature-local copies (`CardLoadState`,
 * `RhythmLoadState`, `AppointmentsViewState`) and the `kind`-tagged load
 * unions retire into it. A page whose DOM spells a state in lower case reads
 * a words table over this dictionary (`loadStateWords`, or its own
 * `satisfies Record<LoadState, string>` table), never a bare literal.
 */
export const LoadState = {
  /** No answer yet: the skeleton. */
  Loading: 'LOADING',
  /** The read answered: the content. */
  Ready: 'READY',
  /** The read failed: the heading over «Опитай пак». */
  Failed: 'FAILED',
  /** The read answered with nothing to draw (no slice, no item). */
  Empty: 'EMPTY',
} as const;
export type LoadState = (typeof LoadState)[keyof typeof LoadState];
