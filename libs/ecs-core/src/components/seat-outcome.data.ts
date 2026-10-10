import { BookingPolicy } from './booking-policy.data';
import { BookingState, BookingStatus } from './booking-status.data';

/** What became of one seat — the ONLY source of these strings (`worked`, not `completed`). */
export const SeatOutcomeKind = {
  /** The state every seat starts in, and the only one that is not final. */
  Scheduled: 'scheduled',
  Worked: 'worked',
  NoShow: 'no_show',
  Cancelled: 'cancelled',
} as const;
export type SeatOutcomeKind =
  (typeof SeatOutcomeKind)[keyof typeof SeatOutcomeKind];

/**
 * Why a seat was called off — a CLOSED vocabulary, because prose cannot be
 * aggregated. `client_*` and `staff_*` must never share a bucket (a reminder
 * problem vs a rostering problem). Code-only (§9 D23): free text a staff
 * member types is an appointment note, never a reason.
 */
export const CancellationReason = {
  ClientChangedPlans: 'client_changed_plans',
  ClientUnwell: 'client_unwell',
  StaffBarberAbsence: 'staff_barber_absence',
  StaffShopClosure: 'staff_shop_closure',
  /** A no-show the shop later reclassified — stamped, never picked. */
  NoShowConverted: 'no_show_converted',
  /** Nobody said why — what picking nothing is filed as, its own countable bucket. */
  Unspecified: 'unspecified',
  /** A reason outside the list. */
  Other: 'other',
} as const;
export type CancellationReason =
  (typeof CancellationReason)[keyof typeof CancellationReason];

/** Which side called a seat off. */
export const CancelledBy = {
  Client: 'client',
  Staff: 'staff',
} as const;
export type CancelledBy = (typeof CancelledBy)[keyof typeof CancelledBy];

const REASONS: readonly CancellationReason[] =
  Object.values(CancellationReason);

/**
 * The codes a HUMAN may pick, in the order a shop reaches for them.
 * `no_show_converted` is stamped by the correction edge, never chosen;
 * `unspecified` is what choosing nothing means, so it is no chip either.
 */
const OFFERED_REASONS: readonly CancellationReason[] = [
  CancellationReason.ClientChangedPlans,
  CancellationReason.ClientUnwell,
  CancellationReason.StaffBarberAbsence,
  CancellationReason.StaffShopClosure,
  CancellationReason.Other,
];

/**
 * What became of ONE person's seat (`seat-outcome.ts:30-194`) — per seat,
 * because a party of three where one guest did not turn up has no
 * representable root status. Stored on each seat as `outcome` (the tags of
 * `seatOutcomeToDocument`).
 *
 * `atMs` is the INSTANT the shop resolved the seat, only ever subtracted
 * from another instant. A cancellation stamps the free-cancellation window
 * IN FORCE when it was called off, as whole hours (`windowHours`), so
 * "late" is judged by the rule the client cancelled under; `null` is
 * unknown (a cancellation from before the stamp, or one whose policy read
 * failed) and the stats then judge it by the current policy.
 */
export type SeatOutcome =
  | SeatOutcome.Scheduled
  | SeatOutcome.Worked
  | SeatOutcome.NoShow
  | SeatOutcome.Cancelled;

const SCHEDULED: SeatOutcome.Scheduled = { kind: SeatOutcomeKind.Scheduled };

export const SeatOutcome = {
  /** The human-pickable reasons, in the order a shop reaches for them. */
  OFFERED_REASONS,

  scheduled(): SeatOutcome.Scheduled {
    return SCHEDULED;
  },

  worked(atMs: number): SeatOutcome.Worked {
    return { kind: SeatOutcomeKind.Worked, atMs };
  },

  noShow(atMs: number): SeatOutcome.NoShow {
    return { kind: SeatOutcomeKind.NoShow, atMs };
  },

  /**
   * A seat called off at `atMs` under a `windowHours` window. A window the
   * policy itself could not have set (`NaN`, `-1`, `1.5`) is stamped as
   * unknown (`null`) — a stamp is a real window or nothing, never a number
   * the stats would later refuse and silently re-judge.
   */
  cancelled(
    atMs: number,
    by: CancelledBy,
    reason: CancellationReason,
    windowHours: number | null,
  ): SeatOutcome.Cancelled {
    return {
      kind: SeatOutcomeKind.Cancelled,
      atMs,
      by,
      reason: { kind: reason },
      windowHours:
        windowHours !== null &&
        BookingPolicy.isValidCancellationWindowHours(windowHours)
          ? windowHours + 0
          : null,
    };
  },

  /** Anything but `scheduled` — a seat whose story is over. */
  isResolved(outcome: SeatOutcome): boolean {
    return outcome.kind !== SeatOutcomeKind.Scheduled;
  },

  /**
   * A reason from an untrusted code, or `null` for an unknown one. NO code
   * is not an unknown code: it is the shop declining to say, filed
   * `unspecified`. Code-only (§9 D23): `other` needs no note.
   */
  reasonOf(code: string): CancellationReason | null {
    const trimmed = code.trim();
    if (trimmed.length === 0) return CancellationReason.Unspecified;
    for (let i = 0; i < REASONS.length; i++) {
      if (REASONS[i] === trimmed) return REASONS[i] as CancellationReason;
    }
    return null;
  },

  /**
   * The seat outcome a party-level lifecycle verb stamps on every open
   * seat: `completed` → worked, `no_show` → no-show, `cancelled` → a staff
   * cancellation under `windowHours`; `pending`/`confirmed` say nothing about
   * the work, so `null`.
   */
  outcomeForStatus(
    to: BookingState,
    atMs: number,
    reason: CancellationReason,
    windowHours: number | null,
  ): SeatOutcome | null {
    switch (to) {
      case BookingState.Completed:
        return SeatOutcome.worked(atMs);
      case BookingState.NoShow:
        return SeatOutcome.noShow(atMs);
      case BookingState.Cancelled:
        return SeatOutcome.cancelled(
          atMs,
          CancelledBy.Staff,
          reason,
          windowHours,
        );
      default:
        return null;
    }
  },

  /**
   * The party's seat outcomes rolled up into the root status — the root is a
   * SUMMARY of its seats. The order of the rules is the design:
   *
   *  1. any seat still `scheduled` → the root is unchanged;
   *  2. every seat cancelled → `cancelled` (a root cancel keeps its own
   *     reason verbatim; a party cancelled seat by seat gets its distinct
   *     codes, sorted and `+`-joined, so the string stays groupable);
   *  3. any seat worked → `completed` (a party that generated revenue is not
   *     a no-show, whatever one guest did);
   *  4. otherwise → `no_show`.
   *
   * A root already in the derived state is returned as is, keeping its
   * `atMs` — the instant it entered that state.
   */
  summarize(
    outcomes: readonly SeatOutcome[],
    current: BookingStatus,
    atMs: number,
  ): BookingStatus {
    if (outcomes.length === 0) return current;
    let cancelled = 0;
    let worked = false;
    for (let i = 0; i < outcomes.length; i++) {
      const kind = (outcomes[i] as SeatOutcome).kind;
      if (kind === SeatOutcomeKind.Scheduled) return current;
      if (kind === SeatOutcomeKind.Cancelled) cancelled++;
      if (kind === SeatOutcomeKind.Worked) worked = true;
    }
    if (cancelled === outcomes.length) {
      if (current.kind === BookingState.Cancelled) return current;
      return BookingStatus.cancel(atMs, partyCancellationReason(outcomes));
    }
    if (worked) {
      return current.kind === BookingState.Completed
        ? current
        : BookingStatus.complete(atMs);
    }
    return current.kind === BookingState.NoShow
      ? current
      : BookingStatus.noShow(atMs);
  },
} as const;

/** The distinct reason codes of an all-cancelled party, sorted, `+`-joined. */
function partyCancellationReason(outcomes: readonly SeatOutcome[]): string {
  const codes: string[] = [];
  for (let i = 0; i < outcomes.length; i++) {
    const outcome = outcomes[i] as SeatOutcome;
    if (outcome.kind !== SeatOutcomeKind.Cancelled) continue;
    if (!codes.includes(outcome.reason.kind)) codes.push(outcome.reason.kind);
  }
  codes.sort();
  return codes.join('+');
}

export namespace SeatOutcome {
  export type Scheduled = { readonly kind: typeof SeatOutcomeKind.Scheduled };
  export type Worked = {
    readonly kind: typeof SeatOutcomeKind.Worked;
    readonly atMs: number;
  };
  export type NoShow = {
    readonly kind: typeof SeatOutcomeKind.NoShow;
    readonly atMs: number;
  };
  export type Cancelled = {
    readonly kind: typeof SeatOutcomeKind.Cancelled;
    readonly atMs: number;
    readonly by: CancelledBy;
    /** Stored as `{ kind: <code> }`, as today (`appointment-document.ts:615-618`). */
    readonly reason: Reason;
    /** The window in force, whole hours; `null` is unknown. */
    readonly windowHours: number | null;
  };
  /** The stored reason struct — a code and nothing else (§9 D23). */
  export type Reason = { readonly kind: CancellationReason };
}
