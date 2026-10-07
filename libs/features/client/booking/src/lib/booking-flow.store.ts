import { Injectable, computed, inject, signal } from '@angular/core';
import {
  APPOINTMENT_REPOSITORY,
  AppointmentId,
  BOOKING_DRAFT_STORE,
  BOOKING_FLOW_STEPS,
  BOOKING_GATEWAY,
  BarberPref,
  BookingCart,
  BookingConfirmation,
  BookingDraft,
  type BookingDraftChairTime,
  type BookingDraftMove,
  type BookingDraftRider,
  type BookingDraftSource,
  BookingGatewayError,
  BookingFlowError,
  BookingFlowEvent,
  BookingFlowState,
  BookingFlowStep,
  BookingParty,
  CalendarDay,
  type CartLine,
  CartLineId,
  Interval,
  FlexibleWhen,
  GuestId,
  MAX_PARTY_SIZE,
  NewCartLine,
  type CommitBookingSeatRequest,
  type ReconstituteBookingCartProps,
  type Result,
  ScheduleSelection,
  SeatKey,
  WAITLIST_GATEWAY,
  WaitlistGatewayError,
  type WaitlistedSummary,
  advanceBookingFlow,
  carriedOffsetMinutes,
  fail,
  firstSeatWithoutService,
  initialBookingFlowState,
  ok,
  seatKeyValue,
} from '@creativo/application/booking';
import {
  BarberId,
  LocationId,
  ServiceId,
  ServiceVariantId,
} from '@creativo/application/catalog';
import type { UserId } from '@creativo/application/accounts';
import type {
  Appointment,
  BookingContactProps,
  ChairTime,
  MoveRider,
  WaitlistRequest,
} from '@creativo/application/booking';
import { CLOCK } from '@creativo/application/shared';

/**
 * Wraps the pure `advanceBookingFlow` machine (blueprint §5.3) with the two
 * things the machine deliberately doesn't model: draft persistence and the
 * `?step=` history contract.
 *
 * One instance per `/book` visit — provided component-scoped on
 * `ClientBooking`, not root, so re-entering the route starts clean unless a
 * draft says otherwise.
 *
 * Translation-free by design, like `AuthFlowStore`: `error()` carries a
 * `DomainError` whose `code` the component resolves through
 * `translateDomainError` at render time, never a display string.
 */
@Injectable()
export class BookingFlowStore {
  private readonly clock = inject(CLOCK);
  private readonly draftStore = inject(BOOKING_DRAFT_STORE);
  private readonly gateway = inject(BOOKING_GATEWAY);
  private readonly waitlist = inject(WAITLIST_GATEWAY);
  /** The visit being moved, re-read when the flow's copy may be stale. */
  private readonly appointments = inject(APPOINTMENT_REPOSITORY);

  private readonly _state = signal<BookingFlowState>(initialBookingFlowState());
  readonly state = this._state.asReadonly();

  /**
   * The last rejected transition. Cleared by the NEXT successful dispatch —
   * an error that outlives the thing it was about is noise, and this is the
   * only place that can know the difference.
   */
  private readonly _error = signal<
    BookingFlowError | BookingGatewayError | WaitlistGatewayError | null
  >(null);
  readonly error = this._error.asReadonly();

  /**
   * The chosen day and start, held HERE rather than in the schedule step.
   *
   * The step component is destroyed when the wizard advances, so a local
   * signal would lose the user's day the moment they glanced at the review and
   * came back — the same friction the machine already avoids by keeping
   * `locationId` across a step back. Surviving the round trip is also what
   * makes the `slot_unavailable` bounce land somewhere useful: the day stays,
   * only the time it can no longer honour is cleared.
   */
  private readonly _selectedDayKey = signal<string | null>(null);
  readonly selectedDayKey = this._selectedDayKey.asReadonly();

  private readonly _selectedStartMs = signal<number | null>(null);
  readonly selectedStartMs = this._selectedStartMs.asReadonly();

  /**
   * Which shop's offer was tapped, as a `LocationId.value`.
   *
   * A start alone is ambiguous under "any shop": two shops can be free at
   * 14:00, and they are different appointments. The chip carries both.
   */
  private readonly _selectedShopKey = signal<string | null>(null);
  readonly selectedShopKey = this._selectedShopKey.asReadonly();

  /**
   * The shop zone every stored day key is expressed in.
   *
   * Held here rather than re-derived because the store has no catalog: a day
   * key without its zone cannot be compared to "today" on restore, which is
   * how a stale day survived into a calendar that no longer renders it.
   */
  private readonly _zone = signal<string | null>(null);

  private readonly _pending = signal(false);
  /** A commit round-trip is in flight — presentational, not in the state union. */
  readonly pending = this._pending.asReadonly();

  // ── Derived view of the machine ────────────────────────────────────

  readonly step = computed<BookingFlowStep>(() => this._state().kind);

  readonly confirmation = computed<BookingConfirmation | null>(() => {
    const state = this._state();
    return state.kind === 'confirmed' ? state.confirmation : null;
  });

  readonly selection = computed<ScheduleSelection | null>(() => {
    const state = this._state();
    if (state.kind === 'review') return state.selection;
    if (state.kind === 'confirmed') return state.confirmation.selection;
    return null;
  });

  /** True when the last failure is one a fresh grid can fix. */
  readonly slotTaken = computed(() => {
    const error = this._error();
    return error instanceof BookingGatewayError && error.isSlotTaken();
  });

  /** The shop the client chose, or `null` for "any shop". */
  readonly locationId = computed<LocationId | null>(() => {
    const state = this._state();
    if (state.kind === 'confirmed')
      return state.confirmation.selection.locationId;
    if (state.kind === 'waitlisted') return state.summary.locationId;
    if (state.kind === 'review') return state.selection.locationId;
    return state.locationId;
  });

  // Both terminal states hold their party and cart INSIDE their receipt, so
  // the screens that render them read the same signals every other step does
  // rather than reaching into a state-specific shape.
  readonly party = computed<BookingParty | null>(() => {
    const state = this._state();
    if (state.kind === 'confirmed') return null;
    if (state.kind === 'waitlisted') return state.summary.party;
    return state.party;
  });

  readonly cart = computed<BookingCart | null>(() => {
    const state = this._state();
    if (state.kind === 'confirmed') return null;
    if (state.kind === 'waitlisted') return state.summary.cart;
    return state.cart;
  });

  readonly guests = computed(() => this.party()?.guests ?? []);

  /** The booker plus their guests — what "party size" means to a person. */
  readonly partySize = computed(() => this.guests().length + 1);

  readonly maxPartySize = MAX_PARTY_SIZE;

  readonly canAddGuest = computed(() => this.partySize() < MAX_PARTY_SIZE);

  readonly isClaimed = computed(() => this.party()?.isClaimed() ?? true);

  readonly lineCount = computed(() => this.cart()?.lineCount() ?? 0);

  /**
   * The flexible declaration, or an empty one everywhere it cannot exist.
   *
   * Empty rather than `null` off the schedule step so no template has to
   * null-check it — `FlexibleWhen.empty()` answers every question a populated
   * one does, which is the whole reason it is a value object.
   */
  readonly when = computed<FlexibleWhen>(() => {
    const state = this._state();
    if (state.kind === 'schedule') return state.when;
    if (state.kind === 'waitlisted') return state.summary.when;
    return FlexibleWhen.empty();
  });

  readonly waitlisted = computed<WaitlistedSummary | null>(() => {
    const state = this._state();
    return state.kind === 'waitlisted' ? state.summary : null;
  });

  readonly totalSteps = BOOKING_FLOW_STEPS.length;

  /**
   * The flow is OVER — `confirmed` or `waitlisted`, the states that are not
   * on the wizard spine. The machine refuses `back` from here, so the shell
   * drops its whole navigation chrome rather than showing controls that
   * cannot do anything.
   */
  readonly isTerminal = computed(
    () => BOOKING_FLOW_STEPS.indexOf(this.step()) === -1,
  );

  /** 1-based position on the wizard spine; terminal states report the end. */
  readonly currentStep = computed(() => {
    const index = BOOKING_FLOW_STEPS.indexOf(this.step());
    return index === -1 ? this.totalSteps : index + 1;
  });

  // Terminal states report step 4 of 4, which used to light this up on the
  // confirmation screen — a back chevron the machine answers with a refusal.
  readonly canGoBack = computed(
    () => !this.isTerminal() && this.currentStep() > 1,
  );

  // ── Commands ───────────────────────────────────────────────────────

  addGuest(label: string): void {
    this.dispatch({ type: 'add_guest', label });
  }

  /**
   * A placeholder name for a guest about to be added: `label(n)` for the
   * first `n` from `from` that nobody in the party already answers to.
   *
   * A guest's label is their identity on the wire — the server counts people
   * by it (`personKey`) — so a fresh «Гост 3» beside a prefilled guest the
   * visit stored as «Гост 3» would merge two people into one.
   */
  unusedGuestLabel(label: (ordinal: number) => string, from = 1): string {
    return firstUnusedLabel(
      new Set(this.guests().map((guest) => guest.label.value)),
      label,
      from,
    );
  }

  removeGuest(guestId: GuestId): void {
    this.dispatch({ type: 'remove_guest', guestId });
  }

  /**
   * Relabel a guest. Answers whether the party took it — a label another
   * guest already answers to is refused (`DuplicateGuestLabelError`, held on
   * {@link error}), and the services step keeps the field open to say so.
   */
  renameGuest(guestId: GuestId, label: string): boolean {
    return this.dispatch({ type: 'rename_guest', guestId, label });
  }

  addLine(seatKey: SeatKey, line: NewCartLine): void {
    this.dispatch({ type: 'add_line', seatKey, line });
  }

  removeLine(seatKey: SeatKey, lineId: CartLineId): void {
    this.dispatch({ type: 'remove_line', seatKey, lineId });
  }

  setLineVariant(
    seatKey: SeatKey,
    lineId: CartLineId,
    variantId: ServiceVariantId | null,
  ): void {
    this.dispatch({ type: 'set_line_variant', seatKey, lineId, variantId });
  }

  setLineBarber(
    seatKey: SeatKey,
    lineId: CartLineId,
    barberPref: BarberPref,
  ): void {
    this.dispatch({ type: 'set_line_barber', seatKey, lineId, barberPref });
  }

  /** `null` is the "any shop" answer — a choice, not the absence of one. */
  selectLocation(locationId: LocationId | null): void {
    // A different shop has different barbers and different hours, so the day
    // and time below it are stale the moment it changes.
    this.clearSchedulePick();
    this.dispatch({ type: 'select_location', locationId });
  }

  selectSchedule(selection: ScheduleSelection): void {
    // A fresh idempotency key per ARMED selection: retries of this attempt
    // reuse it (a lost response replays as success server-side), while a new
    // selection after a bounce is honestly a new attempt.
    this._attemptId = mintAttemptId();
    this.dispatch({ type: 'select_schedule', selection });
  }

  /**
   * Declare EXACTLY this day as the one to watch — what the waitlist bell
   * sends.
   *
   * `FlexibleWhen` still models a set of days with optional windows, because
   * that is what a waitlist request genuinely is server-side (`decideWaitlist`
   * prunes and caps them) and the matcher reads it back the same way. The
   * client just never asks for more than one any more: the multi-date search
   * was removed as over-complication (owner ruling 2026-08-01), so this
   * replaces whatever was declared rather than adding to it — otherwise a
   * restored draft's days would ride along on a request the user thinks is
   * about the single day in front of them.
   */
  watchOnly(day: CalendarDay): void {
    this.dispatch({ type: 'clear_flexible' });
    this.dispatch({ type: 'toggle_flexible_day', day });
  }

  /**
   * The chosen day, and the shop zone its bare `YYYY-MM-DD` key means.
   *
   * The zone is not decoration: the key alone is ambiguous — the 26th in Sofia
   * and the 26th in Lisbon are different days — and the draft has to be able
   * to tell, on restore, whether a stored day has already gone by. Taking it
   * here rather than guessing at restore time is what makes that check honest.
   */
  selectDay(dayKey: string, zone: string): void {
    // A different day cannot keep the previous day's time.
    this._selectedStartMs.set(null);
    this._selectedShopKey.set(null);
    this._selectedDayKey.set(dayKey);
    this._zone.set(zone);
  }

  selectStart(startMs: number, shopKey: string): void {
    this._selectedStartMs.set(startMs);
    this._selectedShopKey.set(shopKey);
  }

  /** Forget all three — a different shop has different days AND different times. */
  clearSchedulePick(): void {
    this._selectedDayKey.set(null);
    this._selectedStartMs.set(null);
    this._selectedShopKey.set(null);
  }

  /**
   * Rebuild a `CartLineId` the cart itself minted, so the schedule step can
   * hand assignments back keyed by the domain's own id rather than a raw
   * string. Returns `null` for an id no line holds — an assignment naming a
   * line that has since been removed must not reach the machine.
   */
  cartLineId(raw: string): CartLineId | null {
    const cart = this.cart();
    if (!cart) return null;
    const found = cart
      .entries()
      .flatMap(([, lines]) => lines)
      .find((line) => line.id.value === raw);
    return found?.id ?? null;
  }

  next(): void {
    this.dispatch({ type: 'next' });
  }

  back(): void {
    this.dispatch({ type: 'back' });
  }

  /**
   * Ask the server to watch these days for us.
   *
   * The mirror of {@link commit}, and server-side for the same reason: the
   * request names an owner, and who you are is the one fact a caller must not
   * be able to choose. It is also the only place in the flow where signing in
   * is not a formality at the end — there is nobody to notify without an
   * account, so `unauthenticated` is a normal, actionable outcome here rather
   * than an error, and the caller surfaces the sign-in prompt on it.
   *
   * The declaration survives the round trip either way: it is persisted in the
   * draft, so a sign-in redirect costs the user nothing.
   */
  async submitWaitlist(): Promise<void> {
    const state = this._state();
    if (state.kind !== 'schedule' || this._pending()) return;
    if (state.when.isEmpty()) return;

    this._pending.set(true);
    try {
      const result = await this.waitlist.request({
        locationId: state.locationId?.value ?? null,
        when: state.when.toProps(),
        cart: this.cartProps(state.cart),
      });

      if (result.isFailure()) {
        this._error.set(result.error);
        return;
      }
      this.dispatch({
        type: 'waitlisted',
        requestId: result.value.requestId,
      });
    } finally {
      this._pending.set(false);
    }
  }

  /** True when the last failure is one that signing in would fix. */
  readonly needsSignInForWaitlist = computed(() => {
    const error = this._error();
    return error instanceof WaitlistGatewayError && error.needsSignIn();
  });

  /**
   * Ask the server to write the booking.
   *
   * The client sends WHAT it wants and WHO it wants it from; `commitBooking`
   * re-derives the price, the roster and the collision set and is the only
   * thing that can actually create an appointment. So the two outcomes here
   * are not "success and error" — they are "written" and "the shop's answer
   * changed", and the second one is a normal Tuesday.
   *
   * On `slot_unavailable` the flow steps BACK to the schedule and drops only
   * the time: the day, the party and the bag all survive, and the grid the
   * user lands on is recomputed from live data rather than the offer that just
   * expired. Any other failure stays on review — nothing about re-picking a
   * time would fix a withdrawn service or a lost connection.
   */
  /** The armed selection's idempotency key — see {@link selectSchedule}. */
  private _attemptId = mintAttemptId();

  /**
   * The appointment this flow is MOVING, if it is a reschedule rather than a
   * new booking.
   *
   * Held beside the machine because it changes nothing about the wizard's
   * shape — the same four steps ask the same questions — and everything
   * about what the last one does.
   */
  private readonly _rescheduleOf = signal<HeldMove | null>(null);
  readonly rescheduleOf = computed(
    () => this._rescheduleOf()?.appointmentId ?? null,
  );
  readonly isRescheduling = computed(() => this._rescheduleOf() !== null);

  /**
   * The visit this booking was made FROM — set by {@link repeat}, sent as
   * `bookedFromAppointmentId`.
   *
   * The rebooking edge is the one fact about a booking nothing can rebuild
   * later: two visits six weeks apart look the same whether one led to the
   * other or not. Held beside the machine like `_rescheduleOf`, and it
   * outlives edits to the bag: the booking still started from that visit.
   *
   * Both are persisted with the draft — the review step's sign-in round trip
   * comes back without the `?repeat=` / `?reschedule=` that set them — and
   * both are BOUND to the account that read the visit: a different account
   * claiming the flow drops them (`claim`), so one person's booking never
   * names another person's visit.
   */
  private readonly _bookedFrom = signal<HeldSource | null>(null);
  readonly bookedFrom = computed(
    () => this._bookedFrom()?.appointmentId ?? null,
  );

  /**
   * Who moves WITH the visit without being in the cart — the seats the
   * server carries (see `BookingDraftMove.riders`). Empty on a new booking.
   */
  readonly riders = computed<readonly BookingDraftRider[]>(
    () => this._rescheduleOf()?.riders ?? [],
  );

  /**
   * The riders as the day query takes them (`MoveRider`) — pinned to the
   * party's start, on their own barber and their SOLD terms, with the
   * service they are served — for the engine's rider check, which drops
   * every start where somebody the server carries could not sit, and for
   * the shop check, which drops every shop that does not offer their
   * service. The schedule step puts them on each day query.
   *
   * Total over what the flow holds: a rider is only ever held once
   * `moveRiderOf` parses it (`moveFacts` builds them from the visit,
   * `heldMove` refuses a stored move with one that does not parse), so none
   * is dropped here — a dropped rider is a seat the grid stops checking.
   */
  readonly availabilityRiders = computed<readonly MoveRider[]>(() =>
    this.riders().flatMap((rider): readonly MoveRider[] => {
      const parsed = moveRiderOf(rider);
      return parsed === null ? [] : [parsed];
    }),
  );

  /**
   * The chair time the visit being moved holds now, handed back on every day
   * query of the move (`ObserveDayAvailabilityInput.release`). Its own seats
   * never block its own move, because the server decides a move with the
   * visit's contribution subtracted. Empty on a new booking. Total over what
   * the flow holds, like the riders (`chairTimeOf`).
   */
  readonly moveRelease = computed<readonly ChairTime[]>(() =>
    (this._rescheduleOf()?.chairTimes ?? []).flatMap(
      (chair): readonly ChairTime[] => {
        const parsed = chairTimeOf(chair);
        return parsed === null ? [] : [parsed];
      },
    ),
  );

  /**
   * The visit a `?reschedule=` link asked to move — held from the moment the
   * link arrives, before (and whether or not) that visit can be read. See
   * {@link expectMove}.
   */
  private readonly _moveAsked = signal<string | null>(null);

  private readonly _moveRefusal = signal<MoveRefusalState | null>(null);
  /**
   * Why the move this flow was opened for cannot happen here. The shell
   * shows it INSTEAD of the wizard: a blank bookable flow under a move link
   * is how a person meaning to move a visit booked a second one beside it.
   */
  readonly moveRefusal = this._moveRefusal.asReadonly();

  /**
   * A `?reschedule=` link arrived: from here on this flow ends as THAT move
   * or not at all. Until the visit is read and rebuilt ({@link
   * rescheduleFrom}) — and for good once it is refused ({@link refuseMove})
   * — {@link commit} refuses rather than writing a new booking.
   */
  expectMove(appointmentId: string): void {
    this._moveAsked.set(appointmentId);
  }

  /** The move cannot be made here — see {@link moveRefusal}. */
  refuseMove(reason: MoveRefusal, locationId: LocationId | null = null): void {
    this._moveRefusal.set({ reason, locationId });
  }

  /**
   * Rebuild the flow around an appointment being moved — or say why it
   * cannot be (the refusal is also held on {@link moveRefusal}).
   */
  rescheduleFrom(
    appointment: Appointment,
    guestLabel: (ordinal: number) => string,
  ): Result<void, MoveRefusal> {
    const facts = this.moveFacts(appointment);
    if (facts === null) {
      // Nobody is left for the cart to stand in for (staff removed the
      // booker's own seat): only the shop can move the rest, and the server
      // refuses the same visit as `shop_only`. Said here, before a single
      // step is shown.
      this.refuseMove('companions_only', appointment.locationId);
      return fail('companions_only');
    }
    if (!this.prefillFrom(appointment, guestLabel, 'carried_by_server')) {
      this.refuseMove('unavailable', appointment.locationId);
      return fail('unavailable');
    }

    this._moveRefusal.set(null);
    // A move keeps its own appointment; it is not a booking made from one.
    this._bookedFrom.set(null);
    this._rescheduleOf.set({ ...this.sourceOf(appointment), ...facts });
    this.persist();
    return ok(undefined);
  }

  /**
   * Re-read the visit being moved, and bring what the grid decides the move
   * with back in line with the STORED visit: who the server carries, and the
   * chairs the visit holds. The bag stays as the client built it.
   *
   * Both are captured when the move lands, and the visit can change under
   * the flow: staff move it, re-seat a companion, or give its old chair to
   * somebody else. A stale release then hands back chair time that is no
   * longer the visit's, the grid offers a time the server refuses, and a
   * bounce that recomputed the grid from the same stale facts offered the
   * same time again, every time. So a move re-reads whenever it comes back
   * to the grid on facts it did not just read: a restored flow, and a lost
   * slot ({@link commit}).
   *
   * A read that FAILS keeps what is held: the server stays the authority,
   * and the next bounce tries again. A visit that is gone, or that the cart
   * can no longer stand in for, is refused exactly as the landing would
   * refuse it.
   */
  async rereadMove(): Promise<void> {
    const held = this._rescheduleOf();
    if (held === null) return;
    const id = AppointmentId.create(held.appointmentId);
    if (id.isFailure()) return;

    const found = await this.appointments.findById(id.value);
    // The flow let go of this move while the read was out (a claim by
    // somebody else, another landing): the answer is about nothing it holds.
    if (this._rescheduleOf()?.appointmentId !== held.appointmentId) return;
    if (found.isFailure()) return;
    if (found.value === null) {
      this.refuseMove('unavailable');
      return;
    }

    const facts = this.moveFacts(found.value);
    if (facts === null) {
      this.refuseMove('companions_only', found.value.locationId);
      return;
    }
    this._rescheduleOf.set({ ...held, ...facts });
    this.persist();
  }

  /**
   * What a move is decided with, read off the visit: the people the server
   * carries, placed the way it will place them, and every chair the visit
   * holds now. `null` when nobody is left for the cart to stand in for.
   *
   * WHOSE seat is whose is the domain's one rule, the server's too
   * (`Seat.isMovableByBooker`): the booker's own seat and anonymous guests
   * are the cart's; anybody else — a companion ACCOUNT the shop seated, a
   * `self` seat bound to another account — the server carries with the move
   * (`RescheduleBookingUseCase`). Turning them into a guest would put the
   * same person on the visit twice.
   */
  private moveFacts(
    appointment: Appointment,
  ): Pick<HeldMove, 'riders' | 'chairTimes'> | null {
    const owner = this.readerOf(appointment);
    const anchor = appointment.moveAnchor(owner);
    if (anchor === null) return null;

    // Carried seats, by their distance from the domain's move anchor, on the
    // terms they were sold at.
    const riders = appointment.seats
      .filter((seat) => !seat.isMovableByBooker(owner))
      .map((seat): BookingDraftRider => ({
        serviceId: seat.serviceId.value,
        variantId: seat.variantId?.value ?? null,
        barberId: seat.barberId.value,
        // The domain's one shift (`carriedOffsetMinutes`), the server's too.
        offsetMinutes: carriedOffsetMinutes(
          seat.startsAt.toMillis(),
          anchor.toMillis(),
        ),
        durationMinutes: seat.terms.durationMinutes,
        setupMinutes: seat.terms.setupMinutes,
        cleanupMinutes: seat.terms.cleanupMinutes,
      }));

    // …and every chair the visit holds now, the carried seats' included: the
    // server subtracts the whole visit before it re-places it.
    const chairTimes = appointment
      .chairTimes()
      .map((chair): BookingDraftChairTime => ({
        barberId: chair.barberId.value,
        startMs: chair.occupied.startMs,
        endMs: chair.occupied.endMs,
      }));

    return { riders, chairTimes };
  }

  async commit(): Promise<void> {
    const state = this._state();
    if (state.kind !== 'review' || this._pending()) return;

    // A flow opened to MOVE a visit ends as that move or not at all. Until
    // the visit is read and rebuilt — and for good once it is refused —
    // there is no move to send, and a commit here would book a SECOND visit
    // beside the one the person meant to move.
    const asked = this._moveAsked();
    if (asked !== null && this._rescheduleOf()?.appointmentId !== asked) {
      this._error.set(
        new BookingGatewayError(
          'unavailable',
          'The visit being moved is not loaded',
        ),
      );
      return;
    }

    const seats = this.toCommitSeats(state.selection);
    if (seats === null) {
      // An assignment naming a line the cart no longer holds. Refusing here
      // beats sending a request the server would reject for a reason the user
      // cannot act on.
      this._error.set(
        new BookingGatewayError('invalid_request', 'The bag changed'),
      );
      return;
    }

    const contact = this._contact();
    const bookedFrom = this._bookedFrom()?.appointmentId ?? null;

    this._pending.set(true);
    try {
      const movingId = this._rescheduleOf()?.appointmentId ?? null;
      const result = movingId
        ? // A MOVE, not a second booking: the server keeps the appointment's
          // id, its status and its contact, and refuses the same window a
          // cancellation would be refused in.
          await this.gateway.reschedule({
            appointmentId: movingId,
            locationId: state.selection.locationId.value,
            seats,
            // The same name as a commit's, and for the same reason: one per
            // ARMED selection (`selectSchedule`), reused by every retry of
            // it. The server keys the move's audit rows by it, so a retry
            // whose first attempt landed fills a lost row instead of
            // logging nothing — and never logs the move twice.
            attemptId: this._attemptId,
          })
        : await this.gateway.commit({
            locationId: state.selection.locationId.value,
            seats,
            attemptId: this._attemptId,
            // Whatever the review step captured — the account's own details, or
            // the one-time override the contact sheet set. Omitted entirely when
            // there is none, so an anonymous-assembled draft still commits.
            ...(contact ? { contact } : {}),
            // Omitted on a cold booking, like the contact: absent is "we
            // don't know", which is all a cold booking can say.
            ...(bookedFrom ? { bookedFromAppointmentId: bookedFrom } : {}),
          });

      if (result.isFailure()) {
        this._error.set(result.error);
        if (result.error.isSlotTaken()) {
          this._selectedStartMs.set(null);
          this._selectedShopKey.set(null);
          // A move re-reads its visit BEFORE the grid is recomputed: facts
          // gone stale would offer the refused time straight back.
          if (movingId !== null) await this.rereadMove();
          const back = advanceBookingFlow(this._state(), { type: 'back' });
          if (back.isSuccess()) {
            this._state.set(back.value);
            this.persist();
          }
        }
        return;
      }

      this.dispatch({
        type: 'confirmed',
        appointmentId: result.value.appointmentId,
      });
    } finally {
      this._pending.set(false);
    }
  }

  /**
   * The selection, as the wire wants it: one entry per assignment, carrying no
   * price and no duration. The server resolves both — see `BookingGateway`.
   *
   * Returns `null` when an assignment names a line the cart no longer holds,
   * which can only happen if the bag was edited after the schedule step ran.
   */
  private toCommitSeats(
    selection: ScheduleSelection,
  ): readonly CommitBookingSeatRequest[] | null {
    const cart = this.cart();
    const party = this.party();
    if (!cart || !party) return null;

    const lineIndex = new Map<
      string,
      { readonly seatKey: string; readonly line: CartLine }
    >();
    for (const [seatKey, lines] of cart.entries()) {
      for (const line of lines) {
        lineIndex.set(line.id.value, { seatKey, line });
      }
    }

    const guestLabels = new Map(
      party.guests.map((guest) => [guest.id.value, guest.label.value]),
    );

    const seats: CommitBookingSeatRequest[] = [];
    for (const assignment of selection.assignments) {
      const found = lineIndex.get(assignment.lineId.value);
      if (!found) return null;

      // `seatKeyValue` is `'self'` or the bare `GuestId`. A guest travels as
      // their LABEL, because that is all a party member is until they have an
      // account of their own — the server has no user to bind them to.
      const label = guestLabels.get(found.seatKey);
      if (found.seatKey !== 'self' && label === undefined) return null;

      seats.push({
        lineId: assignment.lineId.value,
        serviceId: found.line.serviceId.value,
        variantId: found.line.variantId?.value ?? null,
        barberId: assignment.barberId.value,
        // The cart line has carried the preference the whole way here and it
        // was being dropped at this boundary — the resolved id looks the same
        // whether the client insisted on Ivan or took the first free chair,
        // and those are different bookings the morning Ivan calls in sick.
        barberPref: found.line.barberPref.kind,
        startIso: assignment.slot.start.toISO(),
        subject:
          found.seatKey === 'self'
            ? { kind: 'self' }
            : {
                kind: 'guest',
                label: label as string,
                // Who, among guests: the seat key, one per person. It lets
                // the server tell two guests who share a label from one
                // guest with two services — see `CommitBookingSeatRequest`.
                guestKey: found.seatKey,
              },
      });
    }
    return seats;
  }

  /**
   * Attach the signed-in booker to the party. Called when the principal
   * turns active mid-flow (the review step's sign-in round trip) — the
   * roster, the cart and both monotonic counters survive.
   *
   * The party follows WHOEVER IS SIGNED IN: a draft some other account
   * claimed (a restored tab whose session changed hands) is re-bound to this
   * one, exactly as its sources are released for this one. Leaving it on
   * the old account judged the new person's visit against somebody else's
   * uid — their own seat read as a stranger's (`Seat.isMovableByBooker`),
   * and a visit holding only that seat was refused as the shop's to move.
   * The same account again is a no-op.
   */
  claim(ownerId: string): void {
    const state = this._state();
    // Both terminal states are past claiming: the server already knows who
    // owns what it accepted.
    if (state.kind === 'confirmed' || state.kind === 'waitlisted') return;
    this.releaseSourcesNotReadBy(ownerId);
    if (state.party.ownerId?.value === ownerId) return;
    const result = state.party.claim(ownerId);
    if (result.isFailure()) return;
    this._state.set({ ...state, party: result.value });
    this.persist();
  }

  // ── History / draft ────────────────────────────────────────────────

  /**
   * Move BACKWARD to `step` if the URL says we're behind where the machine
   * is — the browser-Back contract. Forward jumps are deliberately ignored:
   * hand-editing `?step=review` must not skip the cart, and every forward
   * move has a precondition (`next` checks them) that a URL cannot satisfy.
   *
   * Dispatches `back` repeatedly rather than reconstructing state, so the
   * machine stays the only thing that knows how to step backwards.
   */
  rewindTo(step: string | undefined): void {
    if (!step || step === this.step()) return;
    const target = BOOKING_FLOW_STEPS.indexOf(step as BookingFlowStep);
    if (target === -1 || target + 1 >= this.currentStep()) return;

    // Bounded by the spine length — a machine that refuses `back` (a
    // terminal state) must not spin here.
    for (let guard = 0; guard < BOOKING_FLOW_STEPS.length; guard++) {
      if (this.step() === step) return;
      const result = advanceBookingFlow(this._state(), { type: 'back' });
      if (result.isFailure()) return;
      this._state.set(result.value);
    }
  }

  /**
   * A waitlist match walked in through its notification's deep link — the
   * one-shot cue the schedule step consumes to open the time sheet on the
   * freed day without another tap. Cleared on read.
   */
  private readonly _waitlistArrival = signal(false);

  consumeWaitlistArrival(): boolean {
    const arrived = this._waitlistArrival();
    if (arrived) this._waitlistArrival.set(false);
    return arrived;
  }

  /**
   * Rebuild the flow around a waitlist request — the landing for
   * `/book?waitlist={id}&day={dayKey}`.
   *
   * The request froze the BAG and the SHOP at the moment it was made; the
   * party's guest LABELS were never persisted (a guest is only a label until
   * they have an account), so guests come back under placeholder names the
   * caller supplies — which is exactly what they are on a receipt this old.
   * The day lands as the single-day pick, and the arrival flag makes the
   * schedule step open the times sheet unprompted: the notification promised
   * a live search, not a calendar to re-navigate.
   *
   * Returns false when the frozen bag no longer reconstitutes (a service
   * retired since); the caller falls back to a plain /book entry.
   */
  restoreFromWaitlist(
    request: WaitlistRequest,
    dayKey: string | null,
    guestLabel: (ordinal: number) => string,
  ): boolean {
    const cartResult = BookingCart.reconstitute(request.cart);
    if (cartResult.isFailure()) return false;

    const guestIds = cartResult.value
      .entries()
      .map(([seatKey]) => seatKey)
      .filter((seatKey) => seatKey !== 'self');
    // Placeholders, each one no other guest holds (`firstUnusedLabel`): this
    // party lands on the schedule step, past the rename that would fix it.
    const taken = new Set<string>();
    const partyResult = BookingParty.reconstitute({
      ownerId: request.ownerId.value,
      guests: guestIds.map((id) => {
        const label = firstUnusedLabel(taken, guestLabel);
        taken.add(label);
        return { id, label };
      }),
      nextSequence: guestIds.length + 1,
    });
    if (partyResult.isFailure()) return false;

    const props = request.toProps();
    this._state.set({
      kind: 'schedule',
      party: partyResult.value,
      cart: cartResult.value,
      locationId: request.locationId,
      when: FlexibleWhen.empty(),
    });

    const day =
      dayKey ??
      [...props.when.days.map((entry) => entry.dayKey)].sort().at(0) ??
      null;
    if (day) this.selectDay(day, props.zone);
    this._waitlistArrival.set(true);
    this.persist();
    return true;
  }

  /**
   * Start a booking from a visit that already happened — "the same again".
   *
   * The cart is rebuilt from the appointment's SEATS: same services, same
   * variants, and the barber who actually did it as a specific preference
   * (the point of booking again is usually the person, not merely the cut).
   * Everything else is deliberately left open — the day and the time are the
   * questions this flow exists to ask.
   *
   * Guests come back under the names the visit gave them — see
   * {@link prefillFrom}.
   *
   * The visit is also remembered as the booking's source, so the commit
   * carries the rebooking edge. It is an appointment the repository returned
   * to this caller, never a raw id from the URL.
   */
  repeat(
    appointment: Appointment,
    guestLabel: (ordinal: number) => string,
  ): boolean {
    // A NEW booking cannot seat another account, so a companion on the old
    // visit comes back as a guest seat the booker can keep or drop.
    if (!this.prefillFrom(appointment, guestLabel, 'as_guests')) return false;
    this._bookedFrom.set(this.sourceOf(appointment));
    this.persist();
    return true;
  }

  /**
   * Remember `appointment` as the booking's source WITHOUT rebuilding the
   * bag — the continuation of a `/book?repeat=` flow that began signed out.
   *
   * The visit is owner-readable, so a person who arrived signed out could not
   * have it prefilled; they built the bag themselves, and the sign-in round
   * trip brings them back with `?repeat=` still in the URL. Their bag and
   * their day are theirs — replacing them with the old visit would undo the
   * work the round trip promised to keep — but the booking still started
   * from that visit, and the rebooking edge is the one fact about it nothing
   * can rebuild later. A move is never a rebooking, so a flow that is moving
   * a visit is left alone.
   */
  attachRepeatSource(appointment: Appointment): void {
    if (this._rescheduleOf() !== null) return;
    this._bookedFrom.set(this.sourceOf(appointment));
    this.persist();
  }

  /**
   * `appointment`, bound to the account that read it: the party's claimed
   * owner — the signed-in principal — or, before any claim, the visit's own
   * booker, which an owner-scoped read can only have been.
   */
  private sourceOf(appointment: Appointment): HeldSource {
    return {
      appointmentId: appointment.id.value,
      ownerId: this.readerOf(appointment)?.value ?? null,
    };
  }

  /**
   * The account `appointment` was read FOR: the party's claimed owner — the
   * signed-in principal — or, before any claim, the visit's own booker,
   * which an owner-scoped read can only have been. What a held source is
   * bound to, and whose seats a move treats as the booker's own.
   */
  private readerOf(appointment: Appointment): UserId | null {
    const claimed = this.party()?.ownerId ?? null;
    if (claimed !== null) return claimed;
    const self = appointment.seats.find(
      (seat) =>
        seat.subject.kind === 'account' && seat.subject.relationship === 'self',
    )?.subject;
    return self?.kind === 'account' ? self.userId : null;
  }

  /**
   * Drop a source some OTHER account read. Called on every claim, so a
   * restored draft — or a tab whose session changed hands — never carries
   * one person's visit into another person's booking.
   */
  private releaseSourcesNotReadBy(reader: string): void {
    let released = false;
    for (const held of [this._bookedFrom, this._rescheduleOf]) {
      const source = held();
      if (source !== null && source.ownerId !== reader) {
        held.set(null);
        released = true;
      }
    }
    if (released) this.persist();
  }

  /**
   * The bag, barbers and shop of `appointment`, on the schedule step.
   *
   * `companions` says what becomes of a seat the booker cannot name
   * (`Seat.isMovableByBooker`) — an ACCOUNT staff seated beside them. A new
   * booking has no way to seat another account, so it offers them
   * `as_guests`; a move leaves them out of the cart because the server
   * carries them (`carried_by_server`).
   *
   * A guest keeps the NAME the visit stored for them (2026-09-25) — the
   * label is who they are, to the shop and to the server's `personKey`. A
   * move that renamed «Иван (син)» to «Гост 1» wrote the new name over the
   * one the shop gave him, and a move to where the visit already was never
   * matched the server's replay check. Only a person the visit has no name
   * for (a companion account offered as a guest on a repeat) gets a
   * placeholder, and never one another guest already answers to.
   */
  private prefillFrom(
    appointment: Appointment,
    guestLabel: (ordinal: number) => string,
    companions: 'as_guests' | 'carried_by_server',
  ): boolean {
    const owner = this.readerOf(appointment);
    const seatKeys = new Map<string, string>();
    /** Guest seat key → the label the visit stored for that person. */
    const storedLabels = new Map<string, string>();
    const lines: {
      seatKey: string;
      lines: {
        id: string;
        serviceId: string;
        variantId: string | null;
        barberId: string | null;
      }[];
    }[] = [];

    let sequence = 1;
    let guestOrdinal = 0;
    for (const seat of appointment.seats) {
      const subject = seat.subject;
      const theBookers = seat.isMovableByBooker(owner);
      if (!theBookers && companions === 'carried_by_server') continue;
      // The booker's OWN seat — `self` and theirs. A `self` seat bound to
      // another account is somebody else, exactly like a companion.
      const isSelf = theBookers && subject.kind === 'account';
      // ONE KEY PER PERSON, not per seat: a client with a cut and a beard is
      // one person with two lines, and so is a guest. An anonymous guest's
      // LABEL is the only identity it has, and it is the identity the server
      // counts people by (`personKey`) — so two seats under one label are one
      // person on both sides. Keying by seat instead split one guest into two
      // nameless people on every repeat and every move. One person is then
      // never offered two chairs at once (`AvailabilityLine.personKey`): a
      // stored pair side by side comes back as a sequence. Two DIFFERENT
      // people under one label is a labelling defect at the source (the
      // staff sheet's old shared walk-in default), not something a label can
      // tell apart here.
      // The booker is `self`; everyone else becomes a guest seat under a
      // fresh id — a stored `GuestId` belongs to the party that has since
      // been thrown away.
      const person = isSelf
        ? 'self'
        : subject.kind === 'anonymous'
          ? `label:${subject.label.value}`
          : `account:${subject.userId.value}`;
      let seatKey = seatKeys.get(person);
      if (!seatKey) {
        seatKey = isSelf ? 'self' : `guest-${guestOrdinal++}`;
        seatKeys.set(person, seatKey);
        lines.push({ seatKey, lines: [] });
        if (!isSelf && subject.kind === 'anonymous') {
          storedLabels.set(seatKey, subject.label.value);
        }
      }
      const bucket = lines.find((entry) => entry.seatKey === seatKey);
      bucket?.lines.push({
        id: `line-${sequence++}`,
        serviceId: seat.serviceId.value,
        variantId: seat.variantId?.value ?? null,
        barberId: seat.barberId.value,
      });
    }
    if (lines.length === 0) return false;

    const cartResult = BookingCart.reconstitute({
      seats: lines,
      nextSequence: sequence,
    });
    if (cartResult.isFailure()) return false;

    const guestIds = lines
      .map((entry) => entry.seatKey)
      .filter((seatKey) => seatKey !== 'self');
    // Stored names first, so a placeholder can step around every one of them.
    const taken = new Set(storedLabels.values());
    const guests = guestIds.map((id) => {
      const stored = storedLabels.get(id);
      if (stored !== undefined) return { id, label: stored };
      const placeholder = firstUnusedLabel(taken, guestLabel);
      taken.add(placeholder);
      return { id, label: placeholder };
    });
    const partyResult = BookingParty.reconstitute({
      // The party() accessor, not the raw state: a terminal state keeps its
      // party inside its receipt and has none at the top level.
      ownerId: this.party()?.ownerId?.value ?? null,
      guests,
      nextSequence: guestIds.length + 1,
    });
    if (partyResult.isFailure()) return false;

    this._state.set({
      kind: 'schedule',
      party: partyResult.value,
      cart: cartResult.value,
      locationId: appointment.locationId,
      when: FlexibleWhen.empty(),
    });
    this._zone.set(appointment.timeSlot.start.zoneName);
    this.persist();
    return true;
  }

  /**
   * Rebuild from a persisted draft. Silently starts fresh if there is none.
   *
   * Answers whether a draft WAS restored, so a continuation can tell "the
   * person's own flow is back" from "there was nothing to continue" — a
   * landing prefills the second and must not overwrite the first.
   */
  restore(): boolean {
    const loaded = this.draftStore.load();
    if (loaded.isFailure() || loaded.value === null) return false;

    const draft = loaded.value;
    const partyResult = BookingParty.reconstitute(draft.party);
    const cartResult = BookingCart.reconstitute(draft.cart);
    if (partyResult.isFailure() || cartResult.isFailure()) {
      // A draft the domain refuses is worse than no draft — drop it rather
      // than resuming into a party that failed its own invariants.
      this.draftStore.clear();
      return false;
    }

    // A `review` draft resumes on SCHEDULE, never on review itself. Review's
    // state is an OFFER — specific barbers at specific minutes — and an offer
    // restored from storage is an offer nobody re-checked. Resuming one step
    // back re-computes it from live availability, which is also exactly what
    // should happen after a sign-in round trip.
    // A stored shop that no longer parses is dropped to "any shop" rather
    // than failing the restore — the client can still book, just unfiltered.
    const parsedLocation =
      draft.locationId === null ? null : LocationId.create(draft.locationId);
    const locationId =
      parsedLocation !== null && parsedLocation.isSuccess()
        ? parsedLocation.value
        : null;

    // Whatever the booker captured or overrode, before the step branches —
    // it belongs to the booking, not to any one step of it. So do the visit
    // it was made from and the one it moves; `claim` re-checks their reader.
    //
    // A stored MOVE that does not come back whole drops the draft, like a
    // party or a bag the domain refuses: kept without it, the bag would
    // commit as a second booking beside the visit, and kept with half of it,
    // the grid would decide on a visit that does not exist (`heldMove`). The
    // move link lands it again from the live visit.
    const move =
      draft.rescheduleOf == null ? null : heldMove(draft.rescheduleOf);
    if (draft.rescheduleOf != null && move === null) {
      this.draftStore.clear();
      return false;
    }
    this._contact.set(draft.contact ?? null);
    this._bookedFrom.set(heldSource(draft.bookedFrom));
    this._rescheduleOf.set(move);

    if (draft.step === 'location') {
      this._state.set({
        kind: draft.step,
        party: partyResult.value,
        cart: cartResult.value,
        locationId,
      });
      return true;
    }

    // A `review` draft resumes on SCHEDULE, never on review itself. Review's
    // state is an OFFER — specific barbers at specific minutes — and an offer
    // restored from storage is an offer nobody re-checked. Resuming one step
    // back re-computes it from live availability, which is also exactly what
    // should happen after a sign-in round trip.
    // The per-seat rule is re-checked here, not just at `next`: a draft
    // written before the rule existed — or one whose guest lost their only
    // line to a catalog that moved under it — would otherwise resume PAST the
    // step that enforces it, which is the one door a state machine can't
    // guard on its own. So is "one label, one guest": a draft saved before
    // that rule may hold two guests under one name, and it resumes on
    // services, where `next` says so and one rename fixes it.
    if (
      (draft.step === 'schedule' || draft.step === 'review') &&
      !cartResult.value.isEmpty() &&
      firstSeatWithoutService(partyResult.value, cartResult.value) === null &&
      partyResult.value.sharedLabel() === null
    ) {
      this._zone.set(draft.zone);
      this._selectedDayKey.set(this.restoreDayKey(draft));
      this._state.set({
        kind: 'schedule',
        party: partyResult.value,
        cart: cartResult.value,
        locationId,
        when: this.restoreWhen(draft),
      });
      return true;
    }

    this._state.set({
      kind: 'services',
      party: partyResult.value,
      cart: cartResult.value,
      locationId,
    });
    return true;
  }

  /**
   * The stored declaration, or an empty one.
   *
   * A declaration that no longer parses is DROPPED rather than failing the
   * restore — same reasoning as the stored shop above. Losing "I'm free
   * Tuesday morning" costs a few taps; losing the party and the bag with it
   * costs the whole session.
   *
   * The zone comes from the days themselves, which are stored as bare
   * `YYYY-MM-DD` keys: a shop's zone is the one this was authored in, and the
   * schedule step re-derives it from the location on every render anyway.
   */
  /**
   * The stored day, unless it has gone by.
   *
   * A tab left open overnight restores a `dayKey` the calendar no longer
   * renders — today's month is the first one shown, so a day before it has no
   * cell to be selected on and no cell to be tapped off. Keeping it would leave
   * the step believing a day is chosen while nothing on screen says so, and the
   * "open on today" scroll skips itself because it thinks the user already
   * picked. Same reasoning as {@link restoreWhen}'s pruning, one field over.
   */
  private restoreDayKey(draft: BookingDraft): string | null {
    if (draft.dayKey === null || draft.zone === null) return draft.dayKey;
    const day = CalendarDay.create(draft.dayKey, draft.zone);
    const now = this.clock.now(draft.zone);
    if (day.isFailure() || now.isFailure()) return null;
    return day.value.isBefore(CalendarDay.fromZonedDateTime(now.value))
      ? null
      : draft.dayKey;
  }

  private restoreWhen(draft: BookingDraft): FlexibleWhen {
    const props = draft.when;
    // No zone means no declaration worth restoring: the day keys would have to
    // be resolved against a guess, and a guessed zone shifts every window in
    // the request by however far the two zones differ.
    if (!props || props.days.length === 0 || draft.zone === null) {
      return FlexibleWhen.empty();
    }
    const restored = FlexibleWhen.create(props, draft.zone);
    if (restored.isFailure()) return FlexibleWhen.empty();

    // Drop days that have gone by while the draft sat in storage.
    //
    // A tab left open overnight restores a declaration naming yesterday — and
    // yesterday is not on the calendar any more, so the user can neither see
    // it selected nor tap it off, while the count in the CTA keeps counting
    // it. The server drops lapsed days too (`decideWaitlist`); doing it here
    // as well is what keeps the screen and the request describing the same
    // set of days.
    const now = this.clock.now(draft.zone);
    if (now.isFailure()) return restored.value;
    const today = CalendarDay.fromZonedDateTime(now.value);
    return FlexibleWhen.of(
      restored.value.days.filter((day) => !day.day.isBefore(today)),
    );
  }

  clearDraft(): void {
    this.draftStore.clear();
  }

  /**
   * Who the shop calls about THIS booking.
   *
   * Held beside the machine rather than inside a state, for the same reason
   * the selected day is: it survives every step transition, it is meaningful
   * from the moment the booker is known, and no transition is gated on it.
   * `null` means "nothing captured" — the commit then carries no contact at
   * all rather than an empty one the server would refuse.
   */
  private readonly _contact = signal<BookingContactProps | null>(null);
  readonly contact = this._contact.asReadonly();

  setContact(contact: BookingContactProps | null): void {
    this._contact.set(contact);
    this.persist();
  }

  /** Apply one event; answers whether the machine took it. */
  private dispatch(event: BookingFlowEvent): boolean {
    const result = advanceBookingFlow(this._state(), event);
    if (result.isFailure()) {
      this._error.set(result.error);
      return false;
    }
    this._error.set(null);
    this._state.set(result.value);
    this.persist();
    return true;
  }

  /**
   * Snapshot the flow after every accepted event. Fire-and-forget: a full
   * or disabled `sessionStorage` must never block the wizard, and the only
   * cost of a failed write is that a reload starts over.
   */
  private persist(): void {
    const state = this._state();
    // Both terminal states end the draft's life: the receipt lives on the
    // server now, and a resumable draft pointing at a finished flow is how a
    // reload lands someone back inside a booking they already made.
    if (state.kind === 'confirmed' || state.kind === 'waitlisted') {
      this.draftStore.clear();
      return;
    }

    const draft: BookingDraft = {
      step: state.kind,
      party: {
        ownerId: state.party.ownerId?.value ?? null,
        guests: state.party.guests.map((guest) => ({
          id: guest.id.value,
          label: guest.label.value,
        })),
        nextSequence: state.party.nextGuestSequence,
      },
      cart: this.cartProps(state.cart),
      locationId: this.locationId()?.value ?? null,
      dayKey: this._selectedDayKey(),
      when: state.kind === 'schedule' ? state.when.toProps() : null,
      // The zone EVERY stored day key is expressed in — the declaration's and
      // the single-day pick's alike. See the field on `BookingDraft`. The
      // declared days carry their own, which is the more authoritative of the
      // two; the tracked one covers a draft with a day but no declaration.
      zone: declaredZone(state) ?? this._zone(),
      contact: this._contact(),
      bookedFrom: draftSource(this._bookedFrom()),
      rescheduleOf: draftMove(this._rescheduleOf()),
      timeSlot:
        state.kind === 'review'
          ? {
              startIso: state.selection.timeSlot.start.toISO(),
              endIso: state.selection.timeSlot.end.toISO(),
              zone: state.selection.timeSlot.start.zoneName,
            }
          : null,
    };

    this.draftStore.save(draft);
  }

  /**
   * The cart in its persistence shape.
   *
   * ONE cart serialization in the client: the draft writes it and a waitlist
   * request sends it, and a request whose bag was spelled differently from
   * the draft's is a request the matcher reads back as a different booking.
   * `BookingCart.reconstitute` is the only reader of either.
   */
  private cartProps(cart: BookingCart): ReconstituteBookingCartProps {
    return {
      seats: cart.entries().map(([seatKey, lines]) => ({
        seatKey,
        lines: lines.map((line) => ({
          id: line.id.value,
          serviceId: line.serviceId.value,
          variantId: line.variantId?.value ?? null,
          barberId:
            line.barberPref.kind === 'specific'
              ? line.barberPref.barberId.value
              : null,
        })),
      })),
      nextSequence: cart.nextLineSequence,
    };
  }

  /** `SeatKey` → the map key the cart and the templates both use. */
  seatKey(key: SeatKey): string {
    return seatKeyValue(key);
  }
}

/**
 * The zone a state's declared days are expressed in, if it has any.
 *
 * A free function so the narrowing reads plainly: only the schedule state
 * carries a declaration, and only a non-empty one carries a zone.
 */
function declaredZone(state: BookingFlowState): string | null {
  if (state.kind !== 'schedule') return null;
  return state.when.days[0]?.day.zone ?? null;
}

/**
 * `label(n)` for the first `n` counting up from `from` that is not in
 * `taken` — the ONE placeholder rule, for a prefilled party and for a guest
 * added on the services step alike.
 *
 * NEVER a taken label: the party refuses a guest under a label another guest
 * holds (`DuplicateGuestLabelError` — the server would merge the two), so a
 * placeholder that collided would be an add that silently does nothing.
 * `taken` can block at most `taken.size` ordinals, so one more try always
 * lands — unless `label` ignores its ordinal (a catalogue missing its
 * `{{number}}`). No count can fix the word then, so the number is written
 * after it («Гост 2»), which the same pigeonhole bound lands too.
 */
export function firstUnusedLabel(
  taken: ReadonlySet<string>,
  label: (ordinal: number) => string,
  from = 1,
): string {
  const last = from + taken.size;
  for (let ordinal = from; ordinal <= last; ordinal++) {
    const candidate = label(ordinal).trim();
    if (!taken.has(candidate)) return candidate;
  }
  let numbered = '';
  for (let ordinal = from; ordinal <= last; ordinal++) {
    numbered = `${label(ordinal).trim()} ${ordinal}`.trim();
    if (!taken.has(numbered)) return numbered;
  }
  // Unreachable for any `label` that answers the same word for every
  // ordinal; a pathological one still returns rather than spinning.
  return numbered;
}

/**
 * UUID-shaped, from the platform when it has one. The jsdom fallback stays
 * inside the server's accepted charset (`[A-Za-z0-9_-]{16,64}`), and a weak
 * fallback id costs only idempotency for that attempt — never correctness.
 */
function mintAttemptId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return `attempt_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 12)}`;
}

/**
 * An appointment the flow points at, and who read it. `ownerId` is `null`
 * only when nobody could be named — such a source lives in memory alone, and
 * the first claim releases it.
 */
interface HeldSource {
  readonly appointmentId: string;
  readonly ownerId: string | null;
}

/** The visit being moved, who the server carries with it, and its chairs. */
interface HeldMove extends HeldSource {
  readonly riders: readonly BookingDraftRider[];
  readonly chairTimes: readonly BookingDraftChairTime[];
}

/**
 * Why a `?reschedule=` link did not become a move. The shell says which,
 * instead of opening a bookable flow that would commit a second visit.
 */
export type MoveRefusal =
  /**
   * Everyone on the visit is somebody only the shop can re-seat: the
   * booker's own seat was removed and a companion the shop added is all that
   * is left. The server refuses the same visit (`shop_only`).
   */
  | 'companions_only'
  /**
   * The visit could not be read for this account (gone, somebody else's, or
   * the read failed), or it no longer rebuilds into a bag.
   */
  | 'unavailable'
  /**
   * Somebody the move carries can no longer be served here at all. Their
   * barber is off the active list, their service (or the variant it was
   * sold as) is retired, or no active shop offers their service any more.
   * No time on any day at any shop would take them, and the server
   * refuses the move whatever the client picks. Only the shop can re-seat
   * them. Decided by the shell from the live catalogue (`carriedSeatsInReach`),
   * not by the store, which holds no catalogue.
   */
  | 'carried_out_of_reach';

/** A refused move, and its shop when known — the shell's call button. */
export interface MoveRefusalState {
  readonly reason: MoveRefusal;
  readonly locationId: LocationId | null;
}

/** A held source as the draft stores it; one bound to nobody is not stored. */
function draftSource(held: HeldSource | null): BookingDraftSource | null {
  return held !== null && held.ownerId !== null
    ? { appointmentId: held.appointmentId, ownerId: held.ownerId }
    : null;
}

/** A held move as the draft stores it — the source, its riders and chairs. */
function draftMove(held: HeldMove | null): BookingDraftMove | null {
  const source = draftSource(held);
  return source !== null && held !== null
    ? { ...source, riders: held.riders, chairTimes: held.chairTimes }
    : null;
}

/**
 * A stored source, shape-checked — the draft adapter guards the flow's shape,
 * not these optional fields, and a malformed one is dropped, never guessed.
 */
function heldSource(stored: unknown): HeldSource | null {
  if (stored === null || typeof stored !== 'object') return null;
  const fields = new Map(Object.entries(stored));
  const appointmentId = fields.get('appointmentId');
  const ownerId = fields.get('ownerId');
  return typeof appointmentId === 'string' &&
    appointmentId.length > 0 &&
    typeof ownerId === 'string' &&
    ownerId.length > 0
    ? { appointmentId, ownerId }
    : null;
}

/**
 * A stored move, or `null` when it does not parse.
 *
 * All or nothing. The riders drive the grid's rider check and the chairs its
 * release, so a move restored with one of them dropped is a grid deciding on
 * a visit that does not exist: a missing rider over-offers the times the
 * server refuses for that seat. A move that cannot come back whole does not
 * come back at all ({@link BookingFlowStore.restore}), and the link lands it
 * again from the live visit.
 */
function heldMove(stored: unknown): HeldMove | null {
  const source = heldSource(stored);
  if (source === null || stored === null || typeof stored !== 'object') {
    return null;
  }
  const fields = new Map(Object.entries(stored));
  const riders: unknown = fields.get('riders');
  const chairTimes: unknown = fields.get('chairTimes');
  if (
    !Array.isArray(riders) ||
    !riders.every((rider: unknown) => isRider(rider)) ||
    !Array.isArray(chairTimes) ||
    !chairTimes.every((chair: unknown) => isChairTime(chair))
  ) {
    return null;
  }
  return {
    ...source,
    riders: riders as readonly BookingDraftRider[],
    chairTimes: chairTimes as readonly BookingDraftChairTime[],
  };
}

function isChairTime(value: unknown): value is BookingDraftChairTime {
  if (value === null || typeof value !== 'object') return false;
  const fields = new Map(Object.entries(value));
  const startMs = fields.get('startMs');
  const endMs = fields.get('endMs');
  return (
    typeof fields.get('barberId') === 'string' &&
    typeof startMs === 'number' &&
    typeof endMs === 'number' &&
    Number.isFinite(startMs) &&
    Number.isFinite(endMs) &&
    startMs < endMs &&
    // The grid's own reading of it, not a looser one: a chair it could not
    // name a barber for is a chair it would silently stop handing back.
    chairTimeOf(value as BookingDraftChairTime) !== null
  );
}

/**
 * A held chair → what the day query hands back, or `null` when its barber
 * is not a barber id. The one reading shared by the restore guard
 * (`isChairTime`) and the grid (`moveRelease`).
 */
function chairTimeOf(chair: BookingDraftChairTime): ChairTime | null {
  const barberId = BarberId.create(chair.barberId);
  return barberId.isSuccess()
    ? {
        barberId: barberId.value,
        occupied: Interval.of(chair.startMs, chair.endMs),
      }
    : null;
}

/**
 * A held rider → what the day query checks it by, or `null` when any of its
 * identities does not parse. The one reading shared by the restore guard
 * (`isRider`) and the grid (`availabilityRiders`), so a rider the guard lets
 * through is always a rider the grid checks.
 */
function moveRiderOf(rider: BookingDraftRider): MoveRider | null {
  const barberId = BarberId.create(rider.barberId);
  const serviceId = ServiceId.create(rider.serviceId);
  const variantParses =
    rider.variantId === null ||
    ServiceVariantId.create(rider.variantId).isSuccess();
  if (barberId.isFailure() || serviceId.isFailure() || !variantParses) {
    return null;
  }
  return {
    serviceId: serviceId.value,
    barberId: barberId.value,
    offsetMinutes: rider.offsetMinutes,
    terms: {
      durationMinutes: rider.durationMinutes,
      padBeforeMinutes: rider.setupMinutes,
      padAfterMinutes: rider.cleanupMinutes,
    },
  };
}

function isRider(value: unknown): value is BookingDraftRider {
  if (value === null || typeof value !== 'object') return false;
  const fields = new Map(Object.entries(value));
  const variantId = fields.get('variantId');
  const offset = fields.get('offsetMinutes');
  // Whole minutes, every one: the grid measures the rider's chair time by
  // them, and a rider it cannot measure is one it could strand.
  const minutes = (name: string, min: number): boolean => {
    const raw = fields.get(name);
    return typeof raw === 'number' && Number.isInteger(raw) && raw >= min;
  };
  return (
    typeof fields.get('serviceId') === 'string' &&
    typeof fields.get('barberId') === 'string' &&
    (variantId === null || typeof variantId === 'string') &&
    typeof offset === 'number' &&
    Number.isInteger(offset) &&
    minutes('durationMinutes', 1) &&
    minutes('setupMinutes', 0) &&
    minutes('cleanupMinutes', 0) &&
    // Its identities as the grid reads them: an empty or malformed barber
    // or service id passed the shape check above, restored, and was then
    // dropped from the rider check — the one thing restoring whole exists
    // to prevent.
    moveRiderOf(value as BookingDraftRider) !== null
  );
}
