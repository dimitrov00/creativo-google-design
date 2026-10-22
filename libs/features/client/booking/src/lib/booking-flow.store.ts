import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom, take } from 'rxjs';
import {
  APPOINTMENT_READ_PORTS,
  BOOKING_DRAFT_PORTS,
  GATEWAY_PORTS,
  ID_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { Callables } from '@core/ports';
import type { Appointment, WaitlistRequest } from '@core/entities';
import {
  type BookingCall,
  type BookingConfirmation,
  BookingCart,
  BookingContact,
  BookingDraft,
  BookingDraftOrigin,
  BookingFlowState,
  BookingFlowStep,
  BookingPolicy,
  type ChairTime,
  FlexibleWhen,
  type MoveRider,
  MoveRefusal,
  MoveRefusalReason,
  Party,
  type PartyMember,
  Placement,
  type ScheduleSelection,
  type WaitlistedSummary,
} from '@core/components';
import {
  type AppointmentId,
  type BarberId,
  type BookingFlowError,
  type CartLineId,
  ClientOperationId,
  type GuestId,
  LocalDate,
  type LocationId,
  type MinuteOfDay,
  PipelineError,
  PipelineErrorCode,
  Result,
  type SeatKeyText,
  type ServiceVariantId,
  type UserId,
  defect,
} from '@core/primitives';
import {
  BookingCartSystem,
  type BookingFlowEvent,
  BookingFlowEventKind,
  type BookingFlowLimits,
  BookingFlowSystem,
  type CartRider,
  GuestLabelSystem,
  MoveSystem,
  PrefillCompanions,
} from '@core/systems';

/** What the flow can be refused with: the machine's own word, or a call's. */
export type BookingFlowFailure = BookingFlowError | PipelineError;

/** The wizard's two policy numbers — the booking policy's own defaults. */
const FLOW_LIMITS: BookingFlowLimits = BookingPolicy.DEFAULT;

/** Before every day a draft can name — prunes nothing. */
const EARLIEST_DAY: LocalDate =
  localDateOrNull('0001-01-01') ?? defect('unreachable: the earliest day');

const NO_RIDERS: readonly MoveRider[] = [];
const NO_CHAIRS: readonly ChairTime[] = [];

/**
 * Holds the booking wizard's state (`BookingFlowState`) and steps it with
 * `BookingFlowSystem` — plus the two things the machine deliberately
 * doesn't model: draft persistence (`BOOKING_DRAFT_PORTS`, the flat
 * `BookingDraft`) and the server round trips (`GATEWAY_PORTS`, the
 * `BookingCall` / `WaitlistCall` wire).
 *
 * One instance per `/book` visit — provided component-scoped on
 * `ClientBooking`, not root, so re-entering the route starts clean unless a
 * draft says otherwise.
 *
 * Translation-free by design: `error()` carries a flat error struct whose
 * `errorCode` the components word at render time (`errors.<errorCode>`),
 * never a display string. The URL's lowercase step words are the shell's
 * (`BOOKING_STEP_WORDS`); the store speaks the dictionary.
 */
@Injectable()
export class BookingFlowStore {
  private readonly drafts = inject(BOOKING_DRAFT_PORTS);
  private readonly gateway = inject(GATEWAY_PORTS);
  private readonly ids = inject(ID_PORTS);
  /** The visit being moved, re-read when the flow's copy may be stale. */
  private readonly appointments = inject(APPOINTMENT_READ_PORTS);

  private readonly _state = signal<BookingFlowState>(
    BookingFlowState.initial(Party.anonymous()),
  );
  readonly state = this._state.asReadonly();

  /**
   * The last rejected transition. Cleared by the NEXT successful dispatch —
   * an error that outlives the thing it was about is noise, and this is the
   * only place that can know the difference.
   */
  private readonly _error = signal<BookingFlowFailure | null>(null);
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
  private readonly _selectedLocalDate = signal<LocalDate | null>(null);
  readonly selectedLocalDate = this._selectedLocalDate.asReadonly();

  /** The chosen start, a minute of the chosen shop day. */
  private readonly _selectedStartMinutes = signal<MinuteOfDay | null>(null);
  readonly selectedStartMinutes = this._selectedStartMinutes.asReadonly();

  /**
   * Which shop's offer was tapped.
   *
   * A start alone is ambiguous under "any shop": two shops can be free at
   * 14:00, and they are different appointments. The chip carries both.
   */
  private readonly _selectedLocationId = signal<LocationId | null>(null);
  readonly selectedLocationId = this._selectedLocationId.asReadonly();

  /**
   * A restored day and declaration not yet judged against TODAY.
   *
   * The draft holds no zone (Law 7.2: the zone is the location's), so a
   * restore cannot tell on its own whether a stored day has gone by. The
   * schedule step — the one screen that shows the day, and the one that
   * knows the shop's "today" — settles it once it has a clock reading
   * ({@link settleLapsedDays}).
   */
  private lapsedUnsettled = false;

  private readonly _pending = signal(false);
  /** A commit round-trip is in flight — presentational, not in the state union. */
  readonly pending = this._pending.asReadonly();

  // ── Derived view of the machine ────────────────────────────────────

  readonly step = computed<BookingFlowStep>(
    () => this._state().bookingFlowStep,
  );

  readonly confirmation = computed<BookingConfirmation | null>(() => {
    const state = this._state();
    return state.bookingFlowStep === BookingFlowStep.Confirmed
      ? state.confirmation
      : null;
  });

  readonly selection = computed<ScheduleSelection | null>(() => {
    const state = this._state();
    if (state.bookingFlowStep === BookingFlowStep.Review) {
      return state.selection;
    }
    if (state.bookingFlowStep === BookingFlowStep.Confirmed) {
      return state.confirmation.selection;
    }
    return null;
  });

  /** True when the last failure is one a fresh grid can fix. */
  readonly slotTaken = computed(() => {
    const error = this._error();
    return (
      error !== null &&
      PipelineError.isPipelineError(error) &&
      error.errorCode === PipelineErrorCode.SlotUnavailable
    );
  });

  /** The shop the client chose (`ShopLocation.id`), or `null` for "any shop". */
  readonly locationId = computed<LocationId | null>(() => {
    const state = this._state();
    switch (state.bookingFlowStep) {
      case BookingFlowStep.Confirmed:
        return state.confirmation.selection.locationId;
      case BookingFlowStep.Waitlisted:
        return state.summary.locationId;
      case BookingFlowStep.Review:
        return state.selection.locationId;
      default:
        return state.locationId;
    }
  });

  // Both terminal states hold their party and cart INSIDE their receipt, so
  // the screens that render them read the same signals every other step does
  // rather than reaching into a state-specific shape.
  readonly party = computed<Party | null>(() => {
    const state = this._state();
    if (state.bookingFlowStep === BookingFlowStep.Confirmed) return null;
    if (state.bookingFlowStep === BookingFlowStep.Waitlisted) {
      return state.summary.party;
    }
    return state.party;
  });

  /** The bag — what every step hands the catalogue and availability systems. */
  readonly cart = computed<BookingCart | null>(() => {
    const state = this._state();
    if (state.bookingFlowStep === BookingFlowStep.Confirmed) return null;
    if (state.bookingFlowStep === BookingFlowStep.Waitlisted) {
      return state.summary.cart;
    }
    return state.cart;
  });

  readonly guests = computed<readonly PartyMember.Guest[]>(() => {
    const party = this.party();
    return party === null ? [] : Party.guests(party);
  });

  /** The booker plus their guests — what "party size" means to a person. */
  readonly partySize = computed(() => this.guests().length + 1);

  readonly maxPartySize = FLOW_LIMITS.maxPartySize;

  readonly canAddGuest = computed(() => {
    const party = this.party();
    return party === null || BookingFlowSystem.canAddGuest(party, FLOW_LIMITS);
  });

  readonly isClaimed = computed(() => {
    const party = this.party();
    return party === null || Party.isClaimed(party);
  });

  readonly lineCount = computed(() => {
    const cart = this.cart();
    return cart === null ? 0 : BookingCart.lineCount(cart);
  });

  /**
   * The flexible declaration, or an empty one everywhere it cannot exist.
   *
   * Empty rather than `null` off the schedule step so no template has to
   * null-check it — `FlexibleWhen.empty()` answers every question a populated
   * one does.
   */
  readonly when = computed<FlexibleWhen>(() => {
    const state = this._state();
    if (state.bookingFlowStep === BookingFlowStep.Schedule) return state.when;
    if (state.bookingFlowStep === BookingFlowStep.Waitlisted) {
      return state.summary.when;
    }
    return FlexibleWhen.empty();
  });

  readonly waitlisted = computed<WaitlistedSummary | null>(() => {
    const state = this._state();
    return state.bookingFlowStep === BookingFlowStep.Waitlisted
      ? state.summary
      : null;
  });

  readonly totalSteps = BookingFlowState.SPINE.length;

  /**
   * The flow is OVER — confirmed or waitlisted, the states that are not on
   * the wizard spine. The machine refuses `back` from here, so the shell
   * drops its whole navigation chrome rather than showing controls that
   * cannot do anything.
   */
  readonly isTerminal = computed(() =>
    BookingFlowSystem.isTerminal(this.step()),
  );

  /** 1-based position on the wizard spine; terminal states report the end. */
  readonly currentStep = computed(() =>
    BookingFlowSystem.currentStep(this.step()),
  );

  // Terminal states report step 4 of 4, which used to light this up on the
  // confirmation screen — a back chevron the machine answers with a refusal.
  readonly canGoBack = computed(() => BookingFlowSystem.canGoBack(this.step()));

  // ── Commands ───────────────────────────────────────────────────────

  addGuest(label: string): void {
    this.dispatch({
      bookingFlowEventKind: BookingFlowEventKind.AddGuest,
      label,
    });
  }

  /**
   * A placeholder name for a guest about to be added: `label(n)` for the
   * first `n` from `from` that nobody in the party already answers to
   * (`GuestLabelSystem.firstUnusedLabel`, the one placeholder rule).
   *
   * A guest's label is their identity on the wire — the server counts people
   * by it (`personKey`) — so a fresh «Гост 3» beside a prefilled guest the
   * visit stored as «Гост 3» would merge two people into one.
   */
  unusedGuestLabel(label: (ordinal: number) => string, from = 1): string {
    return GuestLabelSystem.firstUnusedLabel(
      this.guests().map((guest) => guest.guestLabel),
      label,
      from,
    );
  }

  removeGuest(guestId: GuestId): void {
    this.dispatch({
      bookingFlowEventKind: BookingFlowEventKind.RemoveGuest,
      guestId,
    });
  }

  /**
   * Relabel a guest. Answers whether the party took it — a label another
   * guest already answers to is refused
   * (`SCHEDULING_BOOKING_PARTY_DUPLICATE_LABEL`, held on {@link error}), and
   * the services step keeps the field open to say so.
   */
  renameGuest(guestId: GuestId, label: string): boolean {
    return this.dispatch({
      bookingFlowEventKind: BookingFlowEventKind.RenameGuest,
      guestId,
      label,
    });
  }

  addLine(seatKey: SeatKeyText, line: BookingCart.NewLine): void {
    this.dispatch({
      bookingFlowEventKind: BookingFlowEventKind.AddLine,
      seatKey,
      line,
    });
  }

  removeLine(seatKey: SeatKeyText, lineId: CartLineId): void {
    this.dispatch({
      bookingFlowEventKind: BookingFlowEventKind.RemoveLine,
      seatKey,
      lineId,
    });
  }

  setLineVariant(
    seatKey: SeatKeyText,
    lineId: CartLineId,
    variantId: ServiceVariantId | null,
  ): void {
    this.dispatch({
      bookingFlowEventKind: BookingFlowEventKind.SetLineVariant,
      seatKey,
      lineId,
      variantId,
    });
  }

  /** Re-point a line to a barber, or back to anyone (`null`). */
  setLineBarber(
    seatKey: SeatKeyText,
    lineId: CartLineId,
    barberId: BarberId | null,
  ): void {
    this.dispatch({
      bookingFlowEventKind: BookingFlowEventKind.SetLineBarber,
      seatKey,
      lineId,
      barberId,
    });
  }

  /** `null` is the "any shop" answer — a choice, not the absence of one. */
  selectLocation(locationId: LocationId | null): void {
    // A different shop has different barbers and different hours, so the day
    // and time below it are stale the moment it changes.
    this.clearSchedulePick();
    this.dispatch({
      bookingFlowEventKind: BookingFlowEventKind.SelectLocation,
      locationId,
    });
  }

  selectSchedule(selection: ScheduleSelection): void {
    // A fresh idempotency key per ARMED selection: retries of this attempt
    // reuse it (a lost response replays as success server-side), while a new
    // selection after a bounce is honestly a new attempt.
    this._attemptId = this.mintAttemptId();
    this.dispatch({
      bookingFlowEventKind: BookingFlowEventKind.SelectSchedule,
      selection,
    });
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
  watchOnly(localDate: LocalDate): void {
    this.dispatch({ bookingFlowEventKind: BookingFlowEventKind.ClearFlexible });
    this.dispatch({
      bookingFlowEventKind: BookingFlowEventKind.ToggleFlexibleDay,
      localDate,
    });
  }

  /** The chosen shop day. A different day cannot keep the previous day's time. */
  selectDay(localDate: LocalDate): void {
    this._selectedStartMinutes.set(null);
    this._selectedLocationId.set(null);
    this._selectedLocalDate.set(localDate);
  }

  selectStart(startMinutes: MinuteOfDay, locationId: LocationId): void {
    this._selectedStartMinutes.set(startMinutes);
    this._selectedLocationId.set(locationId);
  }

  /** Forget all three — a different shop has different days AND different times. */
  clearSchedulePick(): void {
    this._selectedLocalDate.set(null);
    this._selectedStartMinutes.set(null);
    this._selectedLocationId.set(null);
  }

  /**
   * The `CartLineId` of a line the cart itself holds, so the schedule step
   * can hand assignments back keyed by a line that still exists. Returns
   * `null` for an id no line holds — an assignment naming a line that has
   * since been removed must not reach the machine.
   */
  cartLineId(raw: string): CartLineId | null {
    const cart = this.cart();
    if (!cart) return null;
    for (const seat of cart.cartSeats) {
      for (const line of seat.lines) {
        if (line.lineId === raw) return line.lineId;
      }
    }
    return null;
  }

  next(): void {
    this.dispatch({ bookingFlowEventKind: BookingFlowEventKind.Next });
  }

  back(): void {
    this.dispatch({ bookingFlowEventKind: BookingFlowEventKind.Back });
  }

  /**
   * Ask the server to watch these days for us (`requestWaitlist`).
   *
   * The mirror of {@link commit}, and server-side for the same reason: the
   * request names an owner, and who you are is the one fact a caller must not
   * be able to choose. It is also the only place in the flow where signing in
   * is not a formality at the end — there is nobody to notify without an
   * account, so `PIPELINE_UNAUTHENTICATED` is a normal, actionable outcome
   * here rather than an error, and the caller surfaces the sign-in prompt on
   * it.
   *
   * The declaration survives the round trip either way: it is persisted in the
   * draft, so a sign-in redirect costs the user nothing.
   */
  async submitWaitlist(): Promise<void> {
    const state = this._state();
    if (state.bookingFlowStep !== BookingFlowStep.Schedule || this._pending()) {
      return;
    }
    if (FlexibleWhen.isEmpty(state.when)) return;

    this._pending.set(true);
    try {
      // ONE cart serialization in the client: the draft writes it and a
      // waitlist request sends it — the `BookingCart` component itself.
      const result = await this.gateway.callableClient(
        Callables.RequestWaitlist,
      )({
        locationId: state.locationId,
        days: state.when.flexibleDays,
        cart: state.cart,
      });

      if (!result.ok) {
        this._error.set(result.error);
        return;
      }
      this.dispatch({
        bookingFlowEventKind: BookingFlowEventKind.Waitlisted,
        requestId: result.value.requestId,
      });
    } finally {
      this._pending.set(false);
    }
  }

  /** The armed selection's idempotency key — see {@link selectSchedule}. */
  private _attemptId: ClientOperationId | null = this.mintAttemptId();

  /**
   * The appointment this flow is MOVING, if it is a reschedule rather than a
   * new booking.
   *
   * Held beside the machine because it changes nothing about the wizard's
   * shape — the same four steps ask the same questions — and everything
   * about what the last one does.
   */
  private readonly _rescheduleOf = signal<HeldMove | null>(null);
  readonly rescheduleOf = computed<AppointmentId | null>(
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
   * Both are persisted with the draft (its `bookingDraftOrigin`) — the review
   * step's sign-in round trip comes back without the `?repeat=` /
   * `?reschedule=` that set them — and both are BOUND to the account that
   * read the visit: a different account claiming the flow drops them
   * (`claim`), so one person's booking never names another person's visit.
   */
  private readonly _bookedFrom = signal<HeldVisit | null>(null);
  readonly bookedFrom = computed<AppointmentId | null>(
    () => this._bookedFrom()?.appointmentId ?? null,
  );

  /**
   * Who moves WITH the visit without being in the cart — the seats the
   * server carries (`MoveSystem.facts`): their service and the variant it was
   * sold as, their barber, their wall-clock distance from the move anchor and
   * the chair time they were SOLD at — what the shell asks the catalogue's
   * reach about (`MoveSystem.carriedSeatsInReach`) and the review card places
   * (`MoveSystem.placeRiders`). Empty on a new booking.
   */
  readonly moveRiders = computed<readonly MoveRider[]>(
    () => this._rescheduleOf()?.riders ?? NO_RIDERS,
  );

  /**
   * The riders as the day query takes them (`CartRider`) — pinned to the
   * party's start, on their own barber and their SOLD terms, with the
   * service they are served — for the engine's rider check, which drops
   * every start where somebody the server carries could not sit, and for
   * the shop check, which drops every shop that does not offer their
   * service. The schedule step puts them on each day query.
   */
  readonly availabilityRiders = computed<readonly CartRider[]>(() =>
    MoveSystem.cartRiders(this.moveRiders()),
  );

  /**
   * The chair time the visit being moved holds now, handed back on every day
   * query of the move (`DayQuery.release`). Its own seats never block its
   * own move, because the server decides a move with the visit's
   * contribution subtracted. Empty on a new booking. Minutes of
   * {@link moveLocalDate}, the visit's own shop day.
   */
  readonly moveRelease = computed<readonly ChairTime[]>(
    () => this._rescheduleOf()?.release ?? NO_CHAIRS,
  );

  /** The shop day the visit being moved stands on now — its chairs' day. */
  readonly moveLocalDate = computed<LocalDate | null>(
    () => this._rescheduleOf()?.localDate ?? null,
  );

  /**
   * The visit a `?reschedule=` link asked to move — held from the moment the
   * link arrives, before (and whether or not) that visit can be read. See
   * {@link expectMove}.
   */
  private readonly _moveAsked = signal<string | null>(null);

  private readonly _moveRefusal = signal<MoveRefusal | null>(null);
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
  refuseMove(
    reason: MoveRefusalReason,
    locationId: LocationId | null = null,
  ): void {
    this._moveRefusal.set(MoveRefusal.of(reason, locationId));
  }

  /**
   * Rebuild the flow around an appointment being moved — or say why it
   * cannot be (the refusal is also held on {@link moveRefusal}).
   */
  rescheduleFrom(
    appointment: Appointment,
    guestLabel: (ordinal: number) => string,
  ): Result<void, MoveRefusalReason> {
    const facts = MoveSystem.facts(appointment, this.readerOf(appointment));
    if (facts === null) {
      // Nobody is left for the cart to stand in for (staff removed the
      // booker's own seat): only the shop can move the rest, and the server
      // refuses the same visit as `shop_only`. Said here, before a single
      // step is shown.
      this.refuseMove(MoveRefusalReason.CompanionsOnly, appointment.locationId);
      return Result.err(MoveRefusalReason.CompanionsOnly);
    }
    if (
      !this.prefillFrom(
        appointment,
        guestLabel,
        PrefillCompanions.CarriedByServer,
      )
    ) {
      this.refuseMove(MoveRefusalReason.Unavailable, appointment.locationId);
      return Result.err(MoveRefusalReason.Unavailable);
    }

    this._moveRefusal.set(null);
    // A move keeps its own appointment; it is not a booking made from one.
    this._bookedFrom.set(null);
    this._rescheduleOf.set({
      ...this.sourceOf(appointment),
      localDate: appointment.localDate,
      riders: facts.riders,
      release: facts.release,
    });
    this.persist();
    return Result.ok(undefined);
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

    // One reading of the live visit: its first answer.
    const found = await firstValueFrom(
      this.appointments.observeAppointment(held.appointmentId).pipe(take(1)),
    );
    // The flow let go of this move while the read was out (a claim by
    // somebody else, another landing): the answer is about nothing it holds.
    if (this._rescheduleOf()?.appointmentId !== held.appointmentId) return;
    if (!found.ok) return;
    if (found.value === null) {
      this.refuseMove(MoveRefusalReason.Unavailable);
      return;
    }

    const facts = MoveSystem.facts(found.value, this.readerOf(found.value));
    if (facts === null) {
      this.refuseMove(MoveRefusalReason.CompanionsOnly, found.value.locationId);
      return;
    }
    this._rescheduleOf.set({
      ...held,
      localDate: found.value.localDate,
      riders: facts.riders,
      release: facts.release,
    });
    this.persist();
  }

  /**
   * Ask the server to write the booking (`commitBooking`) — or, on a move,
   * to move the visit (`rescheduleAppointment`).
   *
   * The client sends WHAT it wants and WHO it wants it from, on the shop's
   * wall clock (`BookingCall.Seat`: the selection's day and each seat's
   * start minute — the pipeline places them on the absolute timeline once,
   * with the location's zone); the server re-derives the price, the roster
   * and the collision set and is the only thing that can actually create an
   * appointment. So the two outcomes here are not "success and error" — they
   * are "written" and "the shop's answer changed", and the second one is a
   * normal Tuesday.
   *
   * On `PIPELINE_SLOT_UNAVAILABLE` the flow steps BACK to the schedule and
   * drops only the time: the day, the party and the bag all survive, and the
   * grid the user lands on is recomputed from live data rather than the
   * offer that just expired. Any other failure stays on review — nothing
   * about re-picking a time would fix a withdrawn service or a lost
   * connection.
   */
  async commit(): Promise<void> {
    const state = this._state();
    if (state.bookingFlowStep !== BookingFlowStep.Review || this._pending()) {
      return;
    }

    // A flow opened to MOVE a visit ends as that move or not at all. Until
    // the visit is read and rebuilt — and for good once it is refused —
    // there is no move to send, and a commit here would book a SECOND visit
    // beside the one the person meant to move.
    const asked = this._moveAsked();
    const moving = this._rescheduleOf();
    if (asked !== null && moving?.appointmentId !== asked) {
      this._error.set(PipelineError.bare(PipelineErrorCode.Unavailable));
      return;
    }

    // One entry per assignment, WHAT and WHO, never a price or a duration; a
    // guest travels as their LABEL plus their seat key. `null` when an
    // assignment names a line the cart no longer holds — refusing here beats
    // sending a request the server would reject for a reason the user cannot
    // act on.
    const seats = BookingCartSystem.toCommitSeats(
      state.cart,
      state.party,
      state.selection.assignments,
    );
    if (seats === null) {
      this._error.set(PipelineError.bare(PipelineErrorCode.InvalidRequest));
      return;
    }

    this._pending.set(true);
    try {
      const result =
        moving !== null
          ? await this.sendMove(moving, state.selection, seats)
          : await this.sendBooking(state.selection, seats);

      if (!result.ok) {
        this._error.set(result.error);
        if (result.error.errorCode === PipelineErrorCode.SlotUnavailable) {
          this._selectedStartMinutes.set(null);
          this._selectedLocationId.set(null);
          // A move re-reads its visit BEFORE the grid is recomputed: facts
          // gone stale would offer the refused time straight back.
          if (moving !== null) await this.rereadMove();
          const back = BookingFlowSystem.next(
            this._state(),
            { bookingFlowEventKind: BookingFlowEventKind.Back },
            FLOW_LIMITS,
          );
          if (back.ok) {
            this._state.set(back.value);
            this.persist();
          }
        }
        return;
      }

      this.dispatch({
        bookingFlowEventKind: BookingFlowEventKind.Confirmed,
        appointmentId: result.value.appointmentId,
      });
    } finally {
      this._pending.set(false);
    }
  }

  /**
   * A MOVE, not a second booking (`rescheduleAppointment`): the server keeps
   * the appointment's id, its status and its contact, and refuses the same
   * window a cancellation would be refused in.
   */
  private sendMove(
    moving: HeldMove,
    selection: ScheduleSelection,
    seats: readonly BookingCall.Seat[],
  ): Promise<Result<BookingCall.Rescheduled, PipelineError>> {
    return this.gateway.callableClient(Callables.RescheduleAppointment)({
      appointmentId: moving.appointmentId,
      locationId: selection.locationId,
      localDate: selection.localDate,
      seats,
      // The same name as a commit's, and for the same reason: one per ARMED
      // selection (`selectSchedule`), reused by every retry of it. The
      // server keys the move's audit rows by it, so a retry whose first
      // attempt landed fills a lost row instead of logging nothing — and
      // never logs the move twice.
      attemptId: this._attemptId,
    });
  }

  /**
   * A new booking (`commitBooking`). Its attempt id IS the new
   * appointment's idempotency key, so a selection the id source could not
   * name is refused here, never sent.
   */
  private async sendBooking(
    selection: ScheduleSelection,
    seats: readonly BookingCall.Seat[],
  ): Promise<Result<BookingCall.Committed, PipelineError>> {
    const attemptId = this._attemptId;
    if (attemptId === null) {
      return Result.err(PipelineError.bare(PipelineErrorCode.InvalidRequest));
    }
    const contact = this._contact();
    return this.gateway.callableClient(Callables.CommitBooking)({
      locationId: selection.locationId,
      localDate: selection.localDate,
      seats,
      attemptId,
      // Whatever the review step captured — the account's own details, or
      // the one-time override the contact sheet set. `null` when there is
      // none, so an anonymous-assembled draft still commits.
      contact: BookingContact.isPresent(contact)
        ? BookingContact.inputOf(contact)
        : null,
      // `null` on a cold booking: "we don't know" is all a cold booking can
      // say.
      bookedFromAppointmentId: this._bookedFrom()?.appointmentId ?? null,
      // The client places their own booking, whoever is signed in.
      placement: Placement.Self,
      onBehalfOfUserId: null,
    });
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
   * account — their own seat read as a stranger's (`Seat.isMovableByBooker`),
   * and a visit holding only that seat was refused as the shop's to move.
   * The same account again is a no-op.
   */
  claim(userId: UserId): void {
    const state = this._state();
    // Both terminal states are past claiming: the server already knows who
    // owns what it accepted.
    if (
      state.bookingFlowStep === BookingFlowStep.Confirmed ||
      state.bookingFlowStep === BookingFlowStep.Waitlisted
    ) {
      return;
    }
    this.releaseSourcesNotReadBy(userId);
    if (state.party.ownerUserId === userId) return;
    this._state.set({ ...state, party: Party.claim(state.party, userId) });
    this.persist();
  }

  // ── History / draft ────────────────────────────────────────────────

  /**
   * Move BACKWARD to `step` if the URL says we're behind where the machine
   * is — the browser-Back contract (`BookingFlowSystem.rewindTo`). Forward
   * jumps are deliberately ignored: hand-editing `?step=review` must not skip
   * the cart, and every forward move has a precondition (`next` checks them)
   * that a URL cannot satisfy.
   */
  rewindTo(step: BookingFlowStep): void {
    const current = this._state();
    const rewound = BookingFlowSystem.rewindTo(current, step, FLOW_LIMITS);
    if (rewound !== current) this._state.set(rewound);
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
   * `/book?waitlist={id}&day={YYYY-MM-DD}`.
   *
   * The request froze the BAG and the SHOP at the moment it was made; the
   * party's guest LABELS were never persisted (a guest is only a label until
   * they have an account), so guests come back under placeholder names the
   * caller supplies — which is exactly what they are on a receipt this old.
   * The request is the stored entity (`waitlistRequests/{id}`): its
   * `cartSeats` are the bag, its `flexibleDays` the days it watches. The
   * day lands as the single-day pick, and the arrival flag makes the
   * schedule step open the times sheet unprompted: the notification promised
   * a live search, not a calendar to re-navigate.
   *
   * Returns false when the frozen bag no longer reads back (a corrupt line
   * counter); the caller falls back to a plain /book entry.
   */
  restoreFromWaitlist(
    request: WaitlistRequest,
    day: string | null,
    guestLabel: (ordinal: number) => string,
  ): boolean {
    // The stored bag, read back the forgiving way: a line with a blank id is
    // dropped, a corrupt counter refused.
    const cart = BookingCartSystem.salvage({
      cartSeats: request.cartSeats,
      cartNextSequence: request.cartNextSequence,
    });
    if (!cart.ok) return false;

    // Placeholders, each one no other guest holds
    // (`BookingCartSystem.partyForCart`): this party lands on the schedule
    // step, past the rename that would fix it.
    const party = BookingCartSystem.partyForCart(
      cart.value,
      request.ownerUserId,
      guestLabel,
    );
    if (party === null) return false;

    this._state.set({
      bookingFlowStep: BookingFlowStep.Schedule,
      party,
      cart: cart.value,
      locationId: request.locationId,
      when: FlexibleWhen.empty(),
    });

    // The day the link names, else the earliest the request watches.
    const watched = [...FlexibleWhen.localDates(request)].sort().at(0) ?? null;
    const landed = day === null ? watched : localDateOrNull(day);
    if (landed !== null) this.selectDay(landed);
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
    if (
      !this.prefillFrom(appointment, guestLabel, PrefillCompanions.AsGuests)
    ) {
      return false;
    }
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

  /** `appointment`, bound to the account that read it ({@link readerOf}). */
  private sourceOf(appointment: Appointment): HeldVisit {
    return {
      appointmentId: appointment.id,
      readerUserId: this.readerOf(appointment),
    };
  }

  /**
   * The account `appointment` was read FOR: the party's claimed owner — the
   * signed-in principal — or, before any claim, the visit's own booker,
   * which an owner-scoped read can only have been
   * (`BookingCartSystem.readerOf`). What a held source is bound to, and
   * whose seats a move treats as the booker's own.
   */
  private readerOf(appointment: Appointment): UserId | null {
    return BookingCartSystem.readerOf(
      appointment.seats,
      this.party()?.ownerUserId ?? null,
    );
  }

  /**
   * Drop a source some OTHER account read. Called on every claim, so a
   * restored draft — or a tab whose session changed hands — never carries
   * one person's visit into another person's booking.
   */
  private releaseSourcesNotReadBy(reader: UserId): void {
    let released = false;
    const bookedFrom = this._bookedFrom();
    if (bookedFrom !== null && bookedFrom.readerUserId !== reader) {
      this._bookedFrom.set(null);
      released = true;
    }
    const moving = this._rescheduleOf();
    if (moving !== null && moving.readerUserId !== reader) {
      this._rescheduleOf.set(null);
      released = true;
    }
    if (released) this.persist();
  }

  /**
   * The bag, barbers and shop of `appointment`, on the schedule step
   * (`BookingCartSystem.prefill`).
   *
   * `companions` says what becomes of a seat the booker cannot name
   * (`Seat.isMovableByBooker`) — an ACCOUNT staff seated beside them. A new
   * booking has no way to seat another account, so it offers them as
   * guests; a move leaves them out of the cart because the server carries
   * them.
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
    companions: PrefillCompanions,
  ): boolean {
    // The party() accessor, not the raw state: a terminal state keeps its
    // party inside its receipt and has none at the top level.
    const bag = BookingCartSystem.prefill(
      appointment.seats,
      this.readerOf(appointment),
      this.party()?.ownerUserId ?? null,
      companions,
      guestLabel,
    );
    if (bag === null) return false;

    this._state.set({
      bookingFlowStep: BookingFlowStep.Schedule,
      party: bag.party,
      cart: bag.cart,
      locationId: appointment.locationId,
      when: FlexibleWhen.empty(),
    });
    // The visit's zone is its SHOP's (Law 7.2): the schedule step reads it
    // with the day the client picks.
    this.persist();
    return true;
  }

  /**
   * Rebuild from a persisted draft. Silently starts fresh if there is none —
   * or if the stored value is no draft the domain accepts (the adapter reads
   * through `BookingDraft.read` and clears what it refuses, a half-readable
   * move included: kept without its riders and chairs, the bag would commit
   * as a second booking beside the visit; kept with half of them, the grid
   * would decide on a visit that does not exist).
   *
   * Answers whether a draft WAS restored, so a continuation can tell "the
   * person's own flow is back" from "there was nothing to continue" — a
   * landing prefills the second and must not overwrite the first.
   */
  restore(): boolean {
    const loaded = this.drafts.loadBookingDraft();
    if (!loaded.ok || loaded.value === null) return false;
    const draft = loaded.value;

    // Whatever the booker captured or overrode, before the step branches —
    // it belongs to the booking, not to any one step of it. So do the visit
    // it was made from and the one it moves; `claim` re-checks their reader.
    this._contact.set(BookingContact.of(draft));
    this._bookedFrom.set(
      draft.bookingDraftOrigin === BookingDraftOrigin.BookedFrom
        ? {
            appointmentId: draft.bookedFromAppointmentId,
            readerUserId: draft.bookedFromOwnerUserId,
          }
        : null,
    );
    this._rescheduleOf.set(
      draft.bookingDraftOrigin === BookingDraftOrigin.Reschedule
        ? {
            appointmentId: draft.rescheduleAppointmentId,
            readerUserId: draft.rescheduleOwnerUserId,
            localDate: draft.rescheduleLocalDate,
            riders: draft.rescheduleRiders,
            release: draft.rescheduleRelease,
          }
        : null,
    );

    if (draft.bookingFlowStep === BookingFlowStep.Location) {
      this._state.set({
        bookingFlowStep: BookingFlowStep.Location,
        party: draft.party,
        cart: draft.cart,
        locationId: draft.locationId,
      });
      return true;
    }

    // `BookingCartSystem.restore` decides the step: a `review` draft resumes
    // on SCHEDULE, never on review itself — review's state is an OFFER, and
    // an offer restored from storage is an offer nobody re-checked; schedule
    // only for a bag every seat of which holds something and no two guests
    // share a label (a draft from before either rule resumes on services,
    // where `next` says so and one rename fixes it). The lapsed days wait for
    // the shop's "today" — see {@link settleLapsedDays}.
    const resumed = BookingCartSystem.restore(
      { state: draft, selectedLocalDate: draft.draftLocalDate },
      EARLIEST_DAY,
    );
    this._state.set(resumed.state);
    if (resumed.state.bookingFlowStep === BookingFlowStep.Schedule) {
      this._selectedLocalDate.set(resumed.selectedLocalDate);
      this.lapsedUnsettled = true;
    }
    return true;
  }

  /**
   * Drop what a restored draft still holds of days that have GONE BY — the
   * picked day and the declared ones (`BookingCartSystem.restore` against
   * the shop's `today`). Once per restore: the schedule step calls it with
   * its first clock reading, and a flow that has since left the schedule
   * step keeps what it holds until it comes back.
   */
  settleLapsedDays(today: LocalDate): void {
    if (!this.lapsedUnsettled) return;
    const state = this._state();
    if (state.bookingFlowStep !== BookingFlowStep.Schedule) return;
    this.lapsedUnsettled = false;
    const settled = BookingCartSystem.restore(
      { state, selectedLocalDate: this._selectedLocalDate() },
      today,
    );
    if (
      settled.state.bookingFlowStep === BookingFlowStep.Schedule &&
      settled.state.when !== state.when
    ) {
      this._state.set(settled.state);
    }
    this._selectedLocalDate.set(settled.selectedLocalDate);
    this.persist();
  }

  clearDraft(): void {
    this.drafts.clearBookingDraft();
  }

  /**
   * Who the shop calls about THIS booking.
   *
   * Held beside the machine rather than inside a state, for the same reason
   * the selected day is: it survives every step transition, it is meaningful
   * from the moment the booker is known, and no transition is gated on it.
   * `BookingContact.NONE` means "nothing captured" — the commit then carries
   * no contact at all rather than an empty one the server would refuse.
   */
  private readonly _contact = signal<BookingContact>(BookingContact.NONE);
  readonly contact = this._contact.asReadonly();

  setContact(contact: BookingContact): void {
    this._contact.set(contact);
    this.persist();
  }

  /** Apply one event; answers whether the machine took it. */
  private dispatch(event: BookingFlowEvent): boolean {
    const result = BookingFlowSystem.next(this._state(), event, FLOW_LIMITS);
    if (!result.ok) {
      this._error.set(result.error);
      return false;
    }
    this._error.set(null);
    this._state.set(result.value);
    this.persist();
    return true;
  }

  /**
   * Snapshot the flow after every accepted event — the flat `BookingDraft`:
   * the flow state, the contact, the picked day and where the draft came
   * from. Fire-and-forget: a full or disabled `sessionStorage` must never
   * block the wizard, and the only cost of a failed write is that a reload
   * starts over.
   */
  private persist(): void {
    const state = this._state();
    // Both terminal states end the draft's life: the receipt lives on the
    // server now, and a resumable draft pointing at a finished flow is how a
    // reload lands someone back inside a booking they already made.
    if (
      state.bookingFlowStep === BookingFlowStep.Confirmed ||
      state.bookingFlowStep === BookingFlowStep.Waitlisted
    ) {
      this.drafts.clearBookingDraft();
      return;
    }

    const contact = this._contact();
    const day = this._selectedLocalDate();
    // A visit bound to nobody lives in memory alone — the first claim
    // releases it — so it never reaches the draft. A move wins over a
    // rebooking edge: a move is never a rebooking.
    const moving = this._rescheduleOf();
    const source = this._bookedFrom();
    const draft =
      moving !== null && moving.readerUserId !== null
        ? BookingDraft.reschedule(
            state,
            contact,
            day,
            BookingDraft.rescheduleOrigin(
              moving.appointmentId,
              moving.readerUserId,
              moving.localDate,
              moving.riders,
              moving.release,
            ),
          )
        : source !== null && source.readerUserId !== null
          ? BookingDraft.bookedFrom(
              state,
              contact,
              day,
              BookingDraft.bookedFromOrigin(
                source.appointmentId,
                source.readerUserId,
              ),
            )
          : BookingDraft.fresh(state, contact, day);
    this.drafts.saveBookingDraft(draft);
  }

  /**
   * A client operation id from the id source (`ID_PORTS`) — `null` when the
   * source answers something the server's charset refuses
   * (`ClientOperationId.parse`).
   */
  private mintAttemptId(): ClientOperationId | null {
    const minted = ClientOperationId.parse(this.ids.nextId());
    return minted.ok ? minted.value : null;
  }
}

/**
 * An appointment the flow points at, and the account that read it.
 * `readerUserId` is `null` only when nobody could be named — such a source
 * lives in memory alone, and the first claim releases it.
 */
interface HeldVisit {
  readonly appointmentId: AppointmentId;
  readonly readerUserId: UserId | null;
}

/** The visit being moved: its shop day, who the server carries with it, and its chairs. */
interface HeldMove extends HeldVisit {
  readonly localDate: LocalDate;
  readonly riders: readonly MoveRider[];
  readonly release: readonly ChairTime[];
}

/** A raw day as a shop day — `null` when it is no day at all. */
function localDateOrNull(raw: string): LocalDate | null {
  const parsed = LocalDate.parse(raw);
  return parsed.ok ? parsed.value : null;
}
