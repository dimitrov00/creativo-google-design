import {
  Money,
  Result,
  ZonedDateTime,
  combineAll,
  fail,
  ok,
} from '@creativo/domain/kernel';
import type { UserId } from '@creativo/domain/accounts';
import {
  BarberId,
  LocationId,
  EmptyIdError as CatalogEmptyIdError,
} from '@creativo/domain/catalog';
import {
  DiscountApplication,
  type DiscountBreakdown,
} from '@creativo/domain/engagement';
import { AppliedDiscount, toEcsDiscount } from './applied-discount';
import { VoucherRedemption } from './voucher-redemption';
import {
  AppointmentBarberDoubleBookedError,
  AppointmentEmptyCancellationReasonError,
  AppointmentEmptySeatsError,
  AppointmentInvalidTransitionError,
  AppointmentReopenWindowClosedError,
  AppointmentMixedCurrencyError,
  AppointmentMultipleSelfSeatsError,
  AppointmentNotArrivableError,
  AppointmentPastStartTimeError,
  AppointmentSeatAlreadyResolvedError,
  AppointmentUnknownSeatError,
} from './appointment.errors';
import {
  AppointmentStatus,
  AppointmentStatusKind,
  CONFIRMED,
  COMPLETED,
  NO_SHOW,
  PENDING,
  cancelled,
} from './appointment-status';
import { BookingContact } from './booking-contact';
import { BookingPolicy } from './booking-policy';
import { CalendarDay } from './calendar-day';
import type { CancellationWindow } from './cancellation-window';
import type { ChairTime } from './availability';
import { AppointmentId, SeatId } from './ids';
import { EmptyIdError } from './ids.errors';
import { Seat } from './seat';
import {
  CancellationReason,
  SEAT_SCHEDULED,
  SeatOutcome,
  outcomeForStatus,
} from './seat-outcome';
import { TimeSlot } from './time-slot';
import {
  AppointmentId as AppointmentIdData,
  type AppointmentEntity,
  AppointmentIndexSystem,
  AppointmentLifecycleSystem,
  BarberId as BarberIdData,
  BillingSystem,
  BookingStatus as BookingStatusData,
  GiftVoucherId,
  LocationId as LocationIdData,
  type LifecycleSlice,
  type Money as MoneyData,
  MoveSystem,
  SchedulingErrorCode,
  type SchedulingError,
  type Seat as SeatData,
  SeatId as SeatIdData,
  SeatLabel as SeatLabelData,
  SeatOutcome as SeatOutcomes,
  type SeatOutcome as SeatOutcomeData,
  SeatSubject as SeatSubjectData,
  ServiceId as ServiceIdData,
  type ServiceVariantId as ServiceVariantIdData,
  TimeInterval,
  UserId as UserIdData,
  type VoucherRedemption as VoucherRedemptionData,
} from '@creativo/ecs-core';

/*
 * THIN SHIM (ECS migration Phase 2). The appointment's math lives in the
 * systems: its life (the graph's verbs, the seat roll-up, the correction
 * edges, arrival, the party's invariants) in `AppointmentLifecycleSystem`,
 * its bill in `BillingSystem`, the client move's facts in `MoveSystem`. This
 * class keeps the legacy API its callers hold — the kernel `Result`, the
 * legacy seats, statuses and errors — and only converts: the system decides,
 * the legacy values (an `other` reason's note, a `CancellationWindow`, the
 * `ZonedDateTime` stamps) ride back on what it decided.
 */

/* ── Legacy ↔ ECS converters ─────────────────────────────────────────── */

function toMoneyData(money: Money): MoneyData {
  return {
    amountMinorUnits: money.toMinorUnits(),
    currencyCode: money.currencyCode(),
  };
}

function fromMoneyData(money: MoneyData): Money {
  const result = Money.fromMinorUnitsAndCode(
    money.amountMinorUnits,
    money.currencyCode,
  );
  // Unreachable: the currency is the seats' own, validated at build.
  if (result.isFailure()) throw new Error('unreachable: seat currency');
  return result.value;
}

function toOutcomeData(outcome: SeatOutcome): SeatOutcomeData {
  switch (outcome.kind) {
    case 'scheduled':
      return SeatOutcomes.scheduled();
    case 'worked':
      return SeatOutcomes.worked(outcome.atMs);
    case 'no_show':
      return SeatOutcomes.noShow(outcome.atMs);
    case 'cancelled':
      return SeatOutcomes.cancelled(
        outcome.atMs,
        outcome.by,
        outcome.reason.kind,
        outcome.window === null ? null : outcome.window.hours,
      );
  }
}

function toStatusData(status: AppointmentStatus): BookingStatusData {
  return status.kind === 'cancelled'
    ? BookingStatusData.cancel(0, status.reason)
    : { kind: status.kind, atMs: 0 };
}

/** The ECS status a slice verb returned → the legacy status (no instant). */
function fromStatusData(status: BookingStatusData): AppointmentStatus {
  switch (status.kind) {
    case 'pending':
      return PENDING;
    case 'confirmed':
      return CONFIRMED;
    case 'completed':
      return COMPLETED;
    case 'no_show':
      return NO_SHOW;
    case 'cancelled':
      return cancelled(status.reason);
  }
}

function toSeatData(seat: Seat): SeatData {
  const subject = seat.subject;
  const catalog = seat.catalogTerms;
  return {
    id: SeatIdData.of(seat.id.value),
    serviceId: ServiceIdData.of(seat.serviceId.value),
    variantId:
      seat.variantId === null
        ? null
        : (seat.variantId.value as ServiceVariantIdData),
    barberId: BarberIdData.of(seat.barberId.value),
    barberPref: seat.pref === null ? null : seat.pref.kind,
    terms: {
      priceMinorUnits: seat.terms.price.toMinorUnits(),
      currencyCode: seat.terms.price.currencyCode(),
      durationMinutes: seat.terms.durationMinutes,
      setupMinutes: seat.terms.setupMinutes,
      cleanupMinutes: seat.terms.cleanupMinutes,
      catalogPriceMinorUnits:
        catalog === null ? null : catalog.price.toMinorUnits(),
      catalogDurationMinutes: catalog === null ? null : catalog.durationMinutes,
    },
    startMs: seat.startsAt.toMillis(),
    subject:
      subject.kind === 'account'
        ? SeatSubjectData.account(
            UserIdData.of(subject.userId.value),
            subject.relationship,
          )
        : SeatSubjectData.anonymous(SeatLabelData.of(subject.label.value)),
    outcome: toOutcomeData(seat.outcome),
    tip: seat.tip === null ? null : toMoneyData(seat.tip),
  };
}

function toRedemptionData(line: VoucherRedemption): VoucherRedemptionData {
  return {
    voucherId: GiftVoucherId.of(line.voucherId),
    code: line.code,
    amount: toMoneyData(line.amount),
    balanceAfter: toMoneyData(line.balanceAfter),
    appliedAtMs: line.appliedAt.toMillis(),
    reversedAtMs: line.reversedAt === null ? null : line.reversedAt.toMillis(),
  };
}

/**
 * The ECS entity the systems read. Only what they compute on is carried:
 * the query mirrors are not (no system here reads them), and the contact
 * stays on the legacy class. Exported as the ONE legacy aggregate → entity
 * converter for the shims that hand a stored visit to a system (the client
 * stats projection's early exit); the commit's `placement` is not on the
 * aggregate, so a caller that has the document supplies it. Phase 4 deletes
 * it with the class.
 */
export function toEcsAppointment(appointment: Appointment): AppointmentEntity {
  return toEntity(appointment);
}

function toEntity(appointment: Appointment): AppointmentEntity {
  const seats = appointment.seats.map(toSeatData);
  const envelope = AppointmentIndexSystem.envelope({ seats });
  return {
    id: AppointmentIdData.of(appointment.id.value),
    locationId: LocationIdData.of(appointment.locationId.value),
    ownerUserId: null,
    subjectUserIds: [],
    placement: null,
    inferredPlacement: null,
    barberIds: [],
    busyKeys: [],
    timeInterval:
      envelope ??
      TimeInterval.of(Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
    zone: appointment.seats[0]?.startsAt.zoneName ?? '',
    bookingStatus: toStatusData(appointment.status),
    seats,
    contact: null,
    bookedAtMs:
      appointment.bookedAt === null ? null : appointment.bookedAt.toMillis(),
    arrivedAtMs:
      appointment.arrivedAt === null ? null : appointment.arrivedAt.toMillis(),
    bookedFromAppointmentId: null,
    discounts: appointment.discounts.map(toEcsDiscount),
    voucherRedemptions: appointment.voucherRedemptions.map(toRedemptionData),
    revision: appointment.revision ?? 0,
    appliedOperations: [],
    stoodSeatPairs: null,
  };
}

/** Two struct outcomes say the same — what a slice verb did NOT change. */
function sameOutcome(a: SeatOutcomeData, b: SeatOutcomeData): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sliceOf(appointment: Appointment): LifecycleSlice {
  return {
    status: toStatusData(appointment.status),
    outcomes: appointment.seats.map((seat) => toOutcomeData(seat.outcome)),
  };
}

/** A party invariant the system named → the legacy error class it always was. */
function toLegacySeatError(error: SchedulingError): AppointmentError {
  switch (error.code) {
    case SchedulingErrorCode.AppointmentEmptySeats:
      return new AppointmentEmptySeatsError();
    case SchedulingErrorCode.AppointmentMultipleSelfSeats:
      return new AppointmentMultipleSelfSeatsError();
    case SchedulingErrorCode.AppointmentBarberDoubleBooked:
      return new AppointmentBarberDoubleBookedError(error.barberId);
    case SchedulingErrorCode.AppointmentMixedCurrency:
      return new AppointmentMixedCurrencyError(error.expected, error.found);
    default:
      return new AppointmentPastStartTimeError();
  }
}

export type AppointmentError =
  | EmptyIdError
  | CatalogEmptyIdError
  | AppointmentEmptySeatsError
  | AppointmentMultipleSelfSeatsError
  | AppointmentBarberDoubleBookedError
  | AppointmentMixedCurrencyError
  | AppointmentNotArrivableError
  | AppointmentPastStartTimeError;

export interface CreateAppointmentProps {
  id: string;
  locationId: string;
  seats: Seat[];
  now: ZonedDateTime;
  /**
   * Who the shop calls about this booking, and what they should know first.
   * Nullable: appointments written before contacts existed have none, and a
   * staff-entered walk-in may genuinely have nobody to call.
   */
  contact?: BookingContact | null;
  /**
   * The visit this one was booked from — the rebooking link.
   *
   * Set when a client books their next cut off the back of the last one
   * (from the confirmation, the reminder, or the chair). It is what makes
   * REBOOKING RATE computable, and there is no way to reconstruct it after
   * the fact: two appointments for the same client six weeks apart look
   * identical whether one was booked in the shop or found cold on the site.
   */
  bookedFromAppointmentId?: string | null;
  /** What was taken off the price — see `AppliedDiscount`. Empty by default. */
  discounts?: readonly AppliedDiscount[];
  /** What was PAID with vouchers — see `VoucherRedemption`. Empty by default. */
  voucherRedemptions?: readonly VoucherRedemption[];
}

export interface ReconstituteAppointmentProps {
  id: string;
  locationId: string;
  seats: Seat[];
  status: AppointmentStatus;
  contact?: BookingContact | null;
  /** Absent for every appointment written before booking time was recorded. */
  bookedAt?: ZonedDateTime | null;
  arrivedAt?: ZonedDateTime | null;
  bookedFromAppointmentId?: string | null;
  /** Absent for every appointment written before discounts could be applied. */
  discounts?: readonly AppliedDiscount[];
  /** Absent for every appointment written before vouchers could be redeemed. */
  voucherRedemptions?: readonly VoucherRedemption[];
  /**
   * The stored revision this visit was READ at — see `Appointment.revision`.
   * Absent (or anything but a whole number ≥ 0) is `null`: the reader did
   * not say, which claims nothing.
   */
  revision?: number | null;
}

/**
 * **Aggregate root.** A booked visit to one location, carrying one or more
 * `Seat`s (a party of N is one `Appointment`, N seats — the appointment is
 * the consistency boundary). `status` is a discriminated union
 * (`AppointmentStatus`), never a status string plus a separate optional
 * `cancellationReason` — see `docs/architecture/domain-model.md`. Every
 * transition method returns a **new** instance and defers to
 * `canTransition` (the single source of truth for the lifecycle graph)
 * rather than re-encoding it.
 *
 * ### What moved onto the seats, and why
 * The root used to hold ONE `barberId` and ONE `timeSlot` for the whole
 * party. The product needs a party to be served in whichever arrangement
 * the shop can offer (owner ruling 2026-07-29) — different barbers in
 * parallel, or the same barber back to back — so both moved to `Seat`.
 *
 * `locationId` stays on the root: one appointment is one physical visit to
 * one shop. That is a real invariant, not a simplification.
 *
 * `timeSlot` stays as an ACCESSOR, now derived — the envelope from the
 * earliest seat start to the latest seat end. Deriving rather than storing
 * means the party block and the seats can never disagree; persistence may
 * still mirror it as a query field, but the seats remain the truth.
 */
export class Appointment {
  private constructor(
    readonly id: AppointmentId,
    readonly locationId: LocationId,
    readonly seats: readonly Seat[],
    readonly status: AppointmentStatus,
    /**
     * A SNAPSHOT of the contact details this booking was made with — never a
     * pointer to the profile, which is free to change afterwards. See
     * `BookingContact`. Authority still rides on `ownerUserId`; this is who
     * to phone, not who owns anything.
     */
    readonly contact: BookingContact | null = null,
    /**
     * WHEN the booking was made — not when it is for.
     *
     * The gap between this and the party's start is BOOKING LEAD TIME, and it
     * is unrecoverable if not stamped here: nothing about a stored appointment
     * reveals whether it was booked six weeks or six minutes ahead. `null`
     * only for appointments written before this field existed.
     */
    readonly bookedAt: ZonedDateTime | null = null,
    /** The visit this one was rebooked from — see `CreateAppointmentProps`. */
    readonly bookedFrom: AppointmentId | null = null,
    /**
     * WHEN the party actually walked in. `null` until they do.
     *
     * ### Why this is a stamp and not a status
     * `confirmed` used to double as "this person is here", which was only
     * available while nothing auto-confirmed. Once a booking may land
     * `confirmed` at creation (owner ruling 2026-08-07), that reading is gone
     * and arrival needs its own field — otherwise the front desk LOSES the
     * signal rather than gaining one. Keeping it off the status union also
     * means `TRANSITIONS` and `canTransition` are untouched: arriving is not
     * an edge in the lifecycle graph, it is a fact recorded alongside it.
     *
     * ### Unrecoverable if not stamped
     * Exactly like `bookedAt`. Nothing about a stored appointment reveals
     * whether the client was ten minutes early or twenty late, so every visit
     * served before this field exists has no punctuality record and never
     * will. It is what makes the measured "waiting 6 min" possible instead of
     * a countdown fabricated from catalog durations.
     */
    readonly arrivedAt: ZonedDateTime | null = null,
    /**
     * WHAT WAS TAKEN OFF — every discount applied to this visit, as
     * snapshots (see `AppliedDiscount`). Empty for a visit at full price.
     *
     * On the ROOT, not the seats: `DiscountInput` names no seat, and the
     * evaluator takes the cart's subtotal, so a discount is a fact about the
     * bill rather than about any one line of it. `subtotal()` is the seats'
     * sum before these; `total()` is what the party actually owes.
     */
    readonly discounts: readonly AppliedDiscount[] = [],
    /**
     * WHAT WAS PAID with gift vouchers — every draw-down this visit made,
     * reversed ones included as history (see `VoucherRedemption`). A
     * payment, never a discount: the price is `total()`, and
     * `balanceDue()` is what still changes hands at the counter.
     */
    readonly voucherRedemptions: readonly VoucherRedemption[] = [],
    /**
     * THE REVISION THIS VISIT WAS READ AT — the stored document's
     * optimistic-concurrency counter, as the reader found it, or `null`
     * when the reader did not say (a visit being built, not read).
     *
     * Not a fact about the visit: a fact about the COPY. It is what a staff
     * sheet drawn from this copy claims on its next save
     * (`StaffEditAppointmentRequest.expectedVersion`), so a colleague's save
     * since is refused as stale instead of silently overwritten. Carried
     * unchanged through every in-memory transition, because none of them is
     * a write: the copy still rests on the revision it was read at until the
     * store stamps a new one. `null` claims nothing and is never refused.
     */
    readonly revision: number | null = null,
  ) {}

  /**
   * Record that the party walked in.
   *
   * Idempotent on purpose: the first stamp is the true one, and a second tap
   * on a busy Saturday must not quietly move a client's arrival ten minutes
   * later. A settled appointment refuses outright — arriving after the visit
   * is already completed or cancelled is not a fact, it is a mis-tap.
   */
  markArrived(at: ZonedDateTime): Result<Appointment, AppointmentError[]> {
    const step = AppointmentLifecycleSystem.markArrived(
      toEntity(this),
      at.toMillis(),
    );
    if (!step.ok) {
      return fail([new AppointmentNotArrivableError(this.status.kind)]);
    }
    if (step.value.auditFacts.length === 0) return ok(this);
    return ok(
      new Appointment(
        this.id,
        this.locationId,
        this.seats,
        this.status,
        this.contact,
        this.bookedAt,
        this.bookedFrom,
        at,
        this.discounts,
        this.voucherRedemptions,
        this.revision,
      ),
    );
  }

  /**
   * The stamp taken back — the undo behind `markArrived`.
   *
   * Same gate as setting it: a live visit only. A settled visit's arrival is
   * history and stays. Clearing what was never set is a no-op, not an error,
   * because the undo that calls this may outlive a second tap.
   */
  clearArrival(): Result<Appointment, AppointmentError[]> {
    const step = AppointmentLifecycleSystem.clearArrival(toEntity(this));
    if (!step.ok) {
      return fail([new AppointmentNotArrivableError(this.status.kind)]);
    }
    if (step.value.auditFacts.length === 0) return ok(this);
    return ok(
      new Appointment(
        this.id,
        this.locationId,
        this.seats,
        this.status,
        this.contact,
        this.bookedAt,
        this.bookedFrom,
        null,
        this.discounts,
        this.voucherRedemptions,
        this.revision,
      ),
    );
  }

  /**
   * The same-day correction edge (owner ruling 2026-09-08).
   *
   * `completed` and `cancelled` stay terminal in `TRANSITIONS`: money and
   * history hang off them, and every list that asks `isTerminal` must keep
   * getting "yes". This is the ONE way past that, and it is narrow on
   * purpose — the shop is still inside the visit's own calendar day (`now`
   * read in the slot's zone), and the whole appointment comes back, every
   * settled seat returned to scheduled. A fat-fingered `Готово` at 13:02 is
   * undone at 13:03; the same tap next morning is refused, because by then
   * the honest path is a new booking.
   *
   * What this does NOT check is whether the chair is still free — a
   * cancellation gave its time away and the waitlist may have taken it.
   * That is the placement engine's question, asked by the server on the way
   * in, never re-derived here.
   */
  reopenSettled(
    now: ZonedDateTime,
  ): Result<
    Appointment,
    AppointmentInvalidTransitionError | AppointmentReopenWindowClosedError
  > {
    // The day keys carry their zone: the legacy `CalendarDay.equals` is the
    // key AND the zone, and only the system decides.
    const dayOf = (instant: ZonedDateTime): string => {
      const day = CalendarDay.fromZonedDateTime(instant);
      return `${day.key()}@${day.zone}`;
    };
    const kind = this.status.kind;
    const reopened = AppointmentLifecycleSystem.reopenSettledSlice(
      sliceOf(this),
      kind === 'completed' || kind === 'cancelled'
        ? dayOf(this.timeSlot.end)
        : null,
      dayOf(now),
      now.toMillis(),
    );
    if (!reopened.ok) {
      return fail(
        reopened.error.code ===
          SchedulingErrorCode.AppointmentReopenWindowClosed
          ? new AppointmentReopenWindowClosedError(kind)
          : new AppointmentInvalidTransitionError(kind, 'confirmed'),
      );
    }
    return ok(this.withSlice(reopened.value, SEAT_SCHEDULED));
  }

  /**
   * How late the party was, in minutes — negative when they were early.
   *
   * `null` when they have not arrived, which is NOT the same as zero and must
   * never be averaged in as punctual.
   */
  latenessMinutes(): number | null {
    return AppointmentLifecycleSystem.latenessMinutes(toEntity(this));
  }

  /** New appointment — starts `pending`; the party must begin in the future. */
  static create(
    props: CreateAppointmentProps,
  ): Result<Appointment, AppointmentError[]> {
    const admitted = AppointmentLifecycleSystem.admit(
      props.seats.map(toSeatData),
      props.now.toMillis(),
    );
    if (admitted[0]?.code === SchedulingErrorCode.AppointmentPastStartTime) {
      return fail([new AppointmentPastStartTimeError()]);
    }
    // `now` IS the booking instant — the clock the use case already resolved,
    // never a second reading, so lead time is measured against the same
    // instant the future-start invariant was checked against.
    return Appointment.build({
      ...props,
      status: PENDING,
      bookedAt: props.now,
    });
  }

  /** Rebuild from persistence — same field validation, skips the future-start invariant. */
  static reconstitute(
    props: ReconstituteAppointmentProps,
  ): Result<Appointment, AppointmentError[]> {
    return Appointment.build(props);
  }

  private static build(props: {
    id: string;
    locationId: string;
    seats: Seat[];
    status: AppointmentStatus;
    contact?: BookingContact | null;
    bookedAt?: ZonedDateTime | null;
    bookedFromAppointmentId?: string | null;
    arrivedAt?: ZonedDateTime | null;
    discounts?: readonly AppliedDiscount[];
    voucherRedemptions?: readonly VoucherRedemption[];
    revision?: number | null;
  }): Result<Appointment, AppointmentError[]> {
    const idResult = AppointmentId.create(props.id);
    const locationIdResult = LocationId.create(props.locationId);

    const combined = combineAll([idResult, locationIdResult] as const);
    const seatErrors = Appointment.validateSeats(props.seats);
    if (combined.isFailure() || seatErrors.length > 0) {
      const errors: AppointmentError[] = combined.isFailure()
        ? [...combined.error]
        : [];
      errors.push(...seatErrors);
      return fail(errors);
    }
    const [id, locationId] = combined.value;

    // A rebooking link that does not parse is dropped, not fatal: the booking
    // is real and the client is waiting. Losing one analytics edge is the
    // cheaper failure, and `null` already means "we don't know".
    let bookedFrom: AppointmentId | null = null;
    if (props.bookedFromAppointmentId != null) {
      const parsed = AppointmentId.create(props.bookedFromAppointmentId);
      if (parsed.isSuccess()) bookedFrom = parsed.value;
    }

    return ok(
      new Appointment(
        id,
        locationId,
        props.seats,
        props.status,
        props.contact ?? null,
        props.bookedAt ?? null,
        bookedFrom,
        props.arrivedAt ?? null,
        props.discounts ?? [],
        props.voucherRedemptions ?? [],
        Appointment.revisionOf(props.revision),
      ),
    );
  }

  /**
   * A revision as a copy may claim it: a whole number ≥ 0, else `null`. A
   * malformed counter claims nothing rather than a number the store never
   * wrote — a wrong claim would refuse every save of the visit as stale.
   */
  private static revisionOf(raw: number | null | undefined): number | null {
    return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0
      ? raw
      : null;
  }

  private static validateSeats(seats: Seat[]): AppointmentError[] {
    return AppointmentLifecycleSystem.seatViolations(seats.map(toSeatData)).map(
      toLegacySeatError,
    );
  }

  // ── Derived party facts ───────────────────────────────────────────────

  /**
   * The party block: earliest seat start to latest seat end. For a parallel
   * arrangement this is the longest seat; for a sequential one it spans the
   * whole chain. Derived, never stored — see the class doc.
   */
  get timeSlot(): TimeSlot {
    const envelope = AppointmentIndexSystem.envelope({
      seats: this.seats.map(toSeatData),
    });
    // The legacy instants at the envelope's bounds — the FIRST seat at
    // each, as the legacy reduce kept them — so the slot keeps their zone
    // and ISO text.
    const start = this.seats.find(
      (seat) => seat.slot.start.toMillis() === envelope?.startMs,
    )?.slot.start;
    const end = this.seats.find(
      (seat) => seat.slot.end.toMillis() === envelope?.endMs,
    )?.slot.end;
    // Unreachable: `seats` is non-empty by invariant and every seat's own
    // slot already satisfies start < end, so the envelope does too.
    if (start === undefined || end === undefined) {
      throw new Error('unreachable: invalid envelope');
    }
    const result = TimeSlot.create({
      startIso: start.toISO(),
      endIso: end.toISO(),
      zone: start.zoneName,
    });
    if (result.isFailure()) throw new Error('unreachable: invalid envelope');
    return result.value;
  }

  /** Who is working this appointment, deduped, in seat order. */
  barberIds(): readonly BarberId[] {
    // The mirror reads no day table for its barbers; the busy keys it
    // would also name are not this question.
    const { barberIds } = AppointmentIndexSystem.queryKeys(
      { seats: this.seats.map(toSeatData) },
      [],
    );
    return barberIds.map(
      (id) =>
        (this.seats.find((seat) => seat.barberId.value === id) as Seat)
          .barberId,
    );
  }

  /** The longest single seat — NOT the envelope, which a sequential party stretches. */
  longestSeatMinutes(): number {
    return Math.max(...this.seats.map((seat) => seat.durationMinutes()));
  }

  /**
   * What the party owes before discounts, folded from the seats' own
   * snapshots. Total rather than a `Result`: one shared currency is an
   * invariant enforced at build, so there is no failure left to report.
   */
  subtotal(): Money {
    const subtotal = BillingSystem.subtotalOf(this.seats.map(toSeatData));
    // Unreachable: `validateSeats` refuses an empty or mixed-currency visit
    // at build, so the sum has nothing left to refuse.
    if (!subtotal.ok) throw new Error('unreachable: mixed currency');
    return fromMoneyData(subtotal.value);
  }

  /**
   * The bill, line by line: the subtotal, what each applied discount took
   * off the running remainder, and what is left. ONE evaluator —
   * `DiscountApplication.apply` — so the sheet, the receipt and any report
   * cannot disagree on a rounding.
   */
  breakdown(): DiscountBreakdown {
    return DiscountApplication.apply(
      this.subtotal(),
      this.discounts.map((discount) => discount.toDiscountInput()),
    );
  }

  /** What the party owes AFTER discounts — `subtotal()` when there are none. */
  total(): Money {
    return this.discounts.length === 0
      ? this.subtotal()
      : this.breakdown().total;
  }

  /** What vouchers have paid of this visit, reversed ones excluded. */
  redeemedTotal(): Money {
    return fromMoneyData(
      BillingSystem.redeemedOf(
        this.voucherRedemptions.map(toRedemptionData),
        this.subtotal().currencyCode(),
      ),
    );
  }

  /** What still changes hands at the counter: the total less what vouchers paid, never below zero. */
  balanceDue(): Money {
    return fromMoneyData(
      BillingSystem.balanceDueOf(
        toMoneyData(this.total()),
        toMoneyData(this.redeemedTotal()),
      ),
    );
  }

  /** The same visit with these voucher redemptions instead — the whole list, replaced. */
  withVoucherRedemptions(
    voucherRedemptions: readonly VoucherRedemption[],
  ): Appointment {
    return new Appointment(
      this.id,
      this.locationId,
      this.seats,
      this.status,
      this.contact,
      this.bookedAt,
      this.bookedFrom,
      this.arrivedAt,
      this.discounts,
      voucherRedemptions,
      this.revision,
    );
  }

  /**
   * The same visit with these discounts instead — the whole list, replaced.
   * Every other field carried over; the seats and the status are untouched,
   * because a discount changes what is owed and nothing about the chair.
   */
  withDiscounts(discounts: readonly AppliedDiscount[]): Appointment {
    return new Appointment(
      this.id,
      this.locationId,
      this.seats,
      this.status,
      this.contact,
      this.bookedAt,
      this.bookedFrom,
      this.arrivedAt,
      discounts,
      this.voucherRedemptions,
      this.revision,
    );
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  /** Confirming is about the BOOKING, not the work — no seat is resolved. */
  confirm(): Result<Appointment, AppointmentInvalidTransitionError> {
    return this.transition('confirmed', CONFIRMED, null);
  }

  /**
   * The whole party was served. Every seat still open is stamped `worked`;
   * a seat already resolved individually — the guest who no-showed while the
   * other two were cut — keeps what it was given.
   */
  complete(
    atMs: number,
  ): Result<Appointment, AppointmentInvalidTransitionError> {
    return this.transition('completed', COMPLETED, atMs);
  }

  /** Nobody came. Same fan-out rule as `complete`. */
  markNoShow(
    atMs: number,
  ): Result<Appointment, AppointmentInvalidTransitionError> {
    return this.transition('no_show', NO_SHOW, atMs);
  }

  /**
   * They turned up after all — take the no-show back.
   *
   * The one correction edge in the lifecycle, and the reason `no_show` is no
   * longer terminal. A no-show is a judgement made at a moment, and the
   * moment it is most often wrong is the ten minutes right after it.
   *
   * Not expressible as a plain `transition('confirmed', …)`: that path takes
   * `atMs: null` for confirm, because confirming says nothing about the
   * work — so the status would walk back to `confirmed` while every seat
   * kept the `no_show` outcome `markNoShow` stamped on it. A booking that
   * says "confirmed" over seats that say "no-show" is a worse state than the
   * one being undone, and it would poison every report that counts seats.
   *
   * So the stamp is lifted where this edge put it: seats whose outcome is
   * `no_show` go back to `scheduled`. A seat resolved INDIVIDUALLY before
   * the party-level stamp — the guest who cancelled while the other two were
   * waiting — keeps what it was given, which is the same rule `markNoShow`
   * itself honours on the way in.
   */
  reopenNoShow(): Result<Appointment, AppointmentInvalidTransitionError> {
    // The status kind, NOT `canTransition(status, 'confirmed')` — that is
    // also true of `pending`, so the graph check alone would let this edge
    // confirm an unconfirmed booking while claiming to undo a no-show.
    // This edge has exactly one legal starting point.
    const reopened = AppointmentLifecycleSystem.reopenNoShowSlice(
      sliceOf(this),
      0,
    );
    if (!reopened.ok) {
      return fail(
        new AppointmentInvalidTransitionError(this.status.kind, 'confirmed'),
      );
    }
    return ok(this.withSlice(reopened.value, SEAT_SCHEDULED));
  }

  /**
   * Call the whole party off. `policy` is the booking policy IN FORCE as it
   * is cancelled: its free-cancellation window is stamped on every seat this
   * closes, so the cancellation is later judged by the rule it was made
   * under, never by whatever the window says by then (2026-09-25).
   */
  cancel(
    reason: string,
    atMs: number,
    policy: BookingPolicy,
    by: 'client' | 'staff' = 'staff',
  ): Result<
    Appointment,
    AppointmentInvalidTransitionError | AppointmentEmptyCancellationReasonError
  > {
    const trimmed = reason.trim();
    if (trimmed.length === 0) {
      return fail(new AppointmentEmptyCancellationReasonError());
    }
    // The typed union is what reports group by; the sentence the shop typed
    // rides along in `other.note` rather than being thrown away. A caller
    // that knows the code should use `markSeatOutcome` per seat instead.
    return this.transition(
      'cancelled',
      cancelled(trimmed),
      atMs,
      {
        kind: 'other',
        note: trimmed,
      },
      by,
      policy.cancellationWindow,
    );
  }

  /**
   * Resolve ONE person's seat, and let the root status follow.
   *
   * This is the write path the mixed party needs: two guests served, one
   * absent, and all three facts true at once. The root is recomputed from the
   * seats by `summarizeSeatOutcomes` rather than set independently, so the
   * summary can never contradict what the seats say.
   *
   * Note what is NOT checked: `canTransition`. The lifecycle graph governs
   * PARTY-level moves — it is the rule that a completed booking cannot be
   * un-completed. A seat outcome is a new fact about one person, and the root
   * that follows from it is a derivation, not a move. What guards this path
   * instead is that a resolved seat may never be re-resolved, and that a
   * terminal appointment is closed to further facts.
   */
  markSeatOutcome(
    seatId: SeatId,
    outcome: SeatOutcome,
  ): Result<
    Appointment,
    | AppointmentUnknownSeatError
    | AppointmentSeatAlreadyResolvedError
    | AppointmentInvalidTransitionError
  > {
    const index = this.seats.findIndex((candidate) =>
      candidate.id.equals(seatId),
    );
    const marked = AppointmentLifecycleSystem.seatOutcomeSlice(
      sliceOf(this),
      index,
      seatId.value,
      toOutcomeData(outcome),
      0,
    );
    if (!marked.ok) {
      const seat = this.seats.at(index);
      switch (marked.error.code) {
        case SchedulingErrorCode.AppointmentUnknownSeat:
          return fail(new AppointmentUnknownSeatError(seatId.value));
        case SchedulingErrorCode.AppointmentSeatAlreadyResolved:
          return fail(
            new AppointmentSeatAlreadyResolvedError(
              seatId.value,
              seat?.outcome.kind ?? outcome.kind,
            ),
          );
        default:
          return fail(
            new AppointmentInvalidTransitionError(
              this.status.kind,
              outcome.kind,
            ),
          );
      }
    }
    return ok(this.withSlice(marked.value, outcome));
  }

  /** Every seat whose story the shop has not told yet. */
  openSeats(): readonly Seat[] {
    return this.seats.filter((seat) => !seat.isResolved());
  }

  /**
   * The seats the booker's own cart can name, in seat order — the ones a
   * client move rebuilds from the cart (`Seat.isMovableByBooker`). The rest
   * are the shop's: a move carries them along, it never re-seats them.
   */
  seatsTheBookerCanMove(ownerUserId: UserId | null): readonly Seat[] {
    const movable = MoveSystem.seatsTheBookerCanMove(
      toEntity(this),
      ownerUserId === null ? null : UserIdData.of(ownerUserId.value),
    ).map((seat) => seat.id);
    return this.seats.filter((seat) =>
      movable.includes(SeatIdData.of(seat.id.value)),
    );
  }

  /**
   * Can the booker move this visit at all?
   *
   * `false` when nothing on it is theirs to name — their own seat was
   * removed and only somebody the shop seated is left. A move follows the
   * booker's seats, so with none there is nothing for the rest to follow:
   * the web flow does not offer the move, and the server refuses it
   * (`shop_only`). Only the shop can move such a visit.
   */
  hasSeatTheBookerCanMove(ownerUserId: UserId | null): boolean {
    return MoveSystem.hasSeatTheBookerCanMove(
      toEntity(this),
      ownerUserId === null ? null : UserIdData.of(ownerUserId.value),
    );
  }

  /**
   * The instant a client move is measured FROM: the earliest start among the
   * seats the booker can move.
   *
   * A move shifts every seat it carries by exactly as far as the cart's
   * earliest seat lands from here, so a carried seat's distance from this
   * instant is the thing a move keeps — side by side stays side by side,
   * straight after stays straight after. The server shifts by it, and the web
   * flow shows (and keeps grid room for) the carried seats by it; one
   * definition, so the minute on the review card is the minute written.
   *
   * `null` when the booker has no seat to anchor to — a visit only the shop
   * can move.
   */
  moveAnchor(ownerUserId: UserId | null): ZonedDateTime | null {
    const anchorMs = MoveSystem.moveAnchor(
      toEntity(this),
      ownerUserId === null ? null : UserIdData.of(ownerUserId.value),
    );
    if (anchorMs === null) return null;
    // The anchor is a seat's own start — handed back as that seat's instant.
    return (
      this.seats.find((seat) => seat.startsAt.toMillis() === anchorMs)
        ?.startsAt ?? null
    );
  }

  /**
   * Every chair this visit holds, seat by seat: what it contributes to the
   * busy projection (`Seat.chairTime`).
   *
   * A MOVE hands exactly this back before it places the same visit again, so
   * its own seats never block its own move. The server decides a move with
   * the visit's contribution subtracted, and the grid releases the same chair
   * time before it offers a start (`paddedBusy`).
   */
  chairTimes(): readonly ChairTime[] {
    const released = MoveSystem.release(toEntity(this));
    return this.seats.map((seat, index) => ({
      barberId: seat.barberId,
      occupied: released.at(index)?.occupied ?? seat.chairTime(),
    }));
  }

  /**
   * How far ahead this booking was made, in minutes — the metric `bookedAt`
   * exists for. `null` when the appointment predates the field.
   */
  bookingLeadTimeMinutes(): number | null {
    return AppointmentLifecycleSystem.bookingLeadTimeMinutes(toEntity(this));
  }

  private transition(
    to: AppointmentStatusKind,
    next: AppointmentStatus,
    /** `null` for moves that say nothing about the work (confirm). */
    atMs: number | null,
    reason: CancellationReason = { kind: 'other', note: '' },
    by: 'client' | 'staff' = 'staff',
    /** The free-cancellation window in force — only a cancellation stamps it. */
    window: CancellationWindow | null = null,
  ): Result<Appointment, AppointmentInvalidTransitionError> {
    // The legacy stamp, with the note and the window the system cannot hold.
    const stamped =
      atMs === null ? null : outcomeForStatus(to, atMs, reason, window);
    const stamp =
      stamped !== null && stamped.kind === 'cancelled'
        ? { ...stamped, by }
        : stamped;
    const moved = AppointmentLifecycleSystem.partyVerb(
      sliceOf(this),
      to,
      stamp === null ? null : toOutcomeData(stamp),
      atMs ?? 0,
      next.kind === 'cancelled' ? next.reason : '',
    );
    if (!moved.ok) {
      return fail(new AppointmentInvalidTransitionError(this.status.kind, to));
    }
    return ok(
      this.withSlice(
        { status: toStatusData(next), outcomes: moved.value.outcomes },
        stamp ?? SEAT_SCHEDULED,
      ),
    );
  }

  /**
   * The same visit with the slice a system verb returned: a seat whose
   * outcome the verb changed takes `outcome` (the legacy stamp, which keeps
   * what the struct cannot — an `other`'s note, the window value), every
   * other seat is kept as it was; the status follows the slice.
   */
  private withSlice(slice: LifecycleSlice, outcome: SeatOutcome): Appointment {
    const before = sliceOf(this).outcomes;
    const seats = this.seats.map((seat, index) => {
      const was = before.at(index);
      const now = slice.outcomes.at(index);
      return was === undefined || now === undefined || sameOutcome(was, now)
        ? seat
        : seat.withOutcome(outcome);
    });
    const status = fromStatusData(slice.status);
    return this.withSeats(
      seats,
      status.kind === this.status.kind && status.kind !== 'cancelled'
        ? this.status
        : status,
    );
  }

  /**
   * Same appointment, new seats and status — every other field carried over.
   *
   * Exists because the constructor now takes seven arguments and the old
   * `transition` silently dropped `contact` off the end of a four-argument
   * call: every confirm/complete/cancel erased the phone number the shop was
   * given, and nothing failed. One helper is one place for that to be right.
   */
  private withSeats(
    seats: readonly Seat[],
    status: AppointmentStatus,
  ): Appointment {
    return new Appointment(
      this.id,
      this.locationId,
      seats,
      status,
      this.contact,
      this.bookedAt,
      this.bookedFrom,
      // Arrival survives every lifecycle move. Completing a visit must not
      // erase the fact that the client walked in at 10:52.
      this.arrivedAt,
      // And so does the bill: a completed visit was still discounted, and
      // still paid the way it was paid.
      this.discounts,
      this.voucherRedemptions,
      // And the revision it was read at: a transition in memory is not a
      // write, so the copy still rests on the same stored revision.
      this.revision,
    );
  }
}
