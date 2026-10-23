import {
  AuditAction,
  AuditContext,
  type TransitionAction,
  BookingLifecycle,
  CancellationReason,
  CancellationReasonSet,
  CancelledBy,
  SeatOutcome,
  type AccountSeat,
  type ChairGeometry,
  Seat,
  type ShopNow,
  type TimeCoordinate,
  WriteOp,
} from '@core/components';
import {
  BookingStatus,
  Result,
  AttendanceState,
  AuditResourceId,
  type SeatId,
  type LocalDate,
  UtcEpochMs,
} from '@core/primitives';
import { SchedulingError } from '@core/errors';
import { type Appointment, Collections } from '@core/entities';
import { AppointmentIndexSystem } from './appointment-index.system';
import { type AuditFact, AuditSystem } from './audit.system';
import { CancellationPolicySystem } from './cancellation-policy.system';

const MS_PER_MINUTE = 60_000;

/**
 * What a lifecycle verb hands its pipeline: the appointment as the verb
 * leaves it, the audit facts of the act (`[]` for a verb that changed
 * nothing — a second arrival tap writes neither a stamp nor a row), and the
 * write plan that commits it (`[]` likewise): one root-field update that sets
 * the new lifecycle variant and deletes the old one's fields
 * (`WriteOp.transition` + `WriteOp.variantFieldsToDelete`, §6).
 */
export type LifecycleStep = {
  readonly appointment: Appointment;
  readonly auditFacts: readonly AuditFact[];
  readonly writes: readonly WriteOp[];
};

/**
 * The slice every lifecycle verb reads and writes: the root lifecycle and
 * the seats' outcomes, index-aligned with the seats. The verbs below are
 * total on this slice alone, so a caller holding no entity (a legacy shim)
 * asks the same questions and gets the same answers.
 */
export type LifecycleSlice = {
  readonly lifecycle: BookingLifecycle;
  readonly outcomes: readonly SeatOutcome[];
};

/**
 * A staff lifecycle request (`transition-appointment.ts`): the target state,
 * ONE seat or the whole party (`seatId: null`), and — for a cancel only —
 * the reason code and the window in force (`null` when the policy could not
 * be read: the seats are stamped unknown, the shop's cancel still lands).
 */
export type LifecycleTransitionRequest = {
  readonly to: BookingStatus;
  readonly seatId: SeatId | null;
  readonly reason: CancellationReason | null;
  readonly windowHours: number | null;
};

/** The staff verb each target state is audited under. */
const STAFF_VERB: { readonly [S in BookingStatus]: TransitionAction | null } = {
  [BookingStatus.Pending]: null,
  [BookingStatus.Confirmed]: AuditAction.BookingStaffConfirmed,
  [BookingStatus.Completed]: AuditAction.BookingStaffCompleted,
  [BookingStatus.NoShow]: AuditAction.BookingStaffNoShow,
  [BookingStatus.Cancelled]: AuditAction.BookingStaffCancelled,
};

/** The root lifecycle a party verb lands in, stamped `atUtcMs`. */
function lifecycleFor(
  to: BookingStatus,
  atUtcMs: UtcEpochMs,
  cancelReasons: CancellationReasonSet,
): BookingLifecycle {
  switch (to) {
    case BookingStatus.Pending:
      return BookingLifecycle.pending(atUtcMs);
    case BookingStatus.Confirmed:
      return BookingLifecycle.confirm(atUtcMs);
    case BookingStatus.Completed:
      return BookingLifecycle.complete(atUtcMs);
    case BookingStatus.NoShow:
      return BookingLifecycle.noShow(atUtcMs);
    default:
      return BookingLifecycle.cancel(atUtcMs, cancelReasons);
  }
}

/** The state a seat outcome speaks for — what a refusal names as the target. */
function stateOfOutcome(state: AttendanceState): BookingStatus {
  switch (state) {
    case AttendanceState.Worked:
      return BookingStatus.Completed;
    case AttendanceState.NoShow:
      return BookingStatus.NoShow;
    case AttendanceState.Cancelled:
      return BookingStatus.Cancelled;
    default:
      return BookingStatus.Confirmed;
  }
}

function sliceOf(appointment: Appointment): LifecycleSlice {
  const outcomes: SeatOutcome[] = [];
  for (let i = 0; i < appointment.seats.length; i++) {
    outcomes.push(appointment.seats[i] as Seat);
  }
  return { lifecycle: appointment, outcomes };
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
    out.push(outcome === seat ? seat : Seat.withOutcome(seat, outcome));
  }
  return out;
}

/** The appointment with a new lifecycle variant — the old variant's fields gone. */
function withLifecycle(
  appointment: Appointment,
  lifecycle: BookingLifecycle,
  seats: readonly Seat[],
  arrivedAtUtcMs: UtcEpochMs | null,
): Appointment {
  return {
    id: appointment.id,
    locationId: appointment.locationId,
    ownerUserId: appointment.ownerUserId,
    subjectUserIds: appointment.subjectUserIds,
    ownerCustomerId: appointment.ownerCustomerId,
    subjectCustomerIds: appointment.subjectCustomerIds,
    placement: appointment.placement,
    inferredPlacement: appointment.inferredPlacement,
    barberIds: appointment.barberIds,
    busyKeys: appointment.busyKeys,
    seats,
    bookedFromAppointmentId: appointment.bookedFromAppointmentId,
    discounts: appointment.discounts,
    voucherRedemptions: appointment.voucherRedemptions,
    revision: appointment.revision,
    appliedOperations: appointment.appliedOperations,
    localDate: appointment.localDate,
    startMinutes: appointment.startMinutes,
    endMinutes: appointment.endMinutes,
    utcEpochMs: appointment.utcEpochMs,
    contactName: appointment.contactName,
    contactPhone: appointment.contactPhone,
    contactEmail: appointment.contactEmail,
    contactNote: appointment.contactNote,
    bookedAtUtcMs: appointment.bookedAtUtcMs,
    arrivedAtUtcMs,
    stoodSeatPairsRevision: appointment.stoodSeatPairsRevision,
    stoodSeatPairs: appointment.stoodSeatPairs,
    ...BookingLifecycle.sliceOf(lifecycle),
  };
}

function applySlice(
  appointment: Appointment,
  slice: LifecycleSlice,
): Appointment {
  return withLifecycle(
    appointment,
    slice.lifecycle,
    withOutcomes(appointment.seats, slice.outcomes),
    appointment.arrivedAtUtcMs,
  );
}

/**
 * The write plan of a lifecycle step: ONE update of the appointment's root —
 * every field of the new lifecycle variant, the seats (their outcomes) and
 * the arrival stamp set; every field of the old variant the new one does not
 * declare deleted, so the stored document is always exactly one variant.
 */
function transitionWrite(before: Appointment, after: Appointment): WriteOp {
  const from = BookingLifecycle.sliceOf(before);
  const to = BookingLifecycle.sliceOf(after);
  return WriteOp.transition(
    [Collections.Appointments, after.id],
    { ...to, seats: after.seats, arrivedAtUtcMs: after.arrivedAtUtcMs },
    WriteOp.variantFieldsToDelete(from, to),
  );
}

function step(
  before: Appointment,
  after: Appointment,
  auditFacts: readonly AuditFact[],
): LifecycleStep {
  return {
    appointment: after,
    auditFacts,
    writes: [transitionWrite(before, after)],
  };
}

function indexOfSeat(seats: readonly Seat[], seatId: SeatId): number {
  for (let i = 0; i < seats.length; i++) {
    if ((seats[i] as Seat).seatId === seatId) return i;
  }
  return -1;
}

function staffFact(
  appointment: Appointment,
  action: TransitionAction,
  reason: CancellationReason | null,
  seatId: SeatId | null,
  nowUtcMs: UtcEpochMs,
): AuditFact {
  return {
    resourceId: AuditResourceId.forAppointment(appointment.id),
    subjects: AuditSystem.subjectsOfSeats(appointment.seats, seatId),
    changeKey: AuditSystem.changeKey.transition(seatId, nowUtcMs),
    context: AuditContext.transition(action, reason, seatId),
  };
}

function arrivalFact(
  appointment: Appointment,
  action:
    | typeof AuditAction.BookingStaffArrived
    | typeof AuditAction.BookingStaffUnarrived,
  changeKey: string,
): AuditFact {
  return {
    resourceId: AuditResourceId.forAppointment(appointment.id),
    subjects: AuditSystem.subjectsOf(appointment),
    changeKey,
    context: AuditContext.arrival(action),
  };
}

/**
 * The staff transition at `nowUtcMs` with `today` the shop's day — `null` is
 * a day the caller could not resolve (a party verb with no shop clock),
 * which is never "the visit's own day", so a settled visit stays settled.
 */
function transitionAt(
  appointment: Appointment,
  request: LifecycleTransitionRequest,
  nowUtcMs: UtcEpochMs,
  today: LocalDate | null,
): Result<LifecycleStep, SchedulingError> {
  const slice = sliceOf(appointment);
  const to = request.to;
  const from = appointment.bookingStatus;
  const verb = STAFF_VERB[to];
  if (verb === null) {
    return Result.err(SchedulingError.appointmentInvalidTransition(from, to));
  }
  const reason = to === BookingStatus.Cancelled ? request.reason : null;
  if (to === BookingStatus.Cancelled && reason === null) {
    return Result.err(SchedulingError.appointmentEmptyCancellationReason());
  }
  const stamp = SeatOutcome.outcomeForStatus(
    to,
    nowUtcMs,
    reason ?? CancellationReason.Unspecified,
    request.windowHours,
  );

  if (request.seatId !== null) {
    const index = indexOfSeat(appointment.seats, request.seatId);
    if (index < 0) {
      return Result.err(SchedulingError.appointmentUnknownSeat(request.seatId));
    }
    if (stamp === null) {
      // Confirming says nothing about the work: no per-seat meaning.
      return Result.err(SchedulingError.appointmentInvalidTransition(from, to));
    }
    const resolved = AppointmentLifecycleSystem.seatOutcomeSlice(
      slice,
      index,
      request.seatId,
      stamp,
      nowUtcMs,
    );
    if (!resolved.ok) return resolved;
    return Result.ok(
      step(appointment, applySlice(appointment, resolved.value), [
        staffFact(appointment, verb, reason, request.seatId, nowUtcMs),
      ]),
    );
  }

  if (
    to === BookingStatus.Confirmed &&
    (from === BookingStatus.Completed || from === BookingStatus.Cancelled)
  ) {
    const reopened = reopenSettledAt(appointment, nowUtcMs, today);
    if (!reopened.ok) return reopened;
    return Result.ok(
      step(appointment, reopened.value, [
        staffFact(
          appointment,
          from === BookingStatus.Completed
            ? AuditAction.BookingStaffReopenCompleted
            : AuditAction.BookingStaffReinstate,
          null,
          null,
          nowUtcMs,
        ),
      ]),
    );
  }
  if (to === BookingStatus.Confirmed && from === BookingStatus.NoShow) {
    const reopened = AppointmentLifecycleSystem.reopenNoShowSlice(
      slice,
      nowUtcMs,
    );
    if (!reopened.ok) return reopened;
    return Result.ok(
      step(appointment, applySlice(appointment, reopened.value), [
        staffFact(
          appointment,
          AuditAction.BookingStaffReopenNoShow,
          null,
          null,
          nowUtcMs,
        ),
      ]),
    );
  }
  const moved = AppointmentLifecycleSystem.partyVerb(
    slice,
    to,
    stamp,
    nowUtcMs,
    CancellationReasonSet.of(reason === null ? [] : [reason]),
  );
  if (!moved.ok) return moved;
  return Result.ok(
    step(appointment, applySlice(appointment, moved.value), [
      staffFact(appointment, verb, reason, null, nowUtcMs),
    ]),
  );
}

/**
 * {@link AppointmentLifecycleSystem.reopenSettledSlice} over the entity —
 * the visit's day is its `localDate` (one shop day per appointment, F-6; a
 * visit with no seat has no day), today the caller's.
 */
function reopenSettledAt(
  appointment: Appointment,
  nowUtcMs: UtcEpochMs,
  today: LocalDate | null,
): Result<Appointment, SchedulingError> {
  const reopened = AppointmentLifecycleSystem.reopenSettledSlice(
    sliceOf(appointment),
    appointment.seats.length === 0 ? null : appointment.localDate,
    today,
    nowUtcMs,
  );
  return reopened.ok
    ? Result.ok(applySlice(appointment, reopened.value))
    : reopened;
}

/**
 * An appointment's life — `appointment.ts:234-593` and the staff and client
 * verbs that drive it (`transition-appointment.ts`, `cancel-appointment.ts`,
 * `mark-arrived.ts`, `clear-arrival.ts`). The graph is
 * `BookingLifecycle.canTransition`, never re-encoded; seat outcomes roll up
 * through `SeatOutcome.summarize`. Every verb returns a NEW entity, the audit
 * facts of the act and its write plan. Stamping verbs take `nowUtcMs` (a
 * lifecycle instant, T4); the ones that ask "is it today" take the shop's
 * `ShopNow` and compare on its `localDate` (T1).
 *
 * No version CAS: neither the cancel nor the transition callable carries
 * one (§4.1).
 */
export const AppointmentLifecycleSystem = {
  /* ── The slice verbs ───────────────────────────────────────────────── */

  /**
   * A party-level move `lifecycle → to`, stamping `stamp` on every seat
   * still open; a seat already resolved — the guest who no-showed while the
   * other two were cut — keeps what it was given. `stamp` is `null` for a
   * verb that says nothing about the work (confirm). `cancelReasons` is the
   * root's reason set, read only when `to` is `CANCELLED`.
   */
  partyVerb(
    slice: LifecycleSlice,
    to: BookingStatus,
    stamp: SeatOutcome | null,
    atUtcMs: UtcEpochMs,
    cancelReasons: CancellationReasonSet,
  ): Result<LifecycleSlice, SchedulingError> {
    if (!BookingLifecycle.canTransition(slice.lifecycle, to)) {
      return Result.err(
        SchedulingError.appointmentInvalidTransition(
          slice.lifecycle.bookingStatus,
          to,
        ),
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
    return Result.ok({
      lifecycle: lifecycleFor(to, atUtcMs, cancelReasons),
      outcomes,
    });
  },

  /**
   * The ONE correction edge of the graph: a no-show taken back. Only the
   * stamp the edge put there is lifted — `NO_SHOW` seats return to
   * `SCHEDULED`; a seat resolved on its own before the party mark keeps what
   * it was given. Exactly one legal starting point: `NO_SHOW` (the graph
   * alone would also let `PENDING` through).
   */
  reopenNoShowSlice(
    slice: LifecycleSlice,
    atUtcMs: UtcEpochMs,
  ): Result<LifecycleSlice, SchedulingError> {
    const from = slice.lifecycle.bookingStatus;
    if (from !== BookingStatus.NoShow) {
      return Result.err(
        SchedulingError.appointmentInvalidTransition(
          from,
          BookingStatus.Confirmed,
        ),
      );
    }
    const outcomes: SeatOutcome[] = [];
    for (let i = 0; i < slice.outcomes.length; i++) {
      const outcome = slice.outcomes[i] as SeatOutcome;
      outcomes.push(
        outcome.attendanceState === AttendanceState.NoShow
          ? SeatOutcome.scheduled()
          : outcome,
      );
    }
    return Result.ok({
      lifecycle: BookingLifecycle.confirm(atUtcMs),
      outcomes,
    });
  },

  /**
   * The same-day correction edge (owner ruling 2026-09-08): a completed or
   * cancelled visit comes back to `CONFIRMED`, every settled seat to
   * `SCHEDULED` — but only while the shop is inside the visit's own day
   * (`visitLocalDate` against `today`, both on the shop's wall clock, T1).
   * `null` is a day the caller could not resolve, which is never "the same
   * day".
   */
  reopenSettledSlice(
    slice: LifecycleSlice,
    visitLocalDate: LocalDate | null,
    today: LocalDate | null,
    atUtcMs: UtcEpochMs,
  ): Result<LifecycleSlice, SchedulingError> {
    const from = slice.lifecycle.bookingStatus;
    if (from !== BookingStatus.Completed && from !== BookingStatus.Cancelled) {
      return Result.err(
        SchedulingError.appointmentInvalidTransition(
          from,
          BookingStatus.Confirmed,
        ),
      );
    }
    if (visitLocalDate === null || today === null || visitLocalDate !== today) {
      return Result.err(SchedulingError.appointmentReopenWindowClosed(from));
    }
    const outcomes: SeatOutcome[] = [];
    for (let i = 0; i < slice.outcomes.length; i++) {
      const outcome = slice.outcomes[i] as SeatOutcome;
      outcomes.push(
        outcome.attendanceState === AttendanceState.Scheduled
          ? outcome
          : SeatOutcome.scheduled(),
      );
    }
    return Result.ok({
      lifecycle: BookingLifecycle.confirm(atUtcMs),
      outcomes,
    });
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
    seatId: SeatId,
    outcome: SeatOutcome,
    atUtcMs: UtcEpochMs,
  ): Result<LifecycleSlice, SchedulingError> {
    if (index < 0 || index >= slice.outcomes.length) {
      return Result.err(SchedulingError.appointmentUnknownSeat(seatId));
    }
    const current = slice.outcomes[index] as SeatOutcome;
    if (SeatOutcome.isResolved(current)) {
      return Result.err(
        SchedulingError.appointmentSeatAlreadyResolved(
          seatId,
          current.attendanceState,
        ),
      );
    }
    if (BookingLifecycle.isTerminal(slice.lifecycle)) {
      return Result.err(
        SchedulingError.appointmentInvalidTransition(
          slice.lifecycle.bookingStatus,
          stateOfOutcome(outcome.attendanceState),
        ),
      );
    }
    const outcomes: SeatOutcome[] = [];
    for (let i = 0; i < slice.outcomes.length; i++) {
      outcomes.push(i === index ? outcome : (slice.outcomes[i] as SeatOutcome));
    }
    return Result.ok({
      lifecycle: SeatOutcome.summarize(outcomes, slice.lifecycle, atUtcMs),
      outcomes,
    });
  },

  /* ── The entity verbs ──────────────────────────────────────────────── */

  /**
   * Confirming is about the BOOKING, not the work — no seat is resolved. A
   * settled visit is not reopened here (no shop clock: never "today").
   */
  confirm(
    appointment: Appointment,
    nowUtcMs: UtcEpochMs,
  ): Result<LifecycleStep, SchedulingError> {
    return transitionAt(
      appointment,
      {
        to: BookingStatus.Confirmed,
        seatId: null,
        reason: null,
        windowHours: null,
      },
      nowUtcMs,
      null,
    );
  },

  /** The whole party was served: every open seat `WORKED`, resolved seats untouched. */
  complete(
    appointment: Appointment,
    nowUtcMs: UtcEpochMs,
  ): Result<LifecycleStep, SchedulingError> {
    return transitionAt(
      appointment,
      {
        to: BookingStatus.Completed,
        seatId: null,
        reason: null,
        windowHours: null,
      },
      nowUtcMs,
      null,
    );
  },

  /** Nobody came — the same fan-out rule as {@link complete}. */
  markNoShow(
    appointment: Appointment,
    nowUtcMs: UtcEpochMs,
  ): Result<LifecycleStep, SchedulingError> {
    return transitionAt(
      appointment,
      {
        to: BookingStatus.NoShow,
        seatId: null,
        reason: null,
        windowHours: null,
      },
      nowUtcMs,
      null,
    );
  },

  /**
   * The shop calls the whole party off — `reason` filed on every seat it
   * closes, with the window in force (`null` unknown), and the root
   * carrying the code. A seat called off earlier keeps its own stamp.
   */
  cancel(
    appointment: Appointment,
    reason: CancellationReason,
    windowHours: number | null,
    nowUtcMs: UtcEpochMs,
  ): Result<LifecycleStep, SchedulingError> {
    return transitionAt(
      appointment,
      { to: BookingStatus.Cancelled, seatId: null, reason, windowHours },
      nowUtcMs,
      null,
    );
  },

  /**
   * The client's own cancel (`cancel-appointment.ts:180-219`): every open
   * seat cancelled BY THE CLIENT under the window it was allowed under, the
   * root carrying the code, one `BOOKING_CANCELLED` fact for everyone on the
   * visit keyed by the instant it stamped. Whether the client MAY cancel is
   * `CancellationPolicySystem.mayCancel`, asked first.
   */
  cancelByClient(
    appointment: Appointment,
    reason: CancellationReason,
    windowHours: number | null,
    nowUtcMs: UtcEpochMs,
  ): Result<LifecycleStep, SchedulingError> {
    const stamp = SeatOutcome.cancelled(
      nowUtcMs,
      CancelledBy.Client,
      reason,
      windowHours,
    );
    const moved = AppointmentLifecycleSystem.partyVerb(
      sliceOf(appointment),
      BookingStatus.Cancelled,
      stamp,
      nowUtcMs,
      CancellationReasonSet.of([reason]),
    );
    if (!moved.ok) return moved;
    return Result.ok(
      step(appointment, applySlice(appointment, moved.value), [
        {
          resourceId: AuditResourceId.forAppointment(appointment.id),
          subjects: AuditSystem.subjectsOf(appointment),
          changeKey: AuditSystem.changeKey.cancelled(nowUtcMs),
          context: AuditContext.cancelled(reason),
        },
      ]),
    );
  },

  /**
   * The staff transition callable's whole decision (`transition-appointment.ts`):
   * ONE seat resolved (`seatId`), or the party moved — through the graph, or
   * through one of the correction edges: `NO_SHOW → CONFIRMED` lifts the
   * stamp; `COMPLETED`/`CANCELLED → CONFIRMED` reopens on the visit's own
   * day only (`now.localDate` against the visit's `localDate`). The audit
   * fact names the verb — a correction under its own action — the reason
   * CODE, the seat, and keys the change by the seat and `now.utcEpochMs`.
   */
  transition(
    appointment: Appointment,
    request: LifecycleTransitionRequest,
    now: ShopNow,
  ): Result<LifecycleStep, SchedulingError> {
    return transitionAt(appointment, request, now.utcEpochMs, now.localDate);
  },

  /** {@link reopenNoShowSlice} over the entity. */
  reopenNoShow(
    appointment: Appointment,
    nowUtcMs: UtcEpochMs,
  ): Result<Appointment, SchedulingError> {
    const reopened = AppointmentLifecycleSystem.reopenNoShowSlice(
      sliceOf(appointment),
      nowUtcMs,
    );
    return reopened.ok
      ? Result.ok(applySlice(appointment, reopened.value))
      : reopened;
  },

  /**
   * {@link reopenSettledSlice} over the entity — the visit's day is its
   * `localDate`, today the shop's (`now.localDate`); no zone math here.
   */
  reopenSettled(
    appointment: Appointment,
    now: ShopNow,
  ): Result<Appointment, SchedulingError> {
    return reopenSettledAt(appointment, now.utcEpochMs, now.localDate);
  },

  /** {@link seatOutcomeSlice} over the entity, by seat id. */
  markSeatOutcome(
    appointment: Appointment,
    seatId: SeatId,
    outcome: SeatOutcome,
    nowUtcMs: UtcEpochMs,
  ): Result<Appointment, SchedulingError> {
    const resolved = AppointmentLifecycleSystem.seatOutcomeSlice(
      sliceOf(appointment),
      indexOfSeat(appointment.seats, seatId),
      seatId,
      outcome,
      nowUtcMs,
    );
    return resolved.ok
      ? Result.ok(applySlice(appointment, resolved.value))
      : resolved;
  },

  /**
   * Is a reinstated cancellation's chair still free? The cancel gave its
   * time away and the waitlist may have taken it: `others` are the live
   * appointments sharing a busy key; any of their open seats on the same
   * barber overlapping one of ours — on the same shop day — means the answer
   * is honestly "taken".
   */
  takenSince(
    appointment: Appointment,
    others: readonly Appointment[],
  ): boolean {
    for (let o = 0; o < others.length; o++) {
      const other = others[o] as Appointment;
      if (
        other.id === appointment.id ||
        other.localDate !== appointment.localDate ||
        !BookingLifecycle.isLive(other)
      ) {
        continue;
      }
      for (let s = 0; s < other.seats.length; s++) {
        const theirs = other.seats[s] as Seat;
        if (SeatOutcome.isResolved(theirs)) continue;
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
    appointment: Appointment,
    nowUtcMs: UtcEpochMs,
  ): Result<LifecycleStep, SchedulingError> {
    if (!BookingLifecycle.isLive(appointment)) {
      return Result.err(
        SchedulingError.appointmentNotArrivable(appointment.bookingStatus),
      );
    }
    if (appointment.arrivedAtUtcMs !== null) {
      return Result.ok({ appointment, auditFacts: [], writes: [] });
    }
    const arrived = withLifecycle(
      appointment,
      appointment,
      appointment.seats,
      nowUtcMs,
    );
    return Result.ok(
      step(appointment, arrived, [
        arrivalFact(
          appointment,
          AuditAction.BookingStaffArrived,
          AuditSystem.changeKey.arrived(nowUtcMs),
        ),
      ]),
    );
  },

  /**
   * The arrival stamp taken back — same gate as setting it. Clearing what
   * was never set is a no-op, not an error: the undo may outlive a second tap.
   */
  clearArrival(
    appointment: Appointment,
  ): Result<LifecycleStep, SchedulingError> {
    if (!BookingLifecycle.isLive(appointment)) {
      return Result.err(
        SchedulingError.appointmentNotArrivable(appointment.bookingStatus),
      );
    }
    const stamp = appointment.arrivedAtUtcMs;
    if (stamp === null) {
      return Result.ok({ appointment, auditFacts: [], writes: [] });
    }
    const cleared = withLifecycle(
      appointment,
      appointment,
      appointment.seats,
      null,
    );
    return Result.ok(
      step(appointment, cleared, [
        arrivalFact(
          appointment,
          AuditAction.BookingStaffUnarrived,
          AuditSystem.changeKey.unarrived(stamp),
        ),
      ]),
    );
  },

  /** The write plan of moving `before` to `after` — see {@link LifecycleStep}. */
  transitionWrite,

  /* ── The party's invariants ────────────────────────────────────────── */

  /**
   * What is wrong with a set of seats, every violation (`validateSeats`):
   * none at all; ONE PERSON IN TWO CHAIRS (overlapping `SELF` seats of one
   * ACCOUNT — sequential self seats are one visit with two services, and a
   * `SELF` seat bound to another account is somebody else); a barber in two
   * chairs at once, named ONCE per barber in discovery order; seats priced
   * in two currencies (the first mismatch).
   */
  seatViolations(seats: readonly AccountSeat[]): readonly SchedulingError[] {
    return Seat.violations(seats);
  },

  /**
   * A NEW visit's admission (`Appointment.create`): it must begin in the
   * future — judged on the EARLIEST seat on the shop's wall clock, a start at
   * or before `(now.localDate, now.currentMinute)` refused alone (T1) — and
   * then its seats must hold every invariant of {@link seatViolations}.
   */
  admit(
    visit: {
      readonly localDate: LocalDate;
      readonly seats: readonly AccountSeat[];
    },
    now: ShopNow,
  ): readonly SchedulingError[] {
    const envelope = AppointmentIndexSystem.envelope(visit);
    if (
      envelope !== null &&
      (visit.localDate < now.localDate ||
        (visit.localDate === now.localDate &&
          envelope.startMinutes <= now.currentMinute))
    ) {
      return [SchedulingError.appointmentPastStartTime()];
    }
    return AppointmentLifecycleSystem.seatViolations(visit.seats);
  },

  /* ── Derived facts ─────────────────────────────────────────────────── */

  /** Every seat whose story the shop has not told yet, in seat order. */
  openSeats(appointment: Pick<Appointment, 'seats'>): readonly Seat[] {
    const open: Seat[] = [];
    for (let i = 0; i < appointment.seats.length; i++) {
      const seat = appointment.seats[i] as Seat;
      if (!SeatOutcome.isResolved(seat)) open.push(seat);
    }
    return open;
  },

  /**
   * How late the party was, in minutes — negative when early. `null` when
   * they have not arrived, which is NOT zero and never averaged as punctual.
   * Elapsed time between two instants (a T2 statistic, G-1).
   */
  latenessMinutes(
    appointment: Pick<Appointment, 'arrivedAtUtcMs'> &
      TimeCoordinate & { readonly seats: readonly ChairGeometry[] },
  ): number | null {
    if (appointment.arrivedAtUtcMs === null || appointment.seats.length === 0) {
      return null;
    }
    const startUtcMs = CancellationPolicySystem.startUtcMsOf(appointment);
    return (
      UtcEpochMs.elapsedMs(startUtcMs, appointment.arrivedAtUtcMs) /
      MS_PER_MINUTE
    );
  },

  /**
   * How far ahead the booking was made, in minutes — `null` for a visit
   * written before the stamp, excluded from lead-time statistics (a T2
   * statistic, G-1).
   */
  bookingLeadTimeMinutes(
    appointment: Pick<Appointment, 'bookedAtUtcMs'> &
      TimeCoordinate & { readonly seats: readonly ChairGeometry[] },
  ): number | null {
    if (appointment.bookedAtUtcMs === null || appointment.seats.length === 0) {
      return null;
    }
    const startUtcMs = CancellationPolicySystem.startUtcMsOf(appointment);
    return (
      UtcEpochMs.elapsedMs(appointment.bookedAtUtcMs, startUtcMs) /
      MS_PER_MINUTE
    );
  },
} as const;
