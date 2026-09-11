import {
  Money,
  Result,
  ZonedDateTime,
  combineAll,
  fail,
  ok,
} from '@creativo/domain/kernel';
import {
  BarberId,
  LocationId,
  EmptyIdError as CatalogEmptyIdError,
} from '@creativo/domain/catalog';
import {
  DiscountApplication,
  type DiscountBreakdown,
} from '@creativo/domain/engagement';
import { AppliedDiscount } from './applied-discount';
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
  canTransition,
  cancelled,
  isTerminal,
} from './appointment-status';
import { BookingContact } from './booking-contact';
import { CalendarDay } from './calendar-day';
import { AppointmentId, SeatId } from './ids';
import { EmptyIdError } from './ids.errors';
import { Seat } from './seat';
import {
  CancellationReason,
  SEAT_SCHEDULED,
  SeatOutcome,
  outcomeForStatus,
  summarizeSeatOutcomes,
} from './seat-outcome';
import { TimeSlot } from './time-slot';

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
    if (this.status.kind !== 'pending' && this.status.kind !== 'confirmed') {
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
    if (this.status.kind !== 'pending' && this.status.kind !== 'confirmed') {
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
    if (this.status.kind !== 'completed' && this.status.kind !== 'cancelled') {
      return fail(
        new AppointmentInvalidTransitionError(this.status.kind, 'confirmed'),
      );
    }
    const visitDay = CalendarDay.fromZonedDateTime(this.timeSlot.end);
    if (!visitDay.equals(CalendarDay.fromZonedDateTime(now))) {
      return fail(new AppointmentReopenWindowClosedError(this.status.kind));
    }
    const seats = this.seats.map((seat) =>
      seat.outcome.kind === 'scheduled'
        ? seat
        : seat.withOutcome(SEAT_SCHEDULED),
    );
    return ok(this.withSeats(seats, CONFIRMED));
  }

  /**
   * How late the party was, in minutes — negative when they were early.
   *
   * `null` when they have not arrived, which is NOT the same as zero and must
   * never be averaged in as punctual.
   */
  latenessMinutes(): number | null {
    if (this.arrivedAt === null) return null;
    return -this.arrivedAt.minutesUntil(this.timeSlot.start);
  }

  /** New appointment — starts `pending`; the party must begin in the future. */
  static create(
    props: CreateAppointmentProps,
  ): Result<Appointment, AppointmentError[]> {
    const earliest = Appointment.earliestStart(props.seats);
    if (earliest && !earliest.isAfter(props.now)) {
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
      ),
    );
  }

  private static validateSeats(seats: Seat[]): AppointmentError[] {
    const errors: AppointmentError[] = [];
    if (seats.length === 0) {
      errors.push(new AppointmentEmptySeatsError());
      // Every remaining rule is about relationships BETWEEN seats, so with
      // none there is nothing further to say.
      return errors;
    }

    // ONE PERSON, ONE CHAIR AT A TIME (relaxed 2026-09-08). This used to
    // forbid a second `self` seat outright, which made "a cut and then a
    // beard trim" for one client unrepresentable — the staff editor's whole
    // service ladder. The invariant that was actually being protected is
    // narrower: the booker cannot sit in two chairs at once. Sequential self
    // seats are one visit with two services; overlapping ones are a mistake.
    const selfSeats = seats.filter(
      (s) => s.subject.kind === 'account' && s.subject.relationship === 'self',
    );
    const selfOverlaps = selfSeats.some((a, i) =>
      selfSeats.some((b, j) => j > i && a.slot.overlaps(b.slot)),
    );
    if (selfOverlaps) {
      errors.push(new AppointmentMultipleSelfSeatsError());
    }

    // One barber cannot be in two chairs at once. Reported once per barber,
    // however many pairs collide — the booker needs to know WHO, not how
    // many ways the schedule is impossible.
    const doubleBooked = new Set<string>();
    for (let i = 0; i < seats.length; i++) {
      for (let j = i + 1; j < seats.length; j++) {
        const a = seats[i] as Seat;
        const b = seats[j] as Seat;
        if (a.collidesWith(b)) doubleBooked.add(a.barberId.value);
      }
    }
    for (const barberId of doubleBooked) {
      errors.push(new AppointmentBarberDoubleBookedError(barberId));
    }

    const expected = (seats[0] as Seat).terms.price.currencyCode();
    for (const seat of seats) {
      const found = seat.terms.price.currencyCode();
      if (found !== expected) {
        errors.push(new AppointmentMixedCurrencyError(expected, found));
        break;
      }
    }

    return errors;
  }

  // ── Derived party facts ───────────────────────────────────────────────

  /**
   * The party block: earliest seat start to latest seat end. For a parallel
   * arrangement this is the longest seat; for a sequential one it spans the
   * whole chain. Derived, never stored — see the class doc.
   */
  get timeSlot(): TimeSlot {
    const starts = this.seats.map((seat) => seat.slot.start);
    const ends = this.seats.map((seat) => seat.slot.end);
    const start = starts.reduce((a, b) => (b.isBefore(a) ? b : a));
    const end = ends.reduce((a, b) => (a.isBefore(b) ? b : a));
    const result = TimeSlot.create({
      startIso: start.toISO(),
      endIso: end.toISO(),
      zone: start.zoneName,
    });
    // Unreachable: `seats` is non-empty by invariant and every seat's own
    // slot already satisfies start < end, so the envelope does too.
    if (result.isFailure()) throw new Error('unreachable: invalid envelope');
    return result.value;
  }

  /** Who is working this appointment, deduped, in seat order. */
  barberIds(): readonly BarberId[] {
    const seen = new Set<string>();
    const ids: BarberId[] = [];
    for (const seat of this.seats) {
      if (seen.has(seat.barberId.value)) continue;
      seen.add(seat.barberId.value);
      ids.push(seat.barberId);
    }
    return ids;
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
    return this.seats
      .map((seat) => seat.terms.price)
      .reduce((total, price) => {
        const sum = total.add(price);
        // Unreachable: `validateSeats` rejects a mixed-currency appointment
        // at build, so `add` cannot mismatch here.
        if (sum.isFailure()) throw new Error('unreachable: mixed currency');
        return sum.value;
      });
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
    const currency = this.subtotal().currencyCode();
    const minor = this.voucherRedemptions
      .filter((redemption) => redemption.live)
      .filter((redemption) => redemption.amount.currencyCode() === currency)
      .reduce((sum, redemption) => sum + redemption.amount.toMinorUnits(), 0);
    return Appointment.moneyOrZero(minor, currency);
  }

  /** What still changes hands at the counter: the total less what vouchers paid, never below zero. */
  balanceDue(): Money {
    const total = this.total();
    const due = total.toMinorUnits() - this.redeemedTotal().toMinorUnits();
    return Appointment.moneyOrZero(due, total.currencyCode());
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
    );
  }

  private static moneyOrZero(minor: number, currencyCode: string): Money {
    const money = Money.fromMinorUnitsAndCode(Math.max(0, minor), currencyCode);
    // Unreachable: the currency is the seats' own, validated at build.
    if (money.isFailure()) throw new Error('unreachable: seat currency');
    return money.value;
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
    );
  }

  private static earliestStart(seats: readonly Seat[]): ZonedDateTime | null {
    if (seats.length === 0) return null;
    return seats
      .map((seat) => seat.slot.start)
      .reduce((a, b) => (b.isBefore(a) ? b : a));
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
    if (this.status.kind !== 'no_show') {
      return fail(
        new AppointmentInvalidTransitionError(this.status.kind, 'confirmed'),
      );
    }
    const seats = this.seats.map((seat) =>
      seat.outcome?.kind === 'no_show'
        ? seat.withOutcome(SEAT_SCHEDULED)
        : seat,
    );
    return ok(this.withSeats(seats, CONFIRMED));
  }

  cancel(
    reason: string,
    atMs: number,
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
    const seat = this.seats.find((candidate) => candidate.id.equals(seatId));
    if (!seat) {
      return fail(new AppointmentUnknownSeatError(seatId.value));
    }
    if (seat.isResolved()) {
      return fail(
        new AppointmentSeatAlreadyResolvedError(
          seatId.value,
          seat.outcome.kind,
        ),
      );
    }
    if (isTerminal(this.status)) {
      return fail(
        new AppointmentInvalidTransitionError(this.status.kind, outcome.kind),
      );
    }

    const seats = this.seats.map((candidate) =>
      candidate.id.equals(seatId) ? candidate.withOutcome(outcome) : candidate,
    );
    return ok(
      this.withSeats(
        seats,
        summarizeSeatOutcomes(
          seats.map((candidate) => candidate.outcome),
          this.status,
        ),
      ),
    );
  }

  /** Every seat whose story the shop has not told yet. */
  openSeats(): readonly Seat[] {
    return this.seats.filter((seat) => !seat.isResolved());
  }

  /**
   * How far ahead this booking was made, in minutes — the metric `bookedAt`
   * exists for. `null` when the appointment predates the field.
   */
  bookingLeadTimeMinutes(): number | null {
    return this.bookedAt?.minutesUntil(this.timeSlot.start) ?? null;
  }

  private transition(
    to: AppointmentStatusKind,
    next: AppointmentStatus,
    /** `null` for moves that say nothing about the work (confirm). */
    atMs: number | null,
    reason: CancellationReason = { kind: 'other', note: '' },
    by: 'client' | 'staff' = 'staff',
  ): Result<Appointment, AppointmentInvalidTransitionError> {
    if (!canTransition(this.status, to)) {
      return fail(new AppointmentInvalidTransitionError(this.status.kind, to));
    }

    const seatOutcome =
      atMs === null ? null : outcomeForStatus(to, atMs, reason);
    const seats =
      seatOutcome === null
        ? this.seats
        : this.seats.map((seat) =>
            seat.isResolved()
              ? seat
              : seat.withOutcome(
                  seatOutcome.kind === 'cancelled'
                    ? { ...seatOutcome, by }
                    : seatOutcome,
                ),
          );

    return ok(this.withSeats(seats, next));
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
    );
  }
}
