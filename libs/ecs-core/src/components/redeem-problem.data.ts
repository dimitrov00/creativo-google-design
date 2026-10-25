/**
 * Why a reward cannot be redeemed now — the one gate, shared by the redeem
 * callable and the card's lock line (`standing.ts:319-391`). The ONLY
 * source of these strings. A LOCK TAG, not an error (pass D, D-9.2): the
 * card words why a tile is locked from it and nothing is refused by it, so
 * it is no `*ErrorCode` dictionary and stays a component.
 */
export const RedeemProblem = {
  Disabled: 'DISABLED',
  NotYetAvailable: 'NOT_YET_AVAILABLE',
  Ended: 'ENDED',
  SoldOut: 'SOLD_OUT',
  Paused: 'PAUSED',
  InsufficientPoints: 'INSUFFICIENT_POINTS',
  PerClientLimit: 'PER_CLIENT_LIMIT',
} as const;
export type RedeemProblem = (typeof RedeemProblem)[keyof typeof RedeemProblem];
