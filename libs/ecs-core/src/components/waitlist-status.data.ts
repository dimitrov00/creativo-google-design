import { Result } from './result.data';
import { SchedulingError } from './scheduling-errors.data';

/**
 * Where a waitlist request is in its life — the ONLY source of these strings
 * (`waitlist-request.ts:29-44`; index #14 filters on `status.kind`).
 */
export const WaitlistState = {
  /** Watching. The only state a matcher considers. */
  Open: 'open',
  /** Something opened up and the client was told. Still live: told is not booked. */
  Matched: 'matched',
  /** It turned into an appointment. Terminal. */
  Booked: 'booked',
  /** The client withdrew it. Terminal. */
  Cancelled: 'cancelled',
  /** Every day it named is in the past. Terminal. */
  Expired: 'expired',
} as const;
export type WaitlistState = (typeof WaitlistState)[keyof typeof WaitlistState];

/**
 * The legal moves — one source of truth for the graph. `matched → open` is
 * the important odd one: a client who was told and did not act goes back to
 * being watched, rather than dropping off the list for being asleep.
 */
const TRANSITIONS: { readonly [S in WaitlistState]: readonly WaitlistState[] } =
  {
    [WaitlistState.Open]: [
      WaitlistState.Matched,
      WaitlistState.Booked,
      WaitlistState.Cancelled,
      WaitlistState.Expired,
    ],
    [WaitlistState.Matched]: [
      WaitlistState.Open,
      WaitlistState.Booked,
      WaitlistState.Cancelled,
      WaitlistState.Expired,
    ],
    [WaitlistState.Booked]: [],
    [WaitlistState.Cancelled]: [],
    [WaitlistState.Expired]: [],
  };

/**
 * A waitlist request's status with the instant it got there — the stored
 * `waitlistRequests.status` (`{ kind; atMs }`, the declared change from a
 * bare string). One shape for every state.
 */
export type WaitlistStatus = {
  readonly kind: WaitlistState;
  readonly atMs: number;
};

export const WaitlistStatus = {
  /** A new request: watching from `atMs`. */
  open(atMs: number): WaitlistStatus {
    return { kind: WaitlistState.Open, atMs };
  },

  canTransition(from: WaitlistStatus, to: WaitlistState): boolean {
    const next = TRANSITIONS[from.kind];
    for (let i = 0; i < next.length; i++) {
      if (next[i] === to) return true;
    }
    return false;
  },

  /**
   * Move to `to` at `atMs`, or refuse (`scheduling.waitlist.invalid_transition`)
   * a move the graph has no edge for — a terminal state never moves.
   */
  transition(
    from: WaitlistStatus,
    to: WaitlistState,
    atMs: number,
  ): Result<WaitlistStatus, SchedulingError> {
    if (!WaitlistStatus.canTransition(from, to)) {
      return Result.err(
        SchedulingError.waitlistInvalidTransition(from.kind, to),
      );
    }
    return Result.ok({ kind: to, atMs });
  },

  /** Still live for a matcher: open or matched. */
  isWatching(status: WaitlistStatus): boolean {
    return (
      status.kind === WaitlistState.Open ||
      status.kind === WaitlistState.Matched
    );
  },

  isTerminal(status: WaitlistStatus): boolean {
    return TRANSITIONS[status.kind].length === 0;
  },
} as const;
