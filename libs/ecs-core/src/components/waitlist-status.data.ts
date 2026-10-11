import type { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';
import { Result } from './result.data';
import { SchedulingError } from './scheduling-errors.data';

/**
 * Where a waitlist request is in its life — the ONLY source of these strings,
 * named after the field it types (`waitlistStatus`, N15; index #14 filters on
 * it). SCREAMING since the flatten pass; the stored legacy documents still
 * read `open`/`matched`/… until the booking-flow 3b flip, and the legacy
 * shim maps them.
 */
export const WaitlistStatus = {
  /** Watching. The only state a matcher considers. */
  Open: 'OPEN',
  /** Something opened up and the client was told. Still live: told is not booked. */
  Matched: 'MATCHED',
  /** It turned into an appointment. Terminal. */
  Booked: 'BOOKED',
  /** The client withdrew it. Terminal. */
  Cancelled: 'CANCELLED',
  /** Every day it named is in the past. Terminal. */
  Expired: 'EXPIRED',
} as const;
export type WaitlistStatus =
  (typeof WaitlistStatus)[keyof typeof WaitlistStatus];

/**
 * The legal moves — one source of truth for the graph. `MATCHED → OPEN` is
 * the important odd one: a client who was told and did not act goes back to
 * being watched, rather than dropping off the list for being asleep.
 */
const TRANSITIONS: {
  readonly [S in WaitlistStatus]: readonly WaitlistStatus[];
} = {
  [WaitlistStatus.Open]: [
    WaitlistStatus.Matched,
    WaitlistStatus.Booked,
    WaitlistStatus.Cancelled,
    WaitlistStatus.Expired,
  ],
  [WaitlistStatus.Matched]: [
    WaitlistStatus.Open,
    WaitlistStatus.Booked,
    WaitlistStatus.Cancelled,
    WaitlistStatus.Expired,
  ],
  [WaitlistStatus.Booked]: [],
  [WaitlistStatus.Cancelled]: [],
  [WaitlistStatus.Expired]: [],
};

/**
 * A waitlist request's status with the instant it got there — the flat
 * lifecycle slice `WaitlistRequest` intersects (Law 6: was the nested
 * `status: { kind; atMs }`). One shape for every state: no state carries a
 * field of its own today, so there are no variants to declare.
 */
export type WaitlistLifecycle = {
  readonly waitlistStatus: WaitlistStatus;
  /** When the request entered `waitlistStatus` — a lifecycle stamp. */
  readonly waitlistStatusAtUtcMs: UtcEpochMs;
};

export const WaitlistLifecycle = {
  /** A new request: watching from `atUtcMs`. */
  open(atUtcMs: UtcEpochMs): WaitlistLifecycle {
    return {
      waitlistStatus: WaitlistStatus.Open,
      waitlistStatusAtUtcMs: atUtcMs,
    };
  },

  canTransition(from: WaitlistLifecycle, to: WaitlistStatus): boolean {
    const next = TRANSITIONS[from.waitlistStatus];
    for (let i = 0; i < next.length; i++) {
      if (next[i] === to) return true;
    }
    return false;
  },

  /**
   * Move to `to` at `atUtcMs`, or refuse
   * (`SCHEDULING_WAITLIST_INVALID_TRANSITION`) a move the graph has no edge
   * for — a terminal state never moves.
   */
  transition(
    from: WaitlistLifecycle,
    to: WaitlistStatus,
    atUtcMs: UtcEpochMs,
  ): Result<WaitlistLifecycle, SchedulingError> {
    if (!WaitlistLifecycle.canTransition(from, to)) {
      return Result.err(
        SchedulingError.waitlistInvalidTransition(from.waitlistStatus, to),
      );
    }
    return Result.ok({ waitlistStatus: to, waitlistStatusAtUtcMs: atUtcMs });
  },

  /** Still live for a matcher: open or matched. */
  isWatching(lifecycle: WaitlistLifecycle): boolean {
    return (
      lifecycle.waitlistStatus === WaitlistStatus.Open ||
      lifecycle.waitlistStatus === WaitlistStatus.Matched
    );
  },

  isTerminal(lifecycle: WaitlistLifecycle): boolean {
    return TRANSITIONS[lifecycle.waitlistStatus].length === 0;
  },
} as const;
