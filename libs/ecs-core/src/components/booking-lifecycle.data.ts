import { type StoredFields, UtcEpochMs, BookingStatus } from '@core/primitives';
import type { CancellationReasonSet } from './cancellation-reason-set.data';

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

/** The deduplicated destinations of a lifecycle graph, in first-reached order. */
function targetsOf(graph: typeof TRANSITIONS): readonly BookingStatus[] {
  const targets: BookingStatus[] = [];
  for (const next of Object.values(graph)) {
    for (const to of next) {
      if (!targets.includes(to)) targets.push(to);
    }
  }
  return targets;
}

/**
 * Every status some legal move lands on — computed from {@link TRANSITIONS},
 * never hand-listed (today `CONFIRMED`, `CANCELLED`, `COMPLETED`,
 * `NO_SHOW`). `PENDING` is only ever a booking's first state, never a move's
 * destination, so a transition request naming it is malformed input.
 */
const TRANSITION_TARGETS = targetsOf(TRANSITIONS);

/**
 * The statuses that still hold a slot, in this order — the one list the
 * live-occupancy reads filter on (`bookingStatus in [PENDING, CONFIRMED]`,
 * index #6/#7): the reinstated chair's collision read, the busy rebuild,
 * the upcoming read.
 */
const LIVE_STATUSES: readonly BookingStatus[] = [
  BookingStatus.Pending,
  BookingStatus.Confirmed,
];

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
  /** The statuses that still hold a slot — `[PENDING, CONFIRMED]`, this order (see {@link isLive}). */
  LIVE_STATUSES,

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

  /**
   * The read-time check of a stored lifecycle (edge hardening D-1): the
   * NAME of the first field that is not well-formed, or `null`. Narrows on
   * the discriminator (`bookingStatus` — a `BookingStatus` member, else
   * `'bookingStatus'`), then checks THAT variant's entering stamp (an
   * instant — `pendingAtUtcMs` … `cancelledAtUtcMs`, what
   * {@link enteredAtUtcMs} reads) and, for a cancellation, that its
   * `cancellationReason` is the stored string. No allocation.
   */
  fieldFault(raw: StoredFields): string | null {
    switch (raw['bookingStatus']) {
      case BookingStatus.Pending:
        return UtcEpochMs.is(raw['pendingAtUtcMs']) ? null : 'pendingAtUtcMs';
      case BookingStatus.Confirmed:
        return UtcEpochMs.is(raw['confirmedAtUtcMs'])
          ? null
          : 'confirmedAtUtcMs';
      case BookingStatus.Completed:
        return UtcEpochMs.is(raw['completedAtUtcMs'])
          ? null
          : 'completedAtUtcMs';
      case BookingStatus.NoShow:
        return UtcEpochMs.is(raw['noShowAtUtcMs']) ? null : 'noShowAtUtcMs';
      case BookingStatus.Cancelled:
        if (!UtcEpochMs.is(raw['cancelledAtUtcMs'])) return 'cancelledAtUtcMs';
        return typeof raw['cancellationReason'] === 'string'
          ? null
          : 'cancellationReason';
      default:
        return 'bookingStatus';
    }
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
   * The edge guard of a transition request's target: `raw` is a status some
   * legal move can land on (see {@link TRANSITION_TARGETS}) — every status
   * but `PENDING`. Whether the move is legal FROM the booking's current state
   * stays {@link canTransition}'s question.
   */
  isTransitionTarget(raw: unknown): raw is BookingStatus {
    for (let i = 0; i < TRANSITION_TARGETS.length; i++) {
      if (TRANSITION_TARGETS[i] === raw) return true;
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
  isSettled(lifecycle: { readonly bookingStatus: BookingStatus }): boolean {
    const status = lifecycle.bookingStatus;
    return (
      status === BookingStatus.Completed ||
      status === BookingStatus.Cancelled ||
      status === BookingStatus.NoShow
    );
  },

  /**
   * Still holding its slot — pending or confirmed: exactly the
   * {@link LIVE_STATUSES}.
   */
  isLive(lifecycle: { readonly bookingStatus: BookingStatus }): boolean {
    const status = lifecycle.bookingStatus;
    return (
      status === BookingStatus.Pending || status === BookingStatus.Confirmed
    );
  },

  /**
   * The visit did not happen — called off, or nobody came: what strikes a
   * staff event head and hollows its tile. A COMPLETED visit happened; a
   * live one has not settled yet. (The row's own outcome answers the same
   * question for a person's story — `VisitStorySystem.isVoid`.)
   */
  didNotHappen(lifecycle: { readonly bookingStatus: BookingStatus }): boolean {
    const status = lifecycle.bookingStatus;
    return (
      status === BookingStatus.Cancelled || status === BookingStatus.NoShow
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
