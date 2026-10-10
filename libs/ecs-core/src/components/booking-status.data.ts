/**
 * Lifecycle tags of an appointment's root status — the ONLY source of these
 * strings (`appointment-status.ts:20-32`; the stored `status.kind`, now
 * `bookingStatus.kind`, which composite indexes filter on).
 */
export const BookingState = {
  /** Awaiting confirmation — the gate before a slot holds. */
  Pending: 'pending',
  /** Holds the slot. Says the shop accepted, never that the client is present. */
  Confirmed: 'confirmed',
  /** The service happened. Terminal: a delivered cut cannot be undelivered. */
  Completed: 'completed',
  /**
   * The subject did not turn up. NOT terminal: the client ten minutes late is
   * the most ordinary correction a shop makes, so `no_show → confirmed` is the
   * one correction edge of the graph.
   */
  NoShow: 'no_show',
  /** Called off by either side. Terminal. */
  Cancelled: 'cancelled',
} as const;
export type BookingState = (typeof BookingState)[keyof typeof BookingState];

/**
 * The legal moves, one source of truth for the lifecycle graph. Terminal
 * states have none; `no_show` has exactly one, back to `confirmed`.
 */
const TRANSITIONS: { readonly [S in BookingState]: readonly BookingState[] } = {
  [BookingState.Pending]: [BookingState.Confirmed, BookingState.Cancelled],
  [BookingState.Confirmed]: [
    BookingState.Completed,
    BookingState.Cancelled,
    BookingState.NoShow,
  ],
  [BookingState.Completed]: [],
  [BookingState.Cancelled]: [],
  [BookingState.NoShow]: [BookingState.Confirmed],
};

/**
 * An appointment's root status: where the BOOKING is in its life, with the
 * instant it got there (`atMs`). A cancellation structurally carries its
 * reason — the code a staff cancel filed, or the `+`-joined codes of a party
 * cancelled seat by seat — so no non-cancelled status can dangle one.
 *
 * Per-person facts live on each seat's `SeatOutcome`; this root is their
 * summary (`SeatOutcome.summarize`).
 */
export type BookingStatus =
  | BookingStatus.Pending
  | BookingStatus.Confirmed
  | BookingStatus.Completed
  | BookingStatus.NoShow
  | BookingStatus.Cancelled;

export const BookingStatus = {
  pending(atMs: number): BookingStatus.Pending {
    return { kind: BookingState.Pending, atMs };
  },

  confirm(atMs: number): BookingStatus.Confirmed {
    return { kind: BookingState.Confirmed, atMs };
  },

  complete(atMs: number): BookingStatus.Completed {
    return { kind: BookingState.Completed, atMs };
  },

  noShow(atMs: number): BookingStatus.NoShow {
    return { kind: BookingState.NoShow, atMs };
  },

  cancel(atMs: number, reason: string): BookingStatus.Cancelled {
    return { kind: BookingState.Cancelled, atMs, reason };
  },

  /** Whether `from.kind → to` is a legal lifecycle move. */
  canTransition(from: BookingStatus, to: BookingState): boolean {
    const next = TRANSITIONS[from.kind];
    for (let i = 0; i < next.length; i++) {
      if (next[i] === to) return true;
    }
    return false;
  },

  /**
   * No outgoing transition — a GRAPH question. `no_show` is not terminal (it
   * has its correction edge) although it is settled; see {@link isSettled}.
   */
  isTerminal(status: BookingStatus): boolean {
    return TRANSITIONS[status.kind].length === 0;
  },

  /**
   * The visit is over, whatever became of it — a LIFECYCLE question: what
   * keeps a no-showed booking out of a client's upcoming list.
   */
  isSettled(status: BookingStatus): boolean {
    return (
      status.kind === BookingState.Completed ||
      status.kind === BookingState.Cancelled ||
      status.kind === BookingState.NoShow
    );
  },

  /** Still holding its slot — pending or confirmed. */
  isLive(status: BookingStatus): boolean {
    return (
      status.kind === BookingState.Pending ||
      status.kind === BookingState.Confirmed
    );
  },
} as const;

export namespace BookingStatus {
  export type Pending = {
    readonly kind: typeof BookingState.Pending;
    readonly atMs: number;
  };
  export type Confirmed = {
    readonly kind: typeof BookingState.Confirmed;
    readonly atMs: number;
  };
  export type Completed = {
    readonly kind: typeof BookingState.Completed;
    readonly atMs: number;
  };
  export type NoShow = {
    readonly kind: typeof BookingState.NoShow;
    readonly atMs: number;
  };
  export type Cancelled = {
    readonly kind: typeof BookingState.Cancelled;
    readonly atMs: number;
    readonly reason: string;
  };
}
