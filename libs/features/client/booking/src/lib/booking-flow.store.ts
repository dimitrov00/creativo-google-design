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
  type CartLine,
  CartLineId,
  GuestId,
  MAX_PARTY_SIZE,
  NewCartLine,
  type CommitBookingSeatRequest,
  ScheduleSelection,
  SeatKey,
  advanceBookingFlow,
  initialBookingFlowState,
  seatKeyValue,
} from '@creativo/application/booking';
import { LocationId, ServiceVariantId } from '@creativo/application/catalog';

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
  private readonly draftStore = inject(BOOKING_DRAFT_STORE);
  private readonly gateway = inject(BOOKING_GATEWAY);

  private readonly _state = signal<BookingFlowState>(initialBookingFlowState());
  readonly state = this._state.asReadonly();

  /**
   * The last rejected transition. Cleared by the NEXT successful dispatch —
   * an error that outlives the thing it was about is noise, and this is the
   * only place that can know the difference.
   */
  private readonly _error = signal<
    BookingFlowError | BookingGatewayError | null
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
    if (state.kind === 'review') return state.selection.locationId;
    return state.locationId;
  });

  readonly party = computed<BookingParty | null>(() => {
    const state = this._state();
    return state.kind === 'confirmed' ? null : state.party;
  });

  readonly cart = computed<BookingCart | null>(() => {
    const state = this._state();
    return state.kind === 'confirmed' ? null : state.cart;
  });

  readonly guests = computed(() => this.party()?.guests ?? []);

  /** The booker plus their guests — what "party size" means to a person. */
  readonly partySize = computed(() => this.guests().length + 1);

  readonly maxPartySize = MAX_PARTY_SIZE;

  readonly canAddGuest = computed(() => this.partySize() < MAX_PARTY_SIZE);

  readonly isClaimed = computed(() => this.party()?.isClaimed() ?? true);

  readonly lineCount = computed(() => this.cart()?.lineCount() ?? 0);

  readonly totalSteps = BOOKING_FLOW_STEPS.length;

  /** 1-based position on the wizard spine; terminal states report the end. */
  readonly currentStep = computed(() => {
    const index = BOOKING_FLOW_STEPS.indexOf(this.step());
    return index === -1 ? this.totalSteps : index + 1;
  });

  readonly canGoBack = computed(() => this.currentStep() > 1);

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
    this.dispatch({ type: 'select_schedule', selection });
  }

  selectDay(dayKey: string): void {
    // A different day cannot keep the previous day's time.
    this._selectedStartMs.set(null);
    this._selectedShopKey.set(null);
    this._selectedDayKey.set(dayKey);
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

    this._pending.set(true);
    try {
      const result = await this.gateway.commit({
        locationId: state.selection.locationId.value,
        seats,
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
    if (state.kind === 'confirmed' || state.party.isClaimed()) return;
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
    if (
      (draft.step === 'schedule' || draft.step === 'review') &&
      !cartResult.value.isEmpty()
    ) {
      this._selectedDayKey.set(draft.dayKey);
      this._state.set({
        kind: 'schedule',
        party: partyResult.value,
        cart: cartResult.value,
        locationId,
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

  clearDraft(): void {
    this.draftStore.clear();
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
    if (state.kind === 'confirmed') {
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
      cart: {
        seats: state.cart.entries().map(([seatKey, lines]) => ({
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
        nextSequence: state.cart.nextLineSequence,
      },
      locationId: this.locationId()?.value ?? null,
      dayKey: this._selectedDayKey(),
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

  /** `SeatKey` → the map key the cart and the templates both use. */
  seatKey(key: SeatKey): string {
    return seatKeyValue(key);
  }
}
