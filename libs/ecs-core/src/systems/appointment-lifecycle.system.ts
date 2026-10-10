import {
  AuditAction,
  AuditContext,
  type TransitionAction,
} from '../components/audit-context.data';
import { BookingState, BookingStatus } from '../components/booking-status.data';
import { DayOffset } from '../components/day-offset.data';
import { Result } from '../components/result.data';
import { SchedulingError } from '../components/scheduling-errors.data';
import {
  CancellationReason,
  CancelledBy,
  SeatOutcome,
  SeatOutcomeKind,
} from '../components/seat-outcome.data';
import { Seat, type SeatId } from '../components/seat.data';
import type { AppointmentEntity } from '../entities/appointment.entity';
import { AppointmentIndexSystem } from './appointment-index.system';
import { type AuditFact, AuditSystem } from './audit.system';

const MS_PER_MINUTE = 60_000;

/**
 * What a lifecycle verb hands its pipeline: the appointment as the verb
 * leaves it, and the audit facts of the act (`[]` for a verb that changed
 * nothing — a second arrival tap writes neither a stamp nor a row).
 */
export type LifecycleStep = {
  readonly appointment: AppointmentEntity;
  readonly auditFacts: readonly AuditFact[];
};

/**
 * The slice every lifecycle verb reads and writes: the root status and the
 * seats' outcomes, index-aligned with the seats. The verbs below are total
 * on this slice alone, so a caller holding no entity (a legacy shim) asks
 * the same questions and gets the same answers.
 */
export type LifecycleSlice = {
  readonly status: BookingStatus;
  readonly outcomes: readonly SeatOutcome[];
};

/**
 * A staff lifecycle request (`transition-appointment.ts`): the target state,
 * ONE seat or the whole party (`seatId: null`), and — for a cancel only —
 * the reason code and the window in force (`null` when the policy could not
 * be read: the seats are stamped unknown, the shop's cancel still lands).
 */
export type LifecycleTransitionRequest = {
  readonly to: BookingState;
  readonly seatId: SeatId | null;
  readonly reason: CancellationReason | null;
  readonly windowHours: number | null;
};

/** The staff verb each target state is audited under. */
const STAFF_VERB: { readonly [S in BookingState]: TransitionAction | null } = {
  [BookingState.Pending]: null,
  [BookingState.Confirmed]: AuditAction.BookingStaffConfirmed,
  [BookingState.Completed]: AuditAction.BookingStaffCompleted,
  [BookingState.NoShow]: AuditAction.BookingStaffNoShow,
  [BookingState.Cancelled]: AuditAction.BookingStaffCancelled,
};

/** The root status a party verb lands in, stamped `atMs`. */
function statusFor(
  to: BookingState,
  atMs: number,
  cancelReason: string,
): BookingStatus {
  switch (to) {
    case BookingState.Pending:
      return BookingStatus.pending(atMs);
    case BookingState.Confirmed:
      return BookingStatus.confirm(atMs);
    case BookingState.Completed:
      return BookingStatus.complete(atMs);
    case BookingState.NoShow:
      return BookingStatus.noShow(atMs);
    default:
      return BookingStatus.cancel(atMs, cancelReason);
  }
}

/** The state a seat outcome speaks for — what a refusal names as the target. */
function stateOfOutcome(kind: SeatOutcomeKind): BookingState {
  switch (kind) {
    case SeatOutcomeKind.Worked:
      return BookingState.Completed;
    case SeatOutcomeKind.NoShow:
      return BookingState.NoShow;
    case SeatOutcomeKind.Cancelled:
      return BookingState.Cancelled;
    default:
      return BookingState.Confirmed;
  }
}

function outcomesOf(seats: readonly Seat[]): readonly SeatOutcome[] {
  const out: SeatOutcome[] = [];
  for (let i = 0; i < seats.length; i++) {
    out.push((seats[i] as Seat).outcome);
  }
  return out;
}

/** The seats with the slice's outcomes — a seat whose outcome is unchanged is kept as is. */
function withOutcomes(
  seats: readonly Seat[],
  outcomes: readonly SeatOutcome[],
): readonly Seat[] {
  const out: Seat[] = [];
  for (let i = 0; i < seats.length; i++) {
    const seat = seats[i] as Seat;
    const outcome = outcomes[i] as SeatOutcome;
    out.push(outcome === seat.outcome ? seat : Seat.withOutcome(seat, outcome));
  }
  return out;
}

function applySlice(
  appointment: AppointmentEntity,
  slice: LifecycleSlice,
): AppointmentEntity {
  return {
    ...appointment,
    bookingStatus: slice.status,
    seats: withOutcomes(appointment.seats, slice.outcomes),
  };
}

function indexOfSeat(seats: readonly Seat[], seatId: SeatId): number {
  for (let i = 0; i < seats.length; i++) {
    if ((seats[i] as Seat).id === seatId) return i;
  }
  return -1;
}

function staffFact(
  appointment: AppointmentEntity,
  action: TransitionAction,
  reason: CancellationReason | null,
  seatId: SeatId | null,
  nowMs: number,
): AuditFact {
  return {
    action,
    resourceId: appointment.id,
    subjects: AuditSystem.subjectsOfSeats(appointment.seats, seatId),
    changeKey: AuditSystem.changeKey.transition(seatId, nowMs),
    context: AuditContext.transition(action, reason, seatId),
  };
}

/**
 * An appointment's life — `appointment.ts:234-593` and the staff and client
 * verbs that drive it (`transition-appointment.ts`, `cancel-appointment.ts`,
 * `mark-arrived.ts`, `clear-arrival.ts`). The graph is
 * `BookingStatus.canTransition`, never re-encoded; seat outcomes roll up
 * through `SeatOutcome.summarize`. Every verb returns a NEW entity and the
 * audit facts of the act; `nowMs` is the one instant the verb stamps.
 *
 * No version CAS: neither the cancel nor the transition callable carries
 * one (§4.1).
 */
export const AppointmentLifecycleSystem = {
  /* ── The slice verbs ───────────────────────────────────────────────── */

  /**
   * A party-level move `status → to`, stamping `stamp` on every seat still
   * open; a seat already resolved — the guest who no-showed while the other
   * two were cut — keeps what it was given. `stamp` is `null` for a verb that
   * says nothing about the work (confirm). `cancelReason` is the root's
   * cancellation string, read only when `to` is `cancelled`.
   */
  partyVerb(
    slice: LifecycleSlice,
    to: BookingState,
    stamp: SeatOutcome | null,
    atMs: number,
    cancelReason: string,
  ): Result<LifecycleSlice, SchedulingError> {
    if (!BookingStatus.canTransition(slice.status, to)) {
      return Result.err(
        SchedulingError.appointmentInvalidTransition(slice.status.kind, to),
      );
    }
    let outcomes = slice.outcomes;
    if (stamp !== null) {
      const next: SeatOutcome[] = [];
      for (let i = 0; i < slice.outcomes.length; i++) {
        const outcome = slice.outcomes[i] as SeatOutcome;
        next.push(SeatOutcome.isResolved(outcome) ? outcome : stamp);
      }
      outcomes = next;
    }
    return Result.ok({ status: statusFor(to, atMs, cancelReason), outcomes });
  },

  /**
   * The ONE correction edge of the graph: a no-show taken back. Only the
   * stamp the edge put there is lifted — `no_show` seats return to
   * `scheduled`; a seat resolved on its own before the party mark keeps what
   * it was given. Exactly one legal starting point: `no_show` (the graph
   * alone would also let `pending` through).
   */
  reopenNoShowSlice(
    slice: LifecycleSlice,
    atMs: number,
  ): Result<LifecycleSlice, SchedulingError> {
    if (slice.status.kind !== BookingState.NoShow) {
      return Result.err(
        SchedulingError.appointmentInvalidTransition(
          slice.status.kind,
          BookingState.Confirmed,
        ),
      );
    }
    const outcomes: SeatOutcome[] = [];
    for (let i = 0; i < slice.outcomes.length; i++) {
      const outcome = slice.outcomes[i] as SeatOutcome;
      outcomes.push(
        outcome.kind === SeatOutcomeKind.NoShow
          ? SeatOutcome.scheduled()
          : outcome,
      );
    }
    return Result.ok({ status: BookingStatus.confirm(atMs), outcomes });
  },

  /**
   * The same-day correction edge (owner ruling 2026-09-08): a completed or
   * cancelled visit comes back to `confirmed`, every settled seat to
   * `scheduled` — but only while the shop is inside the visit's own day
   * (`visitDayKey`, the day its last seat ends, against `todayKey`, both in
   * the shop's zone). `null` is a day the caller could not resolve, which is
   * never "the same day".
   */
  reopenSettledSlice(
    slice: LifecycleSlice,
    visitDayKey: string | null,
    todayKey: string | null,
    atMs: number,
  ): Result<LifecycleSlice, SchedulingError> {
    const kind = slice.status.kind;
    if (kind !== BookingState.Completed && kind !== BookingState.Cancelled) {
      return Result.err(
        SchedulingError.appointmentInvalidTransition(
          kind,
          BookingState.Confirmed,
        ),
      );
    }
    if (visitDayKey === null || todayKey === null || visitDayKey !== todayKey) {
      return Result.err(SchedulingError.appointmentReopenWindowClosed(kind));
    }
    const outcomes: SeatOutcome[] = [];
    for (let i = 0; i < slice.outcomes.length; i++) {
      const outcome = slice.outcomes[i] as SeatOutcome;
      outcomes.push(
        outcome.kind === SeatOutcomeKind.Scheduled
          ? outcome
          : SeatOutcome.scheduled(),
      );
    }
    return Result.ok({ status: BookingStatus.confirm(atMs), outcomes });
  },

  /**
   * ONE person's seat resolved, and the root following as a SUMMARY of the
   * seats (`SeatOutcome.summarize`) — the write path of the mixed party: two
   * served, one absent, all three facts true at once. The graph is not
   * consulted (a seat outcome is a new fact, the root a derivation); what
   * guards it is that a resolved seat is never re-resolved and a terminal
   * visit takes no further facts. `index` is the seat's position, `seatId`
   * names it in a refusal.
   */
  seatOutcomeSlice(
    slice: LifecycleSlice,
    index: number,
    seatId: string,
    outcome: SeatOutcome,
    atMs: number,
  ): Result<LifecycleSlice, SchedulingError> {
    if (index < 0 || index >= slice.outcomes.length) {
      return Result.err(SchedulingError.appointmentUnknownSeat(seatId));
    }
    const current = slice.outcomes[index] as SeatOutcome;
    if (SeatOutcome.isResolved(current)) {
      return Result.err(
        SchedulingError.appointmentSeatAlreadyResolved(seatId, current.kind),
      );
    }
    if (BookingStatus.isTerminal(slice.status)) {
      return Result.err(
        SchedulingError.appointmentInvalidTransition(
          slice.status.kind,
          stateOfOutcome(outcome.kind),
        ),
      );
    }
    const outcomes: SeatOutcome[] = [];
    for (let i = 0; i < slice.outcomes.length; i++) {
      outcomes.push(i === index ? outcome : (slice.outcomes[i] as SeatOutcome));
    }
    return Result.ok({
      status: SeatOutcome.summarize(outcomes, slice.status, atMs),
      outcomes,
    });
  },

  /* ── The entity verbs ──────────────────────────────────────────────── */

  /** Confirming is about the BOOKING, not the work — no seat is resolved. */
  confirm(
    appointment: AppointmentEntity,
    nowMs: number,
  ): Result<LifecycleStep, SchedulingError> {
    return AppointmentLifecycleSystem.transition(
      appointment,
      {
        to: BookingState.Confirmed,
        seatId: null,
        reason: null,
        windowHours: null,
      },
      nowMs,
      [],
    );
  },

  /** The whole party was served: every open seat `worked`, resolved seats untouched. */
  complete(
    appointment: AppointmentEntity,
    nowMs: number,
  ): Result<LifecycleStep, SchedulingError> {
    return AppointmentLifecycleSystem.transition(
      appointment,
      {
        to: BookingState.Completed,
        seatId: null,
        reason: null,
        windowHours: null,
      },
      nowMs,
      [],
    );
  },

  /** Nobody came — the same fan-out rule as {@link complete}. */
  markNoShow(
    appointment: AppointmentEntity,
    nowMs: number,
  ): Result<LifecycleStep, SchedulingError> {
    return AppointmentLifecycleSystem.transition(
      appointment,
      {
        to: BookingState.NoShow,
        seatId: null,
        reason: null,
        windowHours: null,
      },
      nowMs,
      [],
    );
  },

  /**
   * The shop calls the whole party off — `reason` filed on every seat it
   * closes, with the window in force (`null` unknown), and the root
   * carrying the code. A seat called off earlier keeps its own stamp.
   */
  cancel(
    appointment: AppointmentEntity,
    reason: CancellationReason,
    windowHours: number | null,
    nowMs: number,
  ): Result<LifecycleStep, SchedulingError> {
    return AppointmentLifecycleSystem.transition(
      appointment,
      { to: BookingState.Cancelled, seatId: null, reason, windowHours },
      nowMs,
      [],
    );
  },

  /**
   * The client's own cancel (`cancel-appointment.ts:180-219`): every open
   * seat cancelled BY THE CLIENT under the window it was allowed under, the
   * root carrying the code, one `booking.cancelled` fact for everyone on
   * the visit keyed by the instant it stamped. Whether the client MAY cancel
   * is `CancellationPolicySystem.mayCancel`, asked first.
   */
  cancelByClient(
    appointment: AppointmentEntity,
    reason: CancellationReason,
    windowHours: number | null,
    nowMs: number,
  ): Result<LifecycleStep, SchedulingError> {
    const stamp = SeatOutcome.cancelled(
      nowMs,
      CancelledBy.Client,
      reason,
      windowHours,
    );
    const moved = AppointmentLifecycleSystem.partyVerb(
      {
        status: appointment.bookingStatus,
        outcomes: outcomesOf(appointment.seats),
      },
      BookingState.Cancelled,
      stamp,
      nowMs,
      reason,
    );
    if (!moved.ok) return moved;
    return Result.ok({
      appointment: applySlice(appointment, moved.value),
      auditFacts: [
        {
          action: AuditAction.BookingCancelled,
          resourceId: appointment.id,
          subjects: AuditSystem.subjectsOf(appointment),
          changeKey: AuditSystem.changeKey.cancelled(nowMs),
          context: AuditContext.cancelled(reason),
        },
      ],
    });
  },

  /**
   * The staff transition callable's whole decision (`transition-appointment.ts`):
   * ONE seat resolved (`seatId`), or the party moved — through the graph, or
   * through one of the correction edges: `no_show → confirmed` lifts the
   * stamp; `completed`/`cancelled → confirmed` reopens on the visit's own
   * day only (`days` is the shop's day table around the visit and today).
   * The audit fact names the verb — a correction under its own action — the
   * reason CODE, the seat, and keys the change by the seat and `nowMs`.
   */
  transition(
    appointment: AppointmentEntity,
    request: LifecycleTransitionRequest,
    nowMs: number,
    days: readonly DayOffset[],
  ): Result<LifecycleStep, SchedulingError> {
    const slice: LifecycleSlice = {
      status: appointment.bookingStatus,
      outcomes: outcomesOf(appointment.seats),
    };
    const to = request.to;
    const verb = STAFF_VERB[to];
    if (verb === null) {
      return Result.err(
        SchedulingError.appointmentInvalidTransition(slice.status.kind, to),
      );
    }
    const reason = to === BookingState.Cancelled ? request.reason : null;
    if (to === BookingState.Cancelled && reason === null) {
      return Result.err(SchedulingError.appointmentEmptyCancellationReason());
    }
    const stamp = SeatOutcome.outcomeForStatus(
      to,
      nowMs,
      reason ?? CancellationReason.Unspecified,
      request.windowHours,
    );

    if (request.seatId !== null) {
      const index = indexOfSeat(appointment.seats, request.seatId);
      if (index < 0) {
        return Result.err(
          SchedulingError.appointmentUnknownSeat(request.seatId),
        );
      }
      if (stamp === null) {
        // Confirming says nothing about the work: no per-seat meaning.
        return Result.err(
          SchedulingError.appointmentInvalidTransition(slice.status.kind, to),
        );
      }
      const resolved = AppointmentLifecycleSystem.seatOutcomeSlice(
        slice,
        index,
        request.seatId,
        stamp,
        nowMs,
      );
      if (!resolved.ok) return resolved;
      return Result.ok({
        appointment: applySlice(appointment, resolved.value),
        auditFacts: [
          staffFact(appointment, verb, reason, request.seatId, nowMs),
        ],
      });
    }

    const kind = slice.status.kind;
    if (
      to === BookingState.Confirmed &&
      (kind === BookingState.Completed || kind === BookingState.Cancelled)
    ) {
      const reopened = AppointmentLifecycleSystem.reopenSettled(
        appointment,
        nowMs,
        days,
      );
      if (!reopened.ok) return reopened;
      return Result.ok({
        appointment: reopened.value,
        auditFacts: [
          staffFact(
            appointment,
            kind === BookingState.Completed
              ? AuditAction.BookingStaffReopenCompleted
              : AuditAction.BookingStaffReinstate,
            null,
            null,
            nowMs,
          ),
        ],
      });
    }
    if (to === BookingState.Confirmed && kind === BookingState.NoShow) {
      const reopened = AppointmentLifecycleSystem.reopenNoShowSlice(
        slice,
        nowMs,
      );
      if (!reopened.ok) return reopened;
      return Result.ok({
        appointment: applySlice(appointment, reopened.value),
        auditFacts: [
          staffFact(
            appointment,
            AuditAction.BookingStaffReopenNoShow,
            null,
            null,
            nowMs,
          ),
        ],
      });
    }
    const moved = AppointmentLifecycleSystem.partyVerb(
      slice,
      to,
      stamp,
      nowMs,
      reason ?? '',
    );
    if (!moved.ok) return moved;
    return Result.ok({
      appointment: applySlice(appointment, moved.value),
      auditFacts: [staffFact(appointment, verb, reason, null, nowMs)],
    });
  },

  /** {@link reopenNoShowSlice} over the entity. */
  reopenNoShow(
    appointment: AppointmentEntity,
    nowMs: number,
  ): Result<AppointmentEntity, SchedulingError> {
    const reopened = AppointmentLifecycleSystem.reopenNoShowSlice(
      {
        status: appointment.bookingStatus,
        outcomes: outcomesOf(appointment.seats),
      },
      nowMs,
    );
    return reopened.ok
      ? Result.ok(applySlice(appointment, reopened.value))
      : reopened;
  },

  /**
   * {@link reopenSettledSlice} over the entity — the visit's day is the day
   * its last seat ENDS, today the day `nowMs` falls in, both read off the
   * shop's day table (no zone math here).
   */
  reopenSettled(
    appointment: AppointmentEntity,
    nowMs: number,
    days: readonly DayOffset[],
  ): Result<AppointmentEntity, SchedulingError> {
    const envelope = AppointmentIndexSystem.envelope(appointment);
    const visitIndex =
      envelope === null ? -1 : DayOffset.indexAt(envelope.endMs, days);
    const todayIndex = DayOffset.indexAt(nowMs, days);
    const reopened = AppointmentLifecycleSystem.reopenSettledSlice(
      {
        status: appointment.bookingStatus,
        outcomes: outcomesOf(appointment.seats),
      },
      visitIndex < 0 ? null : (days[visitIndex] as DayOffset).dayKey,
      todayIndex < 0 ? null : (days[todayIndex] as DayOffset).dayKey,
      nowMs,
    );
    return reopened.ok
      ? Result.ok(applySlice(appointment, reopened.value))
      : reopened;
  },

  /** {@link seatOutcomeSlice} over the entity, by seat id. */
  markSeatOutcome(
    appointment: AppointmentEntity,
    seatId: SeatId,
    outcome: SeatOutcome,
    nowMs: number,
  ): Result<AppointmentEntity, SchedulingError> {
    const resolved = AppointmentLifecycleSystem.seatOutcomeSlice(
      {
        status: appointment.bookingStatus,
        outcomes: outcomesOf(appointment.seats),
      },
      indexOfSeat(appointment.seats, seatId),
      seatId,
      outcome,
      nowMs,
    );
    return resolved.ok
      ? Result.ok(applySlice(appointment, resolved.value))
      : resolved;
  },

  /**
   * Is a reinstated cancellation's chair still free? The cancel gave its
   * time away and the waitlist may have taken it: `others` are the live
   * appointments sharing a busy key; any of their open seats on the same
   * barber overlapping one of ours means the answer is honestly "taken".
   */
  takenSince(
    appointment: AppointmentEntity,
    others: readonly AppointmentEntity[],
  ): boolean {
    for (let o = 0; o < others.length; o++) {
      const other = others[o] as AppointmentEntity;
      if (
        other.id === appointment.id ||
        !BookingStatus.isLive(other.bookingStatus)
      ) {
        continue;
      }
      for (let s = 0; s < other.seats.length; s++) {
        const theirs = other.seats[s] as Seat;
        if (SeatOutcome.isResolved(theirs.outcome)) continue;
        for (let m = 0; m < appointment.seats.length; m++) {
          if (Seat.collidesWith(appointment.seats[m] as Seat, theirs)) {
            return true;
          }
        }
      }
    }
    return false;
  },

  /**
   * Record that the party walked in. Idempotent on purpose: the first stamp
   * is the true one, so a second tap changes nothing and audits nothing. A
   * settled visit refuses — arriving after it is not a fact, it is a mis-tap.
   */
  markArrived(
    appointment: AppointmentEntity,
    nowMs: number,
  ): Result<LifecycleStep, SchedulingError> {
    if (!BookingStatus.isLive(appointment.bookingStatus)) {
      return Result.err(
        SchedulingError.appointmentNotArrivable(appointment.bookingStatus.kind),
      );
    }
    if (appointment.arrivedAtMs !== null) {
      return Result.ok({ appointment, auditFacts: [] });
    }
    return Result.ok({
      appointment: { ...appointment, arrivedAtMs: nowMs },
      auditFacts: [
        {
          action: AuditAction.BookingStaffArrived,
          resourceId: appointment.id,
          subjects: AuditSystem.subjectsOf(appointment),
          changeKey: AuditSystem.changeKey.arrived(nowMs),
          context: AuditContext.arrival(AuditAction.BookingStaffArrived),
        },
      ],
    });
  },

  /**
   * The arrival stamp taken back — same gate as setting it. Clearing what
   * was never set is a no-op, not an error: the undo may outlive a second tap.
   */
  clearArrival(
    appointment: AppointmentEntity,
  ): Result<LifecycleStep, SchedulingError> {
    if (!BookingStatus.isLive(appointment.bookingStatus)) {
      return Result.err(
        SchedulingError.appointmentNotArrivable(appointment.bookingStatus.kind),
      );
    }
    const stamp = appointment.arrivedAtMs;
    if (stamp === null) return Result.ok({ appointment, auditFacts: [] });
    return Result.ok({
      appointment: { ...appointment, arrivedAtMs: null },
      auditFacts: [
        {
          action: AuditAction.BookingStaffUnarrived,
          resourceId: appointment.id,
          subjects: AuditSystem.subjectsOf(appointment),
          changeKey: AuditSystem.changeKey.unarrived(stamp),
          context: AuditContext.arrival(AuditAction.BookingStaffUnarrived),
        },
      ],
    });
  },

  /* ── The party's invariants ────────────────────────────────────────── */

  /**
   * What is wrong with a set of seats, every violation (`validateSeats`):
   * none at all; ONE PERSON IN TWO CHAIRS (overlapping `self` seats of one
   * ACCOUNT — sequential self seats are one visit with two services, and a
   * `self` seat bound to another account is somebody else); a barber in two
   * chairs at once, named ONCE per barber in discovery order; seats priced
   * in two currencies (the first mismatch).
   */
  seatViolations(seats: readonly Seat[]): readonly SchedulingError[] {
    return Seat.violations(seats);
  },

  /**
   * A NEW visit's admission (`Appointment.create`): it must begin in the
   * future — judged on the EARLIEST seat, a past start refused alone — and
   * then its seats must hold every invariant of {@link seatViolations}.
   */
  admit(seats: readonly Seat[], nowMs: number): readonly SchedulingError[] {
    const envelope = AppointmentIndexSystem.envelope({ seats });
    if (envelope !== null && envelope.startMs <= nowMs) {
      return [SchedulingError.appointmentPastStartTime()];
    }
    return AppointmentLifecycleSystem.seatViolations(seats);
  },

  /* ── Derived facts ─────────────────────────────────────────────────── */

  /** Every seat whose story the shop has not told yet, in seat order. */
  openSeats(appointment: AppointmentEntity): readonly Seat[] {
    const open: Seat[] = [];
    for (let i = 0; i < appointment.seats.length; i++) {
      const seat = appointment.seats[i] as Seat;
      if (!SeatOutcome.isResolved(seat.outcome)) open.push(seat);
    }
    return open;
  },

  /**
   * How late the party was, in minutes — negative when early. `null` when
   * they have not arrived, which is NOT zero and never averaged as punctual.
   */
  latenessMinutes(appointment: AppointmentEntity): number | null {
    const envelope = AppointmentIndexSystem.envelope(appointment);
    if (appointment.arrivedAtMs === null || envelope === null) return null;
    return (appointment.arrivedAtMs - envelope.startMs) / MS_PER_MINUTE;
  },

  /**
   * How far ahead the booking was made, in minutes — `null` for a visit
   * written before the stamp, excluded from lead-time statistics.
   */
  bookingLeadTimeMinutes(appointment: AppointmentEntity): number | null {
    const envelope = AppointmentIndexSystem.envelope(appointment);
    if (appointment.bookedAtMs === null || envelope === null) return null;
    return (envelope.startMs - appointment.bookedAtMs) / MS_PER_MINUTE;
  },
} as const;
