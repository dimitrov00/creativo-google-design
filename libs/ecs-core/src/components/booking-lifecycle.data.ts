import { type UtcEpochMs, BookingStatus } from '@core/primitives';
import type { CancellationReasonSet } from './seat-outcome.data';

/**
 * The legal moves, one source of truth for the lifecycle graph. Terminal
 * states have none; `NO_SHOW` has exactly one, back to `CONFIRMED`.
 */
const TRANSITIONS: { readonly [S in BookingStatus]: readonly BookingStatus[] } =
  {
    [BookingStatus.Pending]: [BookingStatus.Confirmed, BookingStatus.Cancelled],
    [BookingStatus.Confirmed]: [
      BookingStatus.Completed,
      BookingStatus.Cancelled,
      BookingStatus.NoShow,
    ],
    [BookingStatus.Completed]: [],
    [BookingStatus.Cancelled]: [],
    [BookingStatus.NoShow]: [BookingStatus.Confirmed],
  };

/**
 * An appointment's root lifecycle (owner template, flatten-spec §3.2): where
 * the BOOKING is in its life, as a union of FLAT variant slices intersected
 * into the `Appointment` archetype — `bookingStatus` plus the variant's own
 * entering stamp, nothing else (F-20: today's data keeps no history). A
 * cancellation structurally carries its reasons (`cancellationReason`, a
 * {@link CancellationReasonSet}), so no other variant can dangle one.
 *
 * Per-person facts live on each seat's `SeatOutcome`; this root is their
 * summary (`SeatOutcome.summarize`). A transition's write plan sets the new
 * variant's fields and deletes the old variant's
 * (`WriteOp.transition` + `WriteOp.variantFieldsToDelete`).
 */
export type BookingLifecycle =
  | BookingLifecycle.Pending
  | BookingLifecycle.Confirmed
  | BookingLifecycle.Completed
  | BookingLifecycle.NoShow
  | BookingLifecycle.Cancelled;

export const BookingLifecycle = {
  pending(atUtcMs: UtcEpochMs): BookingLifecycle.Pending {
    return { bookingStatus: BookingStatus.Pending, pendingAtUtcMs: atUtcMs };
  },

  confirm(atUtcMs: UtcEpochMs): BookingLifecycle.Confirmed {
    return {
      bookingStatus: BookingStatus.Confirmed,
      confirmedAtUtcMs: atUtcMs,
    };
  },

  complete(atUtcMs: UtcEpochMs): BookingLifecycle.Completed {
    return {
      bookingStatus: BookingStatus.Completed,
      completedAtUtcMs: atUtcMs,
    };
  },

  noShow(atUtcMs: UtcEpochMs): BookingLifecycle.NoShow {
    return { bookingStatus: BookingStatus.NoShow, noShowAtUtcMs: atUtcMs };
  },

  cancel(
    atUtcMs: UtcEpochMs,
    reasons: CancellationReasonSet,
  ): BookingLifecycle.Cancelled {
    return {
      bookingStatus: BookingStatus.Cancelled,
      cancelledAtUtcMs: atUtcMs,
      cancellationReason: reasons,
    };
  },

  /** Whether `from.bookingStatus → to` is a legal lifecycle move. */
  canTransition(from: BookingLifecycle, to: BookingStatus): boolean {
    const next = TRANSITIONS[from.bookingStatus];
    for (let i = 0; i < next.length; i++) {
      if (next[i] === to) return true;
    }
    return false;
  },

  /**
   * No outgoing transition — a GRAPH question. `NO_SHOW` is not terminal (it
   * has its correction edge) although it is settled; see {@link isSettled}.
   */
  isTerminal(lifecycle: BookingLifecycle): boolean {
    return TRANSITIONS[lifecycle.bookingStatus].length === 0;
  },

  /**
   * The visit is over, whatever became of it — a LIFECYCLE question: what
   * keeps a no-showed booking out of a client's upcoming list.
   */
  isSettled(lifecycle: BookingLifecycle): boolean {
    const status = lifecycle.bookingStatus;
    return (
      status === BookingStatus.Completed ||
      status === BookingStatus.Cancelled ||
      status === BookingStatus.NoShow
    );
  },

  /** Still holding its slot — pending or confirmed. */
  isLive(lifecycle: BookingLifecycle): boolean {
    const status = lifecycle.bookingStatus;
    return (
      status === BookingStatus.Pending || status === BookingStatus.Confirmed
    );
  },

  /**
   * When the booking entered its current state — the one reader of the
   * variant's entering stamp (it replaces every `status.atMs` read).
   */
  enteredAtUtcMs(lifecycle: BookingLifecycle): UtcEpochMs {
    switch (lifecycle.bookingStatus) {
      case BookingStatus.Pending:
        return lifecycle.pendingAtUtcMs;
      case BookingStatus.Confirmed:
        return lifecycle.confirmedAtUtcMs;
      case BookingStatus.Completed:
        return lifecycle.completedAtUtcMs;
      case BookingStatus.NoShow:
        return lifecycle.noShowAtUtcMs;
      default:
        return lifecycle.cancelledAtUtcMs;
    }
  },

  /**
   * The lifecycle slice of a value that carries one — a whole `Appointment`
   * passes straight in — copied to exactly its variant's fields, so a
   * transition can be compared or planned on the slice alone.
   */
  sliceOf(lifecycle: BookingLifecycle): BookingLifecycle {
    switch (lifecycle.bookingStatus) {
      case BookingStatus.Pending:
        return BookingLifecycle.pending(lifecycle.pendingAtUtcMs);
      case BookingStatus.Confirmed:
        return BookingLifecycle.confirm(lifecycle.confirmedAtUtcMs);
      case BookingStatus.Completed:
        return BookingLifecycle.complete(lifecycle.completedAtUtcMs);
      case BookingStatus.NoShow:
        return BookingLifecycle.noShow(lifecycle.noShowAtUtcMs);
      default:
        return BookingLifecycle.cancel(
          lifecycle.cancelledAtUtcMs,
          lifecycle.cancellationReason,
        );
    }
  },
} as const;

export namespace BookingLifecycle {
  export type Pending = {
    readonly bookingStatus: typeof BookingStatus.Pending;
    readonly pendingAtUtcMs: UtcEpochMs;
  };
  export type Confirmed = {
    readonly bookingStatus: typeof BookingStatus.Confirmed;
    readonly confirmedAtUtcMs: UtcEpochMs;
  };
  export type Completed = {
    readonly bookingStatus: typeof BookingStatus.Completed;
    readonly completedAtUtcMs: UtcEpochMs;
  };
  export type NoShow = {
    readonly bookingStatus: typeof BookingStatus.NoShow;
    readonly noShowAtUtcMs: UtcEpochMs;
  };
  export type Cancelled = {
    readonly bookingStatus: typeof BookingStatus.Cancelled;
    /** The entering stamp only (F-20). */
    readonly cancelledAtUtcMs: UtcEpochMs;
    /** A party's 1-to-N reasons, one stored string (F-24). */
    readonly cancellationReason: CancellationReasonSet;
  };
}
