import {
  type Brand,
  type UtcEpochMs,
  BookingStatus,
  AttendanceState,
} from '@core/primitives';
import { BookingPolicy } from './booking-policy.data';
import { BookingLifecycle } from './booking-lifecycle.data';

/**
 * Why a seat was called off — a CLOSED vocabulary, because prose cannot be
 * aggregated. `CLIENT_*` and `STAFF_*` must never share a bucket (a reminder
 * problem vs a rostering problem). Code-only (§9 D23): free text a staff
 * member types is an appointment note, never a reason.
 */
export const CancellationReason = {
  ClientChangedPlans: 'CLIENT_CHANGED_PLANS',
  ClientUnwell: 'CLIENT_UNWELL',
  StaffBarberAbsence: 'STAFF_BARBER_ABSENCE',
  StaffShopClosure: 'STAFF_SHOP_CLOSURE',
  /** A no-show the shop later reclassified — stamped, never picked. */
  NoShowConverted: 'NO_SHOW_CONVERTED',
  /** Nobody said why — what picking nothing is filed as, its own countable bucket. */
  Unspecified: 'UNSPECIFIED',
  /** A reason outside the list. */
  Other: 'OTHER',
} as const;
export type CancellationReason =
  (typeof CancellationReason)[keyof typeof CancellationReason];

/** Which side called a seat off — the field `cancelledBy`. */
export const CancelledBy = {
  Client: 'CLIENT',
  Staff: 'STAFF',
} as const;
export type CancelledBy = (typeof CancelledBy)[keyof typeof CancelledBy];

const REASONS: readonly CancellationReason[] = [
  CancellationReason.ClientChangedPlans,
  CancellationReason.ClientUnwell,
  CancellationReason.StaffBarberAbsence,
  CancellationReason.StaffShopClosure,
  CancellationReason.NoShowConverted,
  CancellationReason.Unspecified,
  CancellationReason.Other,
];

/**
 * The codes a HUMAN may pick, in the order a shop reaches for them.
 * `NO_SHOW_CONVERTED` is stamped by the correction edge, never chosen;
 * `UNSPECIFIED` is what choosing nothing means, so it is no chip either.
 */
const OFFERED_REASONS: readonly CancellationReason[] = [
  CancellationReason.ClientChangedPlans,
  CancellationReason.ClientUnwell,
  CancellationReason.StaffBarberAbsence,
  CancellationReason.StaffShopClosure,
  CancellationReason.Other,
];

/** The one separator of a reason set's stored text. */
const SET_SEPARATOR = '+';

/**
 * A party's cancellation reasons as ONE stored string — the root
 * `cancellationReason` of a cancelled appointment (flatten-spec §3.2, F-24):
 * the distinct {@link CancellationReason} codes of the party, sorted and
 * `+`-joined (`'CLIENT_UNWELL+STAFF_SHOP_CLOSURE'`), so the field stays one
 * groupable string while a party cancelled seat by seat can hold several.
 * A staff cancel of the whole party files its one code (`'STAFF_SHOP_CLOSURE'`).
 *
 * Built only through its companion — {@link CancellationReasonSet.of} joins,
 * {@link CancellationReasonSet.codes} splits — so no system ever joins or
 * splits the text itself. A domain-value brand (F-15): it lives beside the
 * dictionary it joins, and its cast lives here.
 */
export type CancellationReasonSet = Brand<string, 'CancellationReasonSet'>;

function isReason(raw: string): raw is CancellationReason {
  for (let i = 0; i < REASONS.length; i++) {
    if (REASONS[i] === raw) return true;
  }
  return false;
}

export const CancellationReasonSet = {
  /**
   * The set of `reasons` — de-duplicated, sorted, `+`-joined, so one set
   * of codes is always stored as the same string.
   */
  of(reasons: readonly CancellationReason[]): CancellationReasonSet {
    const distinct: CancellationReason[] = [];
    for (let i = 0; i < reasons.length; i++) {
      const reason = reasons[i] as CancellationReason;
      if (!distinct.includes(reason)) distinct.push(reason);
    }
    distinct.sort();
    return distinct.join(SET_SEPARATOR) as CancellationReasonSet;
  },

  /** The codes the set holds, in stored order — text that is no code is skipped. */
  codes(set: CancellationReasonSet): readonly CancellationReason[] {
    const out: CancellationReason[] = [];
    if (set.length === 0) return out;
    const parts = set.split(SET_SEPARATOR);
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i] as string;
      if (isReason(part)) out.push(part);
    }
    return out;
  },
} as const;

/**
 * What became of ONE person's seat (`seat-outcome.ts:30-194`) — a flat
 * variant slice of every `seats[]` element (Law 6), discriminated by
 * `attendanceState`, because a party of three where one guest did not turn
 * up has no representable root status.
 *
 * The `*AtUtcMs` stamps are the INSTANT the shop resolved the seat — a
 * lifecycle stamp, only ever compared with another instant. A cancellation
 * stamps the free-cancellation window IN FORCE when it was called off, as
 * whole hours (`cancellationWindowHours`), so "late" is judged by the rule
 * the client cancelled under; `null` is unknown (a cancellation from before
 * the stamp, or one whose policy read failed) and the stats then judge it
 * by the current policy.
 *
 * Seat-level `noShowAtUtcMs` / `cancelledAtUtcMs` / `cancellationReason`
 * live inside `seats[]` elements and never meet the root `BookingLifecycle`
 * fields of the same names.
 */
export type SeatOutcome =
  | SeatOutcome.Scheduled
  | SeatOutcome.Worked
  | SeatOutcome.NoShow
  | SeatOutcome.Cancelled;

const SCHEDULED: SeatOutcome.Scheduled = {
  attendanceState: AttendanceState.Scheduled,
};

export const SeatOutcome = {
  /** The human-pickable reasons, in the order a shop reaches for them. */
  OFFERED_REASONS,

  scheduled(): SeatOutcome.Scheduled {
    return SCHEDULED;
  },

  worked(atUtcMs: UtcEpochMs): SeatOutcome.Worked {
    return { attendanceState: AttendanceState.Worked, workedAtUtcMs: atUtcMs };
  },

  noShow(atUtcMs: UtcEpochMs): SeatOutcome.NoShow {
    return { attendanceState: AttendanceState.NoShow, noShowAtUtcMs: atUtcMs };
  },

  /**
   * A seat called off at `atUtcMs` under a `windowHours` window. A window
   * the policy itself could not have set (`NaN`, `-1`, `1.5`) is stamped as
   * unknown (`null`) — a stamp is a real window or nothing, never a number
   * the stats would later refuse and silently re-judge.
   */
  cancelled(
    atUtcMs: UtcEpochMs,
    by: CancelledBy,
    reason: CancellationReason,
    windowHours: number | null,
  ): SeatOutcome.Cancelled {
    return {
      attendanceState: AttendanceState.Cancelled,
      cancelledAtUtcMs: atUtcMs,
      cancelledBy: by,
      cancellationReason: reason,
      cancellationWindowHours:
        windowHours !== null &&
        BookingPolicy.isValidCancellationWindowHours(windowHours)
          ? windowHours + 0
          : null,
    };
  },

  /** Anything but `SCHEDULED` — a seat whose story is over. */
  isResolved(outcome: SeatOutcome): boolean {
    return outcome.attendanceState !== AttendanceState.Scheduled;
  },

  /**
   * The seat outcome a party-level lifecycle verb stamps on every open
   * seat: `COMPLETED` → worked, `NO_SHOW` → no-show, `CANCELLED` → a staff
   * cancellation under `windowHours`; `PENDING`/`CONFIRMED` say nothing
   * about the work, so `null`.
   */
  outcomeForStatus(
    to: BookingStatus,
    atUtcMs: UtcEpochMs,
    reason: CancellationReason,
    windowHours: number | null,
  ): SeatOutcome | null {
    switch (to) {
      case BookingStatus.Completed:
        return SeatOutcome.worked(atUtcMs);
      case BookingStatus.NoShow:
        return SeatOutcome.noShow(atUtcMs);
      case BookingStatus.Cancelled:
        return SeatOutcome.cancelled(
          atUtcMs,
          CancelledBy.Staff,
          reason,
          windowHours,
        );
      default:
        return null;
    }
  },

  /**
   * The party's seat outcomes rolled up into the root lifecycle — the root
   * is a SUMMARY of its seats. The order of the rules is the design:
   *
   *  1. any seat still `SCHEDULED` → the root is unchanged;
   *  2. every seat cancelled → `CANCELLED` (a root cancel keeps its own
   *     reason set verbatim; a party cancelled seat by seat gets its distinct
   *     codes as one {@link CancellationReasonSet}, so the string stays
   *     groupable);
   *  3. any seat worked → `COMPLETED` (a party that generated revenue is not
   *     a no-show, whatever one guest did);
   *  4. otherwise → `NO_SHOW`.
   *
   * A root already in the derived state is returned as is, keeping its
   * entering stamp — the instant it entered that state.
   */
  summarize(
    outcomes: readonly SeatOutcome[],
    current: BookingLifecycle,
    atUtcMs: UtcEpochMs,
  ): BookingLifecycle {
    if (outcomes.length === 0) return current;
    let cancelled = 0;
    let worked = false;
    for (let i = 0; i < outcomes.length; i++) {
      const state = (outcomes[i] as SeatOutcome).attendanceState;
      if (state === AttendanceState.Scheduled) return current;
      if (state === AttendanceState.Cancelled) cancelled++;
      if (state === AttendanceState.Worked) worked = true;
    }
    if (cancelled === outcomes.length) {
      if (current.bookingStatus === BookingStatus.Cancelled) return current;
      return BookingLifecycle.cancel(atUtcMs, partyReasonSet(outcomes));
    }
    if (worked) {
      return current.bookingStatus === BookingStatus.Completed
        ? current
        : BookingLifecycle.complete(atUtcMs);
    }
    return current.bookingStatus === BookingStatus.NoShow
      ? current
      : BookingLifecycle.noShow(atUtcMs);
  },
} as const;

/** The reason codes of an all-cancelled party, as one set. */
function partyReasonSet(
  outcomes: readonly SeatOutcome[],
): CancellationReasonSet {
  const codes: CancellationReason[] = [];
  for (let i = 0; i < outcomes.length; i++) {
    const outcome = outcomes[i] as SeatOutcome;
    if (outcome.attendanceState !== AttendanceState.Cancelled) continue;
    codes.push(outcome.cancellationReason);
  }
  return CancellationReasonSet.of(codes);
}

export namespace SeatOutcome {
  export type Scheduled = {
    readonly attendanceState: typeof AttendanceState.Scheduled;
  };
  export type Worked = {
    readonly attendanceState: typeof AttendanceState.Worked;
    readonly workedAtUtcMs: UtcEpochMs;
  };
  export type NoShow = {
    readonly attendanceState: typeof AttendanceState.NoShow;
    readonly noShowAtUtcMs: UtcEpochMs;
  };
  export type Cancelled = {
    readonly attendanceState: typeof AttendanceState.Cancelled;
    readonly cancelledAtUtcMs: UtcEpochMs;
    readonly cancelledBy: CancelledBy;
    /** The code and nothing else (§9 D23) — was the nested `reason: { kind }`. */
    readonly cancellationReason: CancellationReason;
    /** The window in force, whole hours; `null` is unknown. */
    readonly cancellationWindowHours: number | null;
  };
}
