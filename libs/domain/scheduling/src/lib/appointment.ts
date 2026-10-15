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
import { VoucherRedemption, toEcsRedemption } from './voucher-redemption';
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
  AppointmentSeatOffTheDayError,
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
  toEcsBookingStatus,
  toEcsLifecycle,
} from './appointment-status';
import { BookingContact } from './booking-contact';
import { BookingPolicy } from './booking-policy';
import type { CancellationWindow } from './cancellation-window';
import type { ChairTime } from './availability';
import { AppointmentId, SeatId } from './ids';
import { EmptyIdError } from './ids.errors';
import { Seat, type SeatRelationship } from './seat';
import {
  CancellationReason,
  SEAT_SCHEDULED,
  SeatOutcome,
  outcomeForStatus,
  summarizeSeatOutcomes,
  toEcsSeatOutcome,
} from './seat-outcome';
import { TimeSlot } from './time-slot';
import {
  AppointmentId as AppointmentIdData,
  BarberId as BarberIdData,
  Currency,
  DurationMinutes,
  EndMinute,
  type LocalDate,
  LocationId as LocationIdData,
  MinuteCount,
  type MinuteOfDay,
  PriceCents,
  SchedulingErrorCode,
  type SchedulingError,
  SeatId as SeatIdData,
  ServiceId as ServiceIdData,
  ServiceVariantId as ServiceVariantIdData,
  type TimeZone,
  UserId as UserIdData,
  UtcEpochMs,
  defect,
} from '@core/primitives';
import {
  type AccountSeat,
  BarberPreference,
  BookingContact as BookingContactData,
  BookingLifecycle,
  CancellationReasonSet,
  type Money as MoneyData,
  Seat as SeatData,
  SeatLabel as SeatLabelData,
  SeatOccupant,
  type SeatOutcome as SeatOutcomeData,
  SeatSubject,
  StoodSeatPairs,
  SubjectRelationship,
} from '@core/components';
import { type AccountAppointment } from '@core/entities';
import {
  AppointmentIndexSystem,
  AppointmentLifecycleSystem,
  BillingSystem,
  type LifecycleSlice,
  MoveSystem,
  ZonedTimeSystem,
} from '@core/systems';

/*
 * THIN SHIM (ECS migration Phase 2). The appointment's math lives in the
 * systems: its life (the graph's verbs, the seat roll-up, the correction
 * edges, arrival, the party's invariants) in `AppointmentLifecycleSystem`,
 * its bill in `BillingSystem`, the client move's facts in `MoveSystem`. This
 * class keeps the legacy API its callers hold — the kernel `Result`, the
 * legacy seats, statuses and errors — and only converts (flatten-spec §8.9):
 * the seats' `ZonedDateTime` starts to the shop's wall clock with their own
 * zone (`ZonedTimeSystem.toLocal`), the envelope's instant kept as the legacy
 * instant it already is, `Money` to `*Cents` beside one `currency`, the
 * lower-case tags through one table each. The system decides; the legacy
 * values (an `other` reason's note, a `CancellationWindow`, the
 * `ZonedDateTime` stamps) ride back on what it decided.
 */

/* ── Legacy ↔ ECS converters ─────────────────────────────────────────── */

/** The legacy relationship tag → the ecs-core `SubjectRelationship`. */
const LEGACY_SUBJECT_RELATIONSHIP = {
  self: SubjectRelationship.Self,
  companion: SubjectRelationship.Companion,
  client: SubjectRelationship.Client,
} as const satisfies Record<SeatRelationship, SubjectRelationship>;

/** The legacy barber-preference tag → the ecs-core `BarberPreference`. */
const LEGACY_BARBER_PREFERENCE = {
  any: BarberPreference.Any,
  specific: BarberPreference.Specific,
} as const satisfies Record<
  NonNullable<Seat['pref']>['kind'],
  BarberPreference
>;

/**
 * A brand the legacy value already satisfies — a legacy seat, `Money` or
 * `ZonedDateTime` already holds every rule the brand checks, so a refusal
 * is a programmer defect.
 */
function sure<T, E>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: E },
  what: string,
): T {
  return result.ok ? result.value : defect(`unreachable: ${what}`);
}

function instantOf(at: ZonedDateTime): UtcEpochMs {
  return sure(UtcEpochMs.of(at.toMillis()), 'an instant');
}

function epochMsOf(ms: number): UtcEpochMs {
  return sure(UtcEpochMs.of(ms), 'an instant');
}

function zoneOf(at: ZonedDateTime): TimeZone {
  return sure(ZonedTimeSystem.checkZone(at.zoneName), 'a zone');
}

function centsOf(money: Money): PriceCents {
  return sure(PriceCents.of(money.toMinorUnits()), 'an amount');
}

function currencyOf(money: Money): Currency {
  return sure(Currency.parse(money.currencyCode()), 'a currency');
}

function toMoneyData(money: Money): MoneyData {
  return { amountCents: centsOf(money), currency: currencyOf(money) };
}

function fromMoneyData(money: MoneyData): Money {
  const result = Money.fromMinorUnitsAndCode(money.amountCents, money.currency);
  // Unreachable: the currency is the seats' own, validated at build.
  return result.isSuccess()
    ? result.value
    : defect('unreachable: seat currency');
}

/**
 * Where a seat starts on the visit's wall clock — `null` when it starts on
 * another day (the one-shop-day rule, F-6, flatten-spec T7).
 */
function startOnTheDay(
  seat: Seat,
  zone: TimeZone,
  localDate: LocalDate,
): MinuteOfDay | null {
  const wall = ZonedTimeSystem.toLocal(instantOf(seat.startsAt), zone);
  return wall.localDate === localDate ? wall.minute : null;
}

/**
 * The seat's SOLD minutes as its day's wall clock holds them: its own, or —
 * for a seat sold past the day's midnight (F-6; a NEW booking is refused so
 * at `create`, a stored legacy visit is read as it stands) — what is left of
 * the day, so no wall-clock fact ever throws over a stored visit. The seat's
 * own instants keep its true end (`timeSlot`, the busy projection).
 */
function soldOnTheDay(seat: Seat, startMinutes: MinuteOfDay): DurationMinutes {
  const sold = sure(
    DurationMinutes.of(seat.terms.durationMinutes),
    'a duration',
  );
  return EndMinute.after(startMinutes, sold).ok
    ? sold
    : sure(DurationMinutes.of(1440 - startMinutes), 'the rest of the day');
}

/** Is the seat sold past its day's midnight (F-6)? */
function soldPastMidnight(seat: Seat, startMinutes: MinuteOfDay): boolean {
  const sold = DurationMinutes.of(seat.terms.durationMinutes);
  return !sold.ok || !EndMinute.after(startMinutes, sold.value).ok;
}

/**
 * The legacy seat as the flat struct the ACCOUNT rules read (`AccountSeat`),
 * at its start on the visit's wall clock. An account subject is its uid
 * alone: the client record a stored seat names (D29) is nothing a legacy
 * seat can know, and no system this shim calls reads it.
 */
function toSeatData(seat: Seat, startMinutes: MinuteOfDay): AccountSeat {
  const subject = seat.subject;
  const catalog = seat.catalogTerms;
  return SeatData.composeAccount(
    {
      seatId: SeatIdData.of(seat.id.value),
      serviceId: ServiceIdData.of(seat.serviceId.value),
      variantId:
        seat.variantId === null
          ? null
          : ServiceVariantIdData.of(seat.variantId.value),
      barberId: BarberIdData.of(seat.barberId.value),
      barberPreference:
        seat.pref === null ? null : LEGACY_BARBER_PREFERENCE[seat.pref.kind],
      startMinutes,
      tipCents: seat.tip === null ? null : centsOf(seat.tip),
    },
    {
      priceCents: centsOf(seat.terms.price),
      currency: currencyOf(seat.terms.price),
      durationMinutes: soldOnTheDay(seat, startMinutes),
      setupMinutes: sure(MinuteCount.of(seat.terms.setupMinutes), 'a pad'),
      cleanupMinutes: sure(MinuteCount.of(seat.terms.cleanupMinutes), 'a pad'),
      catalogPriceCents: catalog === null ? null : centsOf(catalog.price),
      catalogDurationMinutes:
        catalog === null
          ? null
          : sure(DurationMinutes.of(catalog.durationMinutes), 'a duration'),
    },
    subject.kind === 'account'
      ? {
          seatSubject: SeatSubject.Account,
          subjectUserId: UserIdData.of(subject.userId.value),
          subjectRelationship:
            LEGACY_SUBJECT_RELATIONSHIP[subject.relationship],
        }
      : SeatOccupant.anonymous(SeatLabelData.of(subject.label.value)),
    toEcsSeatOutcome(seat.outcome),
  );
}

/**
 * The visit's seats on its shop's wall clock: the zone the seats' own
 * instants carry (the first seat's), the day and the instant of the
 * EARLIEST seat — the envelope's start, kept as the legacy instant it is,
 * never re-derived from the wall clock — and every seat converted on that
 * day. `null` for no seats (a party being refused as empty).
 */
type SeatsOnTheClock = {
  readonly zone: TimeZone;
  readonly localDate: LocalDate;
  readonly utcEpochMs: UtcEpochMs;
  readonly seats: readonly AccountSeat[];
};

/**
 * What reading a seat list onto its shop day found: the seats on the clock
 * (`null` for no seats — a party refused as empty at build) with the first
 * seat sold past the day's midnight (`null`: none), or the first seat that
 * starts off the day — which no clock can hold (F-6).
 */
type ClockReading =
  | {
      readonly clockReading: typeof ClockReadingKind.OnTheDay;
      readonly clock: SeatsOnTheClock | null;
      readonly pastMidnightSeatId: string | null;
    }
  | {
      readonly clockReading: typeof ClockReadingKind.OffTheDay;
      readonly seatId: string;
    };

const ClockReadingKind = {
  OnTheDay: 'ON_THE_DAY',
  OffTheDay: 'OFF_THE_DAY',
} as const;

/**
 * The seats read onto the shop day of the EARLIEST one, in the zone the
 * seats' own instants carry (the first seat's). Total: a seat off that day,
 * or sold past its midnight, is REPORTED (F-6), never thrown — the legacy
 * values come from stored documents and requests, not from code.
 */
function readClock(seats: readonly Seat[]): ClockReading {
  const first = seats[0];
  if (first === undefined) {
    return {
      clockReading: ClockReadingKind.OnTheDay,
      clock: null,
      pastMidnightSeatId: null,
    };
  }
  const zone = zoneOf(first.startsAt);
  let earliest = first.startsAt;
  for (const seat of seats) {
    if (seat.startsAt.toMillis() < earliest.toMillis())
      earliest = seat.startsAt;
  }
  const utcEpochMs = instantOf(earliest);
  const localDate = ZonedTimeSystem.toLocal(utcEpochMs, zone).localDate;
  const data: AccountSeat[] = [];
  let pastMidnightSeatId: string | null = null;
  for (const seat of seats) {
    const start = startOnTheDay(seat, zone, localDate);
    if (start === null) {
      return {
        clockReading: ClockReadingKind.OffTheDay,
        seatId: seat.id.value,
      };
    }
    if (pastMidnightSeatId === null && soldPastMidnight(seat, start)) {
      pastMidnightSeatId = seat.id.value;
    }
    data.push(toSeatData(seat, start));
  }
  return {
    clockReading: ClockReadingKind.OnTheDay,
    clock: { zone, localDate, utcEpochMs, seats: data },
    pastMidnightSeatId,
  };
}

/**
 * The seats on the clock of a BUILT visit, memoised per instance: the class
 * is immutable (every verb returns a new instance), so one reading — a zone
 * check and a wall-clock read per seat — serves every derived fact asked of
 * it, sort comparators included. A WeakMap rather than a field, so the
 * instance's shape and equality never depend on what was asked of it.
 */
const CLOCKS = new WeakMap<Appointment, SeatsOnTheClock | null>();

function clockOf(appointment: Appointment): SeatsOnTheClock | null {
  const held = CLOCKS.get(appointment);
  if (held !== undefined) return held;
  const reading = readClock(appointment.seats);
  // Unreachable: `build` refuses a seat F-6 refuses, and every verb keeps
  // the seats' instants.
  if (reading.clockReading === ClockReadingKind.OffTheDay) {
    return defect(`unreachable: seat ${reading.seatId} off the visit's day`);
  }
  CLOCKS.set(appointment, reading.clock);
  return reading.clock;
}

/**
 * The ECS entity as the ACCOUNT rules read it (`AccountAppointment`, D29):
 * only what the systems here compute on is carried — the query mirrors are
 * not (no system here reads them), the client records a stored visit names
 * cannot be known from a legacy aggregate (no placeholder, no uid→customer
 * cast), and the contact stays on the legacy class. Exported as the ONE
 * legacy aggregate → entity converter for the shims that hand a stored
 * visit to a system; the commit's `placement` is not on the aggregate, so a
 * caller that has the document supplies it. Phase 4 deletes it with the
 * class.
 */
export function toEcsAppointment(appointment: Appointment): AccountAppointment {
  return toEntity(appointment);
}

function toEntity(appointment: Appointment): AccountAppointment {
  const clock = clockOf(appointment);
  // Unreachable: `validateSeats` refuses a party with no seat at build.
  if (clock === null)
    return defect('unreachable: an appointment without seats');
  const envelope = AppointmentIndexSystem.envelope(clock);
  if (envelope === null) return defect('unreachable: an empty envelope');
  return {
    id: AppointmentIdData.of(appointment.id.value),
    locationId: LocationIdData.of(appointment.locationId.value),
    ownerUserId: null,
    subjectUserIds: [],
    placement: null,
    inferredPlacement: null,
    barberIds: [],
    busyKeys: [],
    seats: clock.seats,
    bookedFromAppointmentId: null,
    discounts: appointment.discounts.map(toEcsDiscount),
    voucherRedemptions: appointment.voucherRedemptions.map(toEcsRedemption),
    revision: appointment.revision ?? 0,
    appliedOperations: [],
    localDate: clock.localDate,
    startMinutes: envelope.startMinutes,
    endMinutes: envelope.endMinutes,
    utcEpochMs: clock.utcEpochMs,
    ...toEcsLifecycle(appointment.status),
    ...BookingContactData.NONE,
    bookedAtUtcMs:
      appointment.bookedAt === null ? null : instantOf(appointment.bookedAt),
    arrivedAtUtcMs:
      appointment.arrivedAt === null ? null : instantOf(appointment.arrivedAt),
    ...StoodSeatPairs.NONE,
  };
}

/** Two struct outcomes say the same — what a slice verb did NOT change. */
function sameOutcome(a: SeatOutcomeData, b: SeatOutcomeData): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sliceOf(appointment: Appointment): LifecycleSlice {
  return {
    lifecycle: toEcsLifecycle(appointment.status),
    outcomes: appointment.seats.map((seat) => toEcsSeatOutcome(seat.outcome)),
  };
}

/** The shop day of a legacy instant, on its own zone's wall clock. */
function localDateOf(at: ZonedDateTime): LocalDate {
  return ZonedTimeSystem.toLocal(instantOf(at), zoneOf(at)).localDate;
}

/** A party invariant the system named → the legacy error class it always was. */
function toLegacySeatError(error: SchedulingError): AppointmentError {
  switch (error.errorCode) {
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
  | AppointmentPastStartTimeError
  | AppointmentSeatOffTheDayError;

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
    // `AppointmentLifecycleSystem.markArrived`'s gate on the slice it reads —
    // a live lifecycle (`BookingLifecycle.isLive`), the first stamp standing.
    // The step's audit facts name the visit's client records (D29), which a
    // legacy aggregate cannot know, so the shim asks the gate, not the step.
    if (!BookingLifecycle.isLive(toEcsLifecycle(this.status))) {
      return fail([new AppointmentNotArrivableError(this.status.kind)]);
    }
    if (this.arrivedAt !== null) return ok(this);
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
    // `AppointmentLifecycleSystem.clearArrival`'s gate on the slice it reads
    // (see `markArrived`): a live lifecycle; nothing stamped is a no-op.
    if (!BookingLifecycle.isLive(toEcsLifecycle(this.status))) {
      return fail([new AppointmentNotArrivableError(this.status.kind)]);
    }
    if (this.arrivedAt === null) return ok(this);
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
    // The legacy day is the key AND the zone (`CalendarDay.equals`): the
    // visit's day is its envelope's END on that instant's own clock, and a
    // `now` read in another zone is never "the same day". Only the system
    // decides.
    const kind = this.status.kind;
    const end =
      kind === 'completed' || kind === 'cancelled' ? this.timeSlot.end : null;
    const reopened = AppointmentLifecycleSystem.reopenSettledSlice(
      sliceOf(this),
      end === null ? null : localDateOf(end),
      end === null || end.zoneName === now.zoneName ? localDateOf(now) : null,
      instantOf(now),
    );
    if (!reopened.ok) {
      return fail(
        reopened.error.errorCode ===
          SchedulingErrorCode.AppointmentReopenWindowClosed
          ? new AppointmentReopenWindowClosedError(kind)
          : new AppointmentInvalidTransitionError(kind, 'confirmed'),
      );
    }
    return ok(this.withSlice(reopened.value, SEAT_SCHEDULED, CONFIRMED));
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
    // The start is judged on the visit's own wall clock (T1): `now` read in
    // the zone the seats' instants carry. A party with no seat is refused
    // as empty at build, where every violation is reported; so is a seat
    // off the visit's shop day (F-6), which has no wall clock to judge.
    const reading = readClock(props.seats);
    const clock =
      reading.clockReading === ClockReadingKind.OnTheDay ? reading.clock : null;
    const admitted =
      clock === null
        ? []
        : AppointmentLifecycleSystem.admit(
            clock,
            ZonedTimeSystem.shopNow(instantOf(props.now), clock.zone),
          );
    if (
      admitted[0]?.errorCode === SchedulingErrorCode.AppointmentPastStartTime
    ) {
      return fail([new AppointmentPastStartTimeError()]);
    }
    // A NEW visit holds the whole rule: no seat sold past the day's midnight
    // (F-6) — refused as a value, which a commit answers as
    // `BOOKING_INVARIANT_VIOLATED`. A stored one is read as it stands.
    if (
      reading.clockReading === ClockReadingKind.OnTheDay &&
      reading.pastMidnightSeatId !== null
    ) {
      return fail([
        new AppointmentSeatOffTheDayError(reading.pastMidnightSeatId),
      ]);
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

  /**
   * The party's invariants (`AppointmentLifecycleSystem.seatViolations`) —
   * and first the one shop day (F-6, flatten-spec T7): a seat that starts
   * off the visit's day is refused as a value, which a commit answers as
   * `BOOKING_INVARIANT_VIOLATED` (a seat sold past midnight is refused at
   * `create`; a stored one is read as it stands).
   */
  private static validateSeats(seats: Seat[]): AppointmentError[] {
    const reading = readClock(seats);
    if (reading.clockReading === ClockReadingKind.OffTheDay) {
      return [new AppointmentSeatOffTheDayError(reading.seatId)];
    }
    return AppointmentLifecycleSystem.seatViolations(
      reading.clock?.seats ?? [],
    ).map(toLegacySeatError);
  }

  // ── Derived party facts ───────────────────────────────────────────────

  /**
   * The party block: earliest seat start to latest seat end. For a parallel
   * arrangement this is the longest seat; for a sequential one it spans the
   * whole chain. Derived, never stored — see the class doc.
   */
  get timeSlot(): TimeSlot {
    // The legacy instants at the envelope's bounds — the earliest start and
    // the latest end, the FIRST seat at each, as the legacy reduce kept them
    // — so the slot keeps their zone and ISO text. Read off the seats' own
    // instants: no wall clock is needed to bound a list of instants, and a
    // sort comparator asks this once per comparison.
    let start: ZonedDateTime | null = null;
    let end: ZonedDateTime | null = null;
    for (const seat of this.seats) {
      if (start === null || seat.slot.start.toMillis() < start.toMillis()) {
        start = seat.slot.start;
      }
      if (end === null || seat.slot.end.toMillis() > end.toMillis()) {
        end = seat.slot.end;
      }
    }
    // Unreachable: `seats` is non-empty by invariant and every seat's own
    // slot already satisfies start < end, so the envelope does too.
    if (start === null || end === null) {
      return defect('unreachable: invalid envelope');
    }
    const result = TimeSlot.create({
      startIso: start.toISO(),
      endIso: end.toISO(),
      zone: start.zoneName,
    });
    return result.isSuccess()
      ? result.value
      : defect('unreachable: invalid envelope');
  }

  /** Who is working this appointment, deduped, in seat order. */
  barberIds(): readonly BarberId[] {
    // The mirror reads no day table for its barbers; the busy keys it
    // would also name are not this question.
    const { barberIds } = AppointmentIndexSystem.accountKeys(toEntity(this));
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
    // The price slice alone: the sum reads no seat's time.
    const subtotal = BillingSystem.subtotalOf(
      this.seats.map((seat) => ({
        priceCents: centsOf(seat.terms.price),
        currency: currencyOf(seat.terms.price),
      })),
    );
    // Unreachable: `validateSeats` refuses an empty or mixed-currency visit
    // at build, so the sum has nothing left to refuse.
    return subtotal.ok
      ? fromMoneyData(subtotal.value)
      : defect('unreachable: mixed currency');
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
        this.voucherRedemptions.map(toEcsRedemption),
        currencyOf(this.subtotal()),
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
      epochMsOf(0),
    );
    if (!reopened.ok) {
      return fail(
        new AppointmentInvalidTransitionError(this.status.kind, 'confirmed'),
      );
    }
    return ok(this.withSlice(reopened.value, SEAT_SCHEDULED, CONFIRMED));
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
      SeatIdData.of(seatId.value),
      toEcsSeatOutcome(outcome),
      epochMsOf(0),
    );
    if (!marked.ok) {
      const seat = this.seats.at(index);
      switch (marked.error.errorCode) {
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
    // The root follows the seats: the same roll-up, read back as the legacy
    // status (the lower-case reason codes the root stores).
    const outcomes = this.seats.map((seat, at) =>
      at === index ? outcome : seat.outcome,
    );
    return ok(
      this.withSlice(
        marked.value,
        outcome,
        summarizeSeatOutcomes(outcomes, this.status),
      ),
    );
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
    ).map((seat) => seat.seatId);
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
    const entity = toEntity(this);
    const anchor = MoveSystem.moveAnchor(
      entity,
      ownerUserId === null ? null : UserIdData.of(ownerUserId.value),
    );
    if (anchor === null) return null;
    // The anchor is a seat's own start — handed back as that seat's instant
    // (the seat structs are index-aligned with the seats).
    const at = entity.seats.findIndex((seat) => seat.startMinutes === anchor);
    return this.seats.at(at)?.startsAt ?? null;
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
    // `MoveSystem.release` answers the same question on the shop's wall
    // clock, clipped to the visit's day; the legacy callers hold instants,
    // which each seat's own chair time already is (setup before the start,
    // cleanup after the end) — one per seat, in seat order.
    return this.seats.map((seat) => ({
      barberId: seat.barberId,
      occupied: seat.chairTime(),
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
      toEcsBookingStatus(to),
      stamp === null ? null : toEcsSeatOutcome(stamp),
      epochMsOf(atMs ?? 0),
      CancellationReasonSet.fromStored(
        next.kind === 'cancelled' ? next.reason : '',
      ),
    );
    if (!moved.ok) {
      return fail(new AppointmentInvalidTransitionError(this.status.kind, to));
    }
    return ok(this.withSlice(moved.value, stamp ?? SEAT_SCHEDULED, next));
  }

  /**
   * The same visit with the slice a system verb returned: a seat whose
   * outcome the verb changed takes `outcome` (the legacy stamp, which keeps
   * what the struct cannot — an `other`'s note, the window value), every
   * other seat is kept as it was; the status follows the slice.
   */
  private withSlice(
    slice: LifecycleSlice,
    outcome: SeatOutcome,
    status: AppointmentStatus,
  ): Appointment {
    const before = sliceOf(this).outcomes;
    const seats = this.seats.map((seat, index) => {
      const was = before.at(index);
      const now = slice.outcomes.at(index);
      return was === undefined || now === undefined || sameOutcome(was, now)
        ? seat
        : seat.withOutcome(outcome);
    });
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
