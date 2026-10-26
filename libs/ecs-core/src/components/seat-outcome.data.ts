import {
  type StoredFields,
  HourCount,
  UtcEpochMs,
  BookingStatus,
  AttendanceState,
} from '@core/primitives';
import { BookingLifecycle } from './booking-lifecycle.data';
import { CancellationReason } from './cancellation-reason.data';
import { CancellationReasonSet } from './cancellation-reason-set.data';

/** Which side called a seat off — the field `cancelledBy`. */
export const CancelledBy = {
  Client: 'CLIENT',
  Staff: 'STAFF',
} as const;
export type CancelledBy = (typeof CancelledBy)[keyof typeof CancelledBy];

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
   * A seat called off at `atUtcMs` under a `windowHours` window — an
   * `HourCount` (OR-45), so a stamp is a real window or `null` (unknown) by
   * its type: no number the stats would later refuse and silently re-judge
   * can reach it.
   */
  cancelled(
    atUtcMs: UtcEpochMs,
    by: CancelledBy,
    reason: CancellationReason,
    windowHours: HourCount | null,
  ): SeatOutcome.Cancelled {
    return {
      attendanceState: AttendanceState.Cancelled,
      cancelledAtUtcMs: atUtcMs,
      cancelledBy: by,
      cancellationReason: reason,
      cancellationWindowHours: windowHours,
    };
  },

  /**
   * The read-time check of a stored outcome (edge hardening D-1): the NAME
   * of the first field that is not well-formed, or `null`. Narrows on
   * `attendanceState` (an `AttendanceState` member, else
   * `'attendanceState'`), then checks THAT variant's stamp — `workedAtUtcMs`,
   * `noShowAtUtcMs`, `cancelledAtUtcMs` (an instant) — and a cancellation's
   * window, `cancellationWindowHours`: an `HourCount` or `null` (OR-45: the
   * statistics judge lateness by it, so a stored window is the brand it is
   * typed as). The cancellation's `cancelledBy` is a display input judged
   * where it is read, and is not checked here. No allocation.
   */
  fieldFault(raw: StoredFields): string | null {
    switch (raw['attendanceState']) {
      case AttendanceState.Scheduled:
        return null;
      case AttendanceState.Worked:
        return UtcEpochMs.is(raw['workedAtUtcMs']) ? null : 'workedAtUtcMs';
      case AttendanceState.NoShow:
        return UtcEpochMs.is(raw['noShowAtUtcMs']) ? null : 'noShowAtUtcMs';
      case AttendanceState.Cancelled: {
        if (!UtcEpochMs.is(raw['cancelledAtUtcMs'])) return 'cancelledAtUtcMs';
        const window = raw['cancellationWindowHours'];
        return window === null || HourCount.is(window)
          ? null
          : 'cancellationWindowHours';
      }
      default:
        return 'attendanceState';
    }
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
    windowHours: HourCount | null,
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
   * Does a move to `to` mean anything for ONE seat — is it a per-seat verb?
   * True exactly where {@link outcomeForStatus} stamps an outcome
   * (`COMPLETED`, `NO_SHOW`, `CANCELLED`); `PENDING`/`CONFIRMED` are about
   * the booking, never the work, so they always address the root.
   */
  hasSeatMeaning(to: BookingStatus): boolean {
    return (
      to === BookingStatus.Completed ||
      to === BookingStatus.NoShow ||
      to === BookingStatus.Cancelled
    );
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
    readonly cancellationWindowHours: HourCount | null;
  };
}
