import {
  ArrivalVerb,
  AuditAction,
  AuditContext,
  type TransitionAction,
  BookingLifecycle,
  CancellationReason,
  CancellationReasonSet,
  CancelledBy,
  SeatOutcome,
  Seat,
  type ShopNow,
  type StaffVerb,
  WriteOp,
} from '@core/components';
import {
  BookingStatus,
  Result,
  AttendanceState,
  AuditResourceId,
  type HourCount,
  type OperationId,
  type SeatId,
  type LocalDate,
  type UtcEpochMs,
} from '@core/primitives';
import { SchedulingError } from '@core/errors';
import { type Appointment, Collections } from '@core/entities';
import { type AuditFact, AuditSystem } from './audit.system';

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
 * The slice every lifecycle verb decides on: the root lifecycle and the
 * seats' outcomes, index-aligned with the seats. The slice verbs below are
 * total on it; the entity verbs of {@link AppointmentLifecycleSystem} read
 * it off the appointment and write the answer back.
 */
type LifecycleSlice = {
  readonly lifecycle: BookingLifecycle;
  readonly outcomes: readonly SeatOutcome[];
};

/**
 * A staff lifecycle request (`transition-appointment.ts`): the target state,
 * ONE seat or the whole party (`seatId: null`), — for a cancel only — the
 * reason code and the window in force (`null` when the policy could not be
 * read: the seats are stamped unknown, the shop's cancel still lands), and
 * the act's operation id, which keys its audit fact (WS-1).
 */
export type LifecycleTransitionRequest = {
  readonly to: BookingStatus;
  readonly seatId: SeatId | null;
  readonly reason: CancellationReason | null;
  readonly windowHours: HourCount | null;
  readonly operationId: OperationId;
};

/**
 * A move as the legality predicates read it — its target and its scope (one
 * seat, or the whole party at `null`). A {@link LifecycleTransitionRequest}
 * and the transition callable's command both pass straight in.
 */
type LifecycleMove = {
  readonly to: BookingStatus;
  readonly seatId: SeatId | null;
};

/**
 * What the sheet's exits are made of (`exitVerbs`): the lifecycle verbs it
 * lists, in order; whether it offers the next visit; whether the cancel —
 * drawn last, apart from the list — is on offer.
 */
export type ExitVerbs = {
  readonly verbs: readonly StaffVerb[];
  readonly rebook: boolean;
  readonly cancel: boolean;
};

/** The verbs a staff sheet OFFERS, in the order a shop reaches for them. */
const OFFERED_VERBS: readonly BookingStatus[] = [
  BookingStatus.Confirmed,
  BookingStatus.Completed,
  BookingStatus.NoShow,
  BookingStatus.Cancelled,
];

/**
 * May a settled root come back to `CONFIRMED` — the same-day correction
 * edge (owner ruling 2026-09-08)? A completed or cancelled ROOT, and the
 * shop still inside the visit's own day (`visitLocalDate` against `today`,
 * both on the shop's wall clock, T1); `null` is a day the caller could not
 * resolve, which is never "the same day". The ONE guard: the write path
 * ({@link reopenSettledSlice}) and the offered verbs (`offeredVerbs`) both
 * read it.
 */
function reopenable(
  rootStatus: BookingStatus,
  visitLocalDate: LocalDate | null,
  today: LocalDate | null,
): boolean {
  return (
    (rootStatus === BookingStatus.Completed ||
      rootStatus === BookingStatus.Cancelled) &&
    visitLocalDate !== null &&
    today !== null &&
    visitLocalDate === today
  );
}

/**
 * Does this move reopen a settled visit — a PARTY move to `CONFIRMED` from
 * `COMPLETED` or `CANCELLED`? The one verb that reads the shop's "today".
 */
function readsShopToday(
  appointment: { readonly bookingStatus: BookingStatus },
  move: LifecycleMove,
): boolean {
  return (
    move.seatId === null &&
    move.to === BookingStatus.Confirmed &&
    (appointment.bookingStatus === BookingStatus.Completed ||
      appointment.bookingStatus === BookingStatus.Cancelled)
  );
}

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
  operationId: OperationId,
): AuditFact {
  return {
    resourceId: AuditResourceId.forAppointment(appointment.id),
    subjects: AuditSystem.subjectsOfSeats(appointment.seats, seatId),
    changeKey: AuditSystem.changeKey.transition(operationId, seatId),
    operationId,
    context: AuditContext.transition(action, reason, seatId),
  };
}

function arrivalFact(
  appointment: Appointment,
  action:
    | typeof AuditAction.BookingStaffArrived
    | typeof AuditAction.BookingStaffUnarrived,
  changeKey: string,
  operationId: OperationId,
): AuditFact {
  return {
    resourceId: AuditResourceId.forAppointment(appointment.id),
    subjects: AuditSystem.subjectsOf(appointment),
    changeKey,
    operationId,
    context: AuditContext.arrival(action),
  };
}

/**
 * A party-level move `lifecycle → to`, stamping `stamp` on every seat
 * still open; a seat already resolved — the guest who no-showed while the
 * other two were cut — keeps what it was given. `stamp` is `null` for a
 * verb that says nothing about the work (confirm). `cancelReasons` is the
 * root's reason set, read only when `to` is `CANCELLED`.
 */
function partyVerb(
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
}

/**
 * The ONE correction edge of the graph: a no-show taken back. Only the
 * stamp the edge put there is lifted — `NO_SHOW` seats return to
 * `SCHEDULED`; a seat resolved on its own before the party mark keeps what
 * it was given. Exactly one legal starting point: `NO_SHOW` (the graph
 * alone would also let `PENDING` through).
 */
function reopenNoShowSlice(
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
}

/**
 * The same-day correction edge (owner ruling 2026-09-08): a completed or
 * cancelled visit comes back to `CONFIRMED`, every settled seat to
 * `SCHEDULED` — but only while the shop is inside the visit's own day
 * ({@link reopenable}: `visitLocalDate` against `today`, both on the shop's
 * wall clock, T1). `null` is a day the caller could not resolve, which is
 * never "the same day".
 */
function reopenSettledSlice(
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
  if (!reopenable(from, visitLocalDate, today)) {
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
}

/**
 * ONE person's seat resolved, and the root following as a SUMMARY of the
 * seats (`SeatOutcome.summarize`) — the write path of the mixed party: two
 * served, one absent, all three facts true at once. The graph is not
 * consulted (a seat outcome is a new fact, the root a derivation); what
 * guards it is that a resolved seat is never re-resolved and a terminal
 * visit takes no further facts. `index` is the seat's position, `seatId`
 * names it in a refusal.
 */
function seatOutcomeSlice(
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
}

/**
 * The staff transition at `nowUtcMs` (the instant it stamps, T4) with
 * `today` the shop's day (T1) — the one a reopen of a settled visit is
 * judged on; on any other day a settled visit stays settled.
 */
function transitionAt(
  appointment: Appointment,
  request: LifecycleTransitionRequest,
  nowUtcMs: UtcEpochMs,
  today: LocalDate,
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
    const resolved = seatOutcomeSlice(
      slice,
      index,
      request.seatId,
      stamp,
      nowUtcMs,
    );
    if (!resolved.ok) return resolved;
    return Result.ok(
      step(appointment, applySlice(appointment, resolved.value), [
        staffFact(
          appointment,
          verb,
          reason,
          request.seatId,
          request.operationId,
        ),
      ]),
    );
  }

  if (readsShopToday(appointment, request)) {
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
          request.operationId,
        ),
      ]),
    );
  }
  if (to === BookingStatus.Confirmed && from === BookingStatus.NoShow) {
    const reopened = reopenNoShowSlice(slice, nowUtcMs);
    if (!reopened.ok) return reopened;
    return Result.ok(
      step(appointment, applySlice(appointment, reopened.value), [
        staffFact(
          appointment,
          AuditAction.BookingStaffReopenNoShow,
          null,
          null,
          request.operationId,
        ),
      ]),
    );
  }
  const moved = partyVerb(
    slice,
    to,
    stamp,
    nowUtcMs,
    CancellationReasonSet.of(reason === null ? [] : [reason]),
  );
  if (!moved.ok) return moved;
  return Result.ok(
    step(appointment, applySlice(appointment, moved.value), [
      staffFact(appointment, verb, reason, null, request.operationId),
    ]),
  );
}

/**
 * {@link reopenSettledSlice} over the entity —
 * the visit's day is its `localDate` (one shop day per appointment, F-6; a
 * visit with no seat has no day), today the shop's.
 */
function reopenSettledAt(
  appointment: Appointment,
  nowUtcMs: UtcEpochMs,
  today: LocalDate,
): Result<Appointment, SchedulingError> {
  const reopened = reopenSettledSlice(
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
 * through `SeatOutcome.summarize`.
 *
 * ONE lifecycle write surface (OR-20): {@link transition} — the staff's
 * every move, a whole party through the graph or one of the correction
 * edges, or ONE seat's outcome — plus the client's own
 * {@link cancelByClient}; the arrival stamp has its two verbs
 * ({@link markArrived}, {@link clearArrival}). There is no second door: the
 * parked entity verbs over the same decision (confirm, complete, no-show,
 * cancel, the two reopens, a seat's outcome) are deleted. Every write verb
 * returns a NEW entity, the audit facts of the act and its write plan. The
 * transition takes the shop's `ShopNow` — its instant stamps (T4), its
 * `localDate` judges a reopen (T1); the client's cancel and the arrival
 * stamp take `nowUtcMs` alone. The rest is read-only: what a staff surface
 * may offer, and the callables' predicates.
 *
 * No version CAS: neither the cancel nor the transition callable carries
 * one (§4.1).
 */
export const AppointmentLifecycleSystem = {
  /**
   * The client's own cancel (`cancel-appointment.ts:180-219`): every open
   * seat cancelled BY THE CLIENT under the window it was allowed under, the
   * root carrying the code, one `BOOKING_CANCELLED` fact for everyone on the
   * visit keyed by the act's operation id (WS-1). Whether the client MAY
   * cancel is `CancellationPolicySystem.mayCancel`, asked first.
   */
  cancelByClient(
    appointment: Appointment,
    reason: CancellationReason,
    windowHours: HourCount | null,
    nowUtcMs: UtcEpochMs,
    operationId: OperationId,
  ): Result<LifecycleStep, SchedulingError> {
    const stamp = SeatOutcome.cancelled(
      nowUtcMs,
      CancelledBy.Client,
      reason,
      windowHours,
    );
    const moved = partyVerb(
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
          changeKey: AuditSystem.changeKey.cancel(operationId),
          operationId,
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
   * CODE, the seat, and keys the change by the act's operation id and the
   * seat (WS-1).
   */
  transition(
    appointment: Appointment,
    request: LifecycleTransitionRequest,
    now: ShopNow,
  ): Result<LifecycleStep, SchedulingError> {
    return transitionAt(appointment, request, now.utcEpochMs, now.localDate);
  },

  /**
   * Has the chair a reopened visit holds again been given away since? A
   * visit that left the book — cancelled, no-show, completed — freed its
   * barbers' time in the busy projection, and a booking, the waitlist or a
   * staff move may have taken it before the shop reopened it (OR-57, pass E
   * N-5). `appointment` is the visit AFTER the move; `others` the live
   * appointments sharing one of its busy keys. Answers the index of the
   * first open seat of ours that an open seat of theirs, on the same barber
   * and the same shop day, overlaps — the seat the refusal names — or
   * `null` while the chair is still free. A seat the move leaves resolved
   * holds no chair and is never compared.
   */
  seatTakenSince(
    appointment: Appointment,
    others: readonly Appointment[],
  ): number | null {
    for (let m = 0; m < appointment.seats.length; m++) {
      const mine = appointment.seats[m] as Seat;
      if (SeatOutcome.isResolved(mine)) continue;
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
          if (
            !SeatOutcome.isResolved(theirs) &&
            Seat.collidesWith(mine, theirs)
          ) {
            return m;
          }
        }
      }
    }
    return null;
  },

  /**
   * Record that the party walked in. Idempotent on purpose: the first stamp
   * is the true one, so a second tap changes nothing and audits nothing. A
   * settled visit refuses — arriving after it is not a fact, it is a mis-tap.
   */
  markArrived(
    appointment: Appointment,
    nowUtcMs: UtcEpochMs,
    operationId: OperationId,
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
          AuditSystem.changeKey.arrived(operationId),
          operationId,
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
    operationId: OperationId,
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
          AuditSystem.changeKey.unarrived(operationId),
          operationId,
        ),
      ]),
    );
  },

  /* ── read-only legality: what a staff surface may OFFER (pass C) ── */

  /**
   * May a settled root come back to `CONFIRMED` on `today` — the same-day
   * correction edge's guard, the ONE copy the write path
   * ({@link transition}) reads too.
   */
  reopenable,

  /**
   * The lifecycle verbs a staff sheet OFFERS for one chair, in the order a
   * shop reaches for them (`CONFIRMED`, `COMPLETED`, `NO_SHOW`,
   * `CANCELLED`): each the graph allows from the CHAIR's own lifecycle
   * (`BookingLifecycle.canTransition` — a chair resolved inside a live party
   * reads its seats' summary), plus the same-day correction `CONFIRMED`
   * last when the chair is `COMPLETED`/`CANCELLED`, the ROOT is settled the
   * same way (a chair resolved inside a party that is still live has no such
   * edge — the callable reopens the whole appointment or nothing) and
   * {@link reopenable} holds on `today`. Never wider than the server's graph.
   */
  offeredVerbs(
    chair: BookingLifecycle,
    root: { readonly bookingStatus: BookingStatus },
    visitLocalDate: LocalDate,
    today: LocalDate | null,
  ): readonly BookingStatus[] {
    const legal: BookingStatus[] = [];
    for (let i = 0; i < OFFERED_VERBS.length; i++) {
      const to = OFFERED_VERBS[i] as BookingStatus;
      if (BookingLifecycle.canTransition(chair, to)) legal.push(to);
    }
    if (
      root.bookingStatus === chair.bookingStatus &&
      reopenable(chair.bookingStatus, visitLocalDate, today)
    ) {
      legal.push(BookingStatus.Confirmed);
    }
    return legal;
  },

  /**
   * Which verb a row LEADS with — always drawn from `legal` (the
   * {@link offeredVerbs}), the arrival stamp aside; nothing here widens the
   * graph. In order: a `PENDING` chair is accepted first (`CONFIRMED`);
   * then the desk's act, the party walked in (`ARRIVED`), while live and
   * not yet stamped; once arrived, finishing (`COMPLETED`) — arrival, not
   * the clock, gates it; a `NO_SHOW` leads with its correction
   * (`CONFIRMED`); a `COMPLETED`/`CANCELLED` chair with the same-day way
   * back (`CONFIRMED`). `null` when none applies.
   */
  leadVerb(
    chair: { readonly bookingStatus: BookingStatus },
    legal: readonly BookingStatus[],
    arrived: boolean,
  ): StaffVerb | null {
    const status = chair.bookingStatus;
    if (
      status === BookingStatus.Pending &&
      legal.includes(BookingStatus.Confirmed)
    ) {
      return BookingStatus.Confirmed;
    }
    if (
      !arrived &&
      (status === BookingStatus.Pending || status === BookingStatus.Confirmed)
    ) {
      return ArrivalVerb.Arrived;
    }
    if (arrived && legal.includes(BookingStatus.Completed)) {
      return BookingStatus.Completed;
    }
    if (
      status === BookingStatus.NoShow &&
      legal.includes(BookingStatus.Confirmed)
    ) {
      return BookingStatus.Confirmed;
    }
    if (
      (status === BookingStatus.Completed ||
        status === BookingStatus.Cancelled) &&
      legal.includes(BookingStatus.Confirmed)
    ) {
      return BookingStatus.Confirmed;
    }
    return null;
  },

  /**
   * The seats a staff move to `to` addresses on one chair — `[]` means the
   * ROOT (the whole party, one call with no seat). A move with no per-seat
   * meaning (`SeatOutcome.hasSeatMeaning`: `PENDING`, `CONFIRMED`) always
   * addresses the root, as the server refuses it per seat; so does a chair
   * holding the whole party (`chairSeatIds.length === partySize`); a
   * chair's share of a larger party addresses its own seats, one call each.
   */
  transitionSeats(
    to: BookingStatus,
    chairSeatIds: readonly SeatId[],
    partySize: number,
  ): readonly SeatId[] {
    if (!SeatOutcome.hasSeatMeaning(to)) return [];
    return chairSeatIds.length === partySize ? [] : chairSeatIds;
  },

  /**
   * The undo a staff act offers — the inverse a real second request makes
   * through the same callables, or `null` for none: the arrival stamp is
   * taken back (`UNARRIVED`) whatever the scope, as arriving is the party's;
   * a whole-party `COMPLETED`, `NO_SHOW` or `CANCELLED` comes back to
   * `CONFIRMED`; a move of one chair's share inside a party has no inverse
   * the callable offers, and a correction (`CONFIRMED`) or an `UNARRIVED`
   * is not itself undoable. No reopen-day guard (unlike the reopen
   * {@link transition} makes): the undo is offered at once, and the server
   * still refuses it on another day.
   */
  inverseOf(did: StaffVerb, wholeParty: boolean): StaffVerb | null {
    if (did === ArrivalVerb.Arrived) return ArrivalVerb.Unarrived;
    if (!wholeParty) return null;
    if (
      did === BookingStatus.Completed ||
      did === BookingStatus.NoShow ||
      did === BookingStatus.Cancelled
    ) {
      return BookingStatus.Confirmed;
    }
    return null;
  },

  /**
   * The visit sheet's exits — every act that is neither an edit nor a
   * stamp, from the verbs it was `offered` (lead first, then the rest), in
   * their order: the stamps the graph still allows (`ARRIVED`, `COMPLETED`)
   * are never exits; `CONFIRMED` (the way back) only when the chair is not
   * `PENDING` — there it is the head's own request; `NO_SHOW` only once the
   * visit has `started` (before it, nobody has failed to come); any other
   * verb as it is. `CANCELLED` is never listed — `cancel` says it was
   * offered, and the sheet draws it last. `rebook` — the next visit — on a
   * chair that settled ({@link BookingLifecycle.isSettled}) and is not gone
   * ({@link BookingLifecycle.didNotHappen}, the edit lock — a gone one
   * offers it from the dock): exactly a `COMPLETED` chair.
   * UI legality only: the server's no-show takes no start input.
   */
  exitVerbs(
    chairStatus: BookingStatus,
    offered: readonly StaffVerb[],
    started: boolean,
  ): ExitVerbs {
    const verbs: StaffVerb[] = [];
    let cancel = false;
    for (let i = 0; i < offered.length; i++) {
      const verb = offered[i] as StaffVerb;
      if (verb === ArrivalVerb.Arrived || verb === BookingStatus.Completed) {
        continue;
      }
      if (verb === BookingStatus.Cancelled) {
        cancel = true;
        continue;
      }
      if (verb === BookingStatus.Confirmed) {
        if (chairStatus !== BookingStatus.Pending) verbs.push(verb);
        continue;
      }
      if (verb === BookingStatus.NoShow) {
        if (started) verbs.push(verb);
        continue;
      }
      verbs.push(verb);
    }
    const chair = { bookingStatus: chairStatus };
    const rebook =
      BookingLifecycle.isSettled(chair) &&
      !BookingLifecycle.didNotHappen(chair);
    return { verbs, rebook, cancel };
  },

  /**
   * Could this move END the visit live — a move to a live status of a visit
   * that is not live: the reopen of a `CANCELLED`, `NO_SHOW` or `COMPLETED`
   * visit? Asked of the REQUEST, before the decision, it names every move
   * whose chair may have been given away since ({@link seatTakenSince}) and
   * whose chair time the busy projection must get back ({@link endsLive}) —
   * what the transition reads both for. Every move the decision ends live,
   * it answers `true` for.
   */
  mayEndLive(
    appointment: { readonly bookingStatus: BookingStatus },
    move: LifecycleMove,
  ): boolean {
    return (
      !BookingLifecycle.isLive(appointment) &&
      BookingLifecycle.isLive({ bookingStatus: move.to })
    );
  },

  /**
   * Does this move read the shop's "today" — a party reopen of a settled
   * visit (`COMPLETED`/`CANCELLED → CONFIRMED`)? Without a shop clock such
   * a move is refused as out of its window; every other verb reads only
   * the instant.
   */
  readsShopToday,

  /**
   * Did the move END the visit live — live after, not before
   * (`BookingLifecycle.isLive`, the busy projection's own predicate)? The
   * reopen of a `CANCELLED`, `NO_SHOW` or `COMPLETED` visit: what holds its
   * chair again at once (pass E, E-14, DEP-5), once that chair is proved
   * still free ({@link seatTakenSince}, OR-57).
   */
  endsLive(
    before: { readonly bookingStatus: BookingStatus },
    after: { readonly bookingStatus: BookingStatus },
  ): boolean {
    return !BookingLifecycle.isLive(before) && BookingLifecycle.isLive(after);
  },
} as const;
