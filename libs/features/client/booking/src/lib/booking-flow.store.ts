import { Injectable, computed, inject, signal } from '@angular/core';
import {
  BOOKING_DRAFT_STORE,
  BOOKING_FLOW_STEPS,
  BOOKING_GATEWAY,
  BarberPref,
  BookingCart,
  BookingConfirmation,
  BookingDraft,
  BookingGatewayError,
  BookingFlowError,
  BookingFlowEvent,
  BookingFlowState,
  BookingFlowStep,
  BookingParty,
  CalendarDay,
  type CartLine,
  CartLineId,
  FlexibleWhen,
  GuestId,
  MAX_PARTY_SIZE,
  NewCartLine,
  type CommitBookingSeatRequest,
  type ReconstituteBookingCartProps,
  ScheduleSelection,
  SeatKey,
  WAITLIST_GATEWAY,
  WaitlistGatewayError,
  type WaitlistedSummary,
  advanceBookingFlow,
  firstSeatWithoutService,
  initialBookingFlowState,
  seatKeyValue,
} from '@creativo/application/booking';
import { LocationId, ServiceVariantId } from '@creativo/application/catalog';
import type {
  Appointment,
  BookingContactProps,
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

  removeGuest(guestId: GuestId): void {
    this.dispatch({ type: 'remove_guest', guestId });
  }

  renameGuest(guestId: GuestId, label: string): void {
    this.dispatch({ type: 'rename_guest', guestId, label });
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
  private readonly _rescheduleOf = signal<string | null>(null);
  readonly rescheduleOf = this._rescheduleOf.asReadonly();
  readonly isRescheduling = computed(() => this._rescheduleOf() !== null);

  /** Rebuild the flow around an appointment being moved. */
  rescheduleFrom(
    appointment: Appointment,
    guestLabel: (ordinal: number) => string,
  ): boolean {
    if (!this.repeat(appointment, guestLabel)) return false;
    this._rescheduleOf.set(appointment.id.value);
    this.persist();
    return true;
  }

  async commit(): Promise<void> {
    const state = this._state();
    if (state.kind !== 'review' || this._pending()) return;

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

    this._pending.set(true);
    try {
      const movingId = this._rescheduleOf();
      const result = movingId
        ? // A MOVE, not a second booking: the server keeps the appointment's
          // id, its status and its contact, and refuses the same window a
          // cancellation would be refused in.
          await this.gateway.reschedule({
            appointmentId: movingId,
            locationId: state.selection.locationId.value,
            seats,
          })
        : await this.gateway.commit({
            locationId: state.selection.locationId.value,
            seats,
            attemptId: this._attemptId,
            // Whatever the review step captured — the account's own details, or
            // the one-time override the contact sheet set. Omitted entirely when
            // there is none, so an anonymous-assembled draft still commits.
            ...(contact ? { contact } : {}),
          });

      if (result.isFailure()) {
        this._error.set(result.error);
        if (result.error.isSlotTaken()) {
          this._selectedStartMs.set(null);
          this._selectedShopKey.set(null);
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
        startIso: assignment.slot.start.toISO(),
        subject:
          found.seatKey === 'self'
            ? { kind: 'self' }
            : { kind: 'guest', label: label as string },
      });
    }
    return seats;
  }

  /**
   * Attach the signed-in booker to a party assembled anonymously. Called
   * when the principal turns active mid-flow (the review step's sign-in
   * round trip) — the roster, the cart and both monotonic counters survive.
   */
  claim(ownerId: string): void {
    const state = this._state();
    // Both terminal states are past claiming: the server already knows who
    // owns what it accepted.
    if (state.kind === 'confirmed' || state.kind === 'waitlisted') return;
    if (state.party.isClaimed()) return;
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
    const partyResult = BookingParty.reconstitute({
      ownerId: request.ownerId.value,
      guests: guestIds.map((id, index) => ({
        id,
        label: guestLabel(index + 1),
      })),
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
   * Guests come back as placeholder labels for the same reason the waitlist
   * landing does it: a party's names were never persisted on the
   * appointment, only its seats.
   */
  repeat(
    appointment: Appointment,
    guestLabel: (ordinal: number) => string,
  ): boolean {
    const seatKeys = new Map<string, string>();
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
      // `self` for the booker's own seat; every other subject becomes a
      // guest seat under a fresh id — a stored `GuestId` belongs to the
      // party that has since been thrown away.
      const isSelf =
        seat.subject.kind === 'account' && seat.subject.relationship === 'self';
      const source = seat.id.value;
      let seatKey = seatKeys.get(source);
      if (!seatKey) {
        seatKey = isSelf ? 'self' : `guest-${guestOrdinal++}`;
        seatKeys.set(source, seatKey);
        lines.push({ seatKey, lines: [] });
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
    const partyResult = BookingParty.reconstitute({
      // The party() accessor, not the raw state: a terminal state keeps its
      // party inside its receipt and has none at the top level.
      ownerId: this.party()?.ownerId?.value ?? null,
      guests: guestIds.map((id, index) => ({
        id,
        label: guestLabel(index + 1),
      })),
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

  /** Rebuild from a persisted draft. Silently starts fresh if there is none. */
  restore(): void {
    const loaded = this.draftStore.load();
    if (loaded.isFailure() || loaded.value === null) return;

    const draft = loaded.value;
    const partyResult = BookingParty.reconstitute(draft.party);
    const cartResult = BookingCart.reconstitute(draft.cart);
    if (partyResult.isFailure() || cartResult.isFailure()) {
      // A draft the domain refuses is worse than no draft — drop it rather
      // than resuming into a party that failed its own invariants.
      this.draftStore.clear();
      return;
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
    // it belongs to the booking, not to any one step of it.
    this._contact.set(draft.contact ?? null);

    if (draft.step === 'location') {
      this._state.set({
        kind: draft.step,
        party: partyResult.value,
        cart: cartResult.value,
        locationId,
      });
      return;
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
    // guard on its own.
    if (
      (draft.step === 'schedule' || draft.step === 'review') &&
      !cartResult.value.isEmpty() &&
      firstSeatWithoutService(partyResult.value, cartResult.value) === null
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
      return;
    }

    this._state.set({
      kind: 'services',
      party: partyResult.value,
      cart: cartResult.value,
      locationId,
    });
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

  private dispatch(event: BookingFlowEvent): void {
    const result = advanceBookingFlow(this._state(), event);
    if (result.isFailure()) {
      this._error.set(result.error);
      return;
    }
    this._error.set(null);
    this._state.set(result.value);
    this.persist();
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
