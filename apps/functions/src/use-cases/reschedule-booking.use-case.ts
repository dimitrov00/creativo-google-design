import {
  AppointmentEditSystem,
  LedgerVerdict,
  OperationId,
  TimeErrorCode,
} from '@creativo/ecs-core';
import { Result, ZonedDateTime, fail, ok } from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import {
  Appointment,
  AppointmentPastStartTimeError,
  type AppointmentStatus,
  BookingPolicy,
  Seat,
  canTransition,
  carriedOffsetMinutes,
  carriedStartMs,
} from '@creativo/domain/scheduling';
import type { ClockPort, IdGenerator } from '@creativo/application/shared';
import {
  type AppliedOperation,
  AppliedOperations,
  type PersistedDocument,
  appointmentFromDocument,
  isClientOperationId,
  preservedAppointmentFields,
  revisionOf,
  subjectUserIdsOf,
} from '@creativo/application/booking';
import { FirestoreBookingStore } from '../adapters/firestore-booking-store';
import {
  type CommitBookingError,
  CommitBookingDstGapError,
  CommitBookingInvalidInputError,
  CommitBookingInvariantError,
  CommitBookingStoreError,
  CommitBookingUnauthenticatedError,
} from './commit-booking.errors';
import {
  type BookingDecision,
  type BookingSnapshot,
  type DecideBookingRequest,
  type RequestedSeat,
  type StaffTermsOverride,
  type StandingSeat,
  decideBooking,
  readStartIso,
} from './decide-booking';
import {
  type CarriedSeatRefusal,
  type RescheduleBookingError,
  RescheduleCarriedSeatUnplaceableError,
} from './reschedule-booking.errors';
import { operationDigest } from './staff-edit-appointment.operations';

export interface RescheduleBookingInput extends DecideBookingRequest {
  readonly appointmentId: string;
  /** From the VERIFIED token. `null` is a refusal, never a guest move. */
  readonly ownerUserId: string | null;
  /**
   * The client's name for THIS move (`RescheduleBookingRequest.attemptId`):
   * one per armed selection, the same on every retry of it. NOT the
   * appointment id a commit's attempt becomes — a move keeps its visit's id.
   *
   * Stamped into the visit's applied-operations ledger by the move's own
   * write (`AppliedOperations`, under `move:<attemptId>`), so a later call
   * carrying it is KNOWN to be a replay of a move that wrote — answered
   * without a second write, whatever happened to the visit since, and with
   * the revision that move stamped. Absent, or not `isClientOperationId`
   * shaped, the move is unnamed: no stamp, and a replay is recognised only
   * by the placement already being the requested one.
   */
  readonly attemptId?: string;
}

/** What a move resolved to — enough for the callable to answer and to audit. */
export interface RescheduledBooking {
  readonly appointmentId: string;
  /**
   * The revision this move stamped. For a call that wrote nothing
   * (`replayed`): the revision the ORIGINAL move stamped when the ledger
   * remembers its attempt (`replayedAttempt`), else the stored one — which
   * is only the original move's until anything else touches the visit, so
   * it is never a key for a replay's audit row.
   */
  readonly revision: number;
  /** Every account on the visit AFTER the move, carried companions included. */
  readonly subjectUserIds: readonly string[];
  /**
   * This call wrote NOTHING, and there are two kinds of nothing:
   *
   * - `replayedAttempt` — the ledger remembers this attempt id: the first
   *   attempt of this move WROTE and its response was lost. The callable
   *   logs it under the SAME `move:<attemptId>` key the first attempt used
   *   (`moveAudit` in `reschedule-appointment.ts`), so a row that attempt
   *   lost is filled in and one that exists is never written twice.
   * - otherwise — the stored visit already IS the requested placement, and
   *   nothing says a move of this name ever wrote: a retry from a client
   *   that names no attempt, or a first call asking for where the visit
   *   already is. Nothing happened that a row could record.
   */
  readonly replayed: boolean;
  /** See `replayed`: a replay of an attempt the ledger says WROTE. */
  readonly replayedAttempt: boolean;
}

/**
 * The prefix a move's attempt lives under in the applied-operations ledger.
 * A staff intent's `operationId` is `isClientOperationId`-shaped and so can
 * never contain the colon: the two kinds of name cannot collide, by
 * construction, however the clients mint them.
 */
const MOVE_OPERATION = 'move:';

/**
 * The fingerprint of what a named move asked for — the shop and the seats,
 * as sent. A retry of the same armed selection serialises the same; the
 * same name on a different move is a client bug, refused rather than
 * answered "moved" while moving nothing (`replayOf`).
 */
function moveDigest(input: RescheduleBookingInput): string {
  return operationDigest([
    { move: { locationId: input.locationId, seats: input.seats } },
  ]);
}

/**
 * Has this visit already applied the named move? `null` when the move is
 * unnamed or its name is new; the applied entry when it is a replay; a
 * refusal when the name is known but it asked for something else.
 */
function replayOf(
  current: PersistedDocument,
  operation: { readonly id: string; readonly digest: string } | null,
): Result<AppliedOperation | null, RescheduleBookingError> {
  if (operation === null) return ok(null);
  // The stored ledger as the flat entries the system reads (`operationId`,
  // was `id`); a replay's entry back as the legacy one the caller answers by.
  const verdict = AppointmentEditSystem.ledgerVerdict(
    AppliedOperations.fromDocument(current)
      .toArray()
      .map((entry) => ({
        operationId: OperationId.of(entry.id),
        revision: entry.revision,
        digest: entry.digest,
      })),
    OperationId.of(operation.id),
    operation.digest,
  );
  switch (verdict.ledgerVerdict) {
    case LedgerVerdict.New:
      return ok(null);
    case LedgerVerdict.Mismatch:
      return fail(new CommitBookingInvalidInputError('attemptId'));
    case LedgerVerdict.Replay:
      return ok({
        id: verdict.applied.operationId,
        revision: verdict.applied.revision,
        digest: verdict.applied.digest,
      });
  }
}

/**
 * One seat's placement, as a comparable key: WHO, WHAT, WITH WHOM, WHEN, and
 * what they asked for. Two placements with equal key multisets are the same
 * visit, whatever order the cart listed them in.
 */
function placementKey(parts: {
  readonly person: string;
  readonly serviceId: string;
  readonly variantId: string | null;
  readonly barberId: string;
  readonly startMs: number;
  readonly barberPref: string | null;
}): string {
  return JSON.stringify([
    parts.person,
    parts.serviceId,
    parts.variantId,
    parts.barberId,
    parts.startMs,
    parts.barberPref,
  ]);
}

/** The prefix the carried seats' line ids live under — never a cart line's. */
const CARRIED_LINE = 'carried-';

/**
 * The commit refusal a carried seat hit → the reason the client is told to
 * phone the shop about. See `CarriedSeatRefusal`.
 *
 * Two refusals are read one level deeper than their code, because the code
 * alone names the wrong conversation at the desk:
 * - `invalid_input` on `variantId` is a carried seat whose VARIANT the shop
 *   has since retired (its service still exists, the variant it was sold as
 *   does not) — the same fact as a retired service, one level down;
 * - `invariant_violated` carrying the aggregate's past-start refusal is a
 *   seat the shift moved to a start that is not after now — which the lead
 *   time check catches first everywhere except a zero-minute lead.
 */
function carriedRefusalOf(error: CommitBookingError): CarriedSeatRefusal {
  switch (error.code) {
    case 'booking.commit.slot_unavailable':
    case 'booking.commit.barber_not_rostered':
      return 'barber_unavailable';
    case 'booking.commit.unknown_service':
    case 'booking.commit.service_not_at_location':
      return 'service_unavailable';
    case 'booking.commit.too_soon':
    case 'booking.commit.beyond_horizon':
      return 'outside_booking_window';
    case 'booking.commit.invalid_input':
      return error.field === 'variantId'
        ? 'service_unavailable'
        : 'party_conflict';
    case 'booking.commit.invariant_violated':
      return violatesPastStart(error.violations)
        ? 'outside_booking_window'
        : 'party_conflict';
    default:
      return 'party_conflict';
  }
}

/**
 * Did `Appointment.create` refuse because the party would start in the past?
 * `CommitBookingInvariantError` carries the aggregate's violations as
 * `unknown`, so they are narrowed here rather than trusted.
 */
function violatesPastStart(violations: unknown): boolean {
  return (
    Array.isArray(violations) &&
    violations.some(
      (violation: unknown) =>
        violation instanceof AppointmentPastStartTimeError,
    )
  );
}

/**
 * Every account on the visit as `current` holds it — a replay's answer,
 * since the replay wrote nothing. A document that no longer parses names
 * nobody rather than failing an answer about a move that already happened.
 */
function subjectsOfStored(
  appointmentId: string,
  current: PersistedDocument | null,
): readonly string[] {
  if (current === null) return [];
  const parsed = appointmentFromDocument(appointmentId, current);
  return parsed.isSuccess() ? subjectUserIdsOf(parsed.value) : [];
}

/** Everything `plan` worked out, read back by `decide` in the same attempt. */
interface PlannedMove {
  /** The visit as stored — the source of every carried fact. */
  readonly stored: Appointment;
  /** Seats the cart cannot express, in stored order. */
  readonly carried: readonly Seat[];
  /** The cart's seats FIRST, then the carried ones: the whole party, decided once. */
  readonly request: DecideBookingRequest;
  /** Just what the client chose — decided alone only to tell whose seat failed. */
  readonly cartOnly: DecideBookingRequest;
  /** Carried seats keep the terms they were sold at — keyed by carried line id. */
  readonly overrides: ReadonlyMap<string, StaffTermsOverride>;
  /** Carried line id → the stored seat id it keeps. */
  readonly carriedSeatIds: ReadonlyMap<string, string>;
  /** The visit as it stood — see `standingSeatsOf`. */
  readonly standing: readonly StandingSeat[];
  /** The stored revision, before this move. */
  readonly revision: number;
  /** The stored placement already IS the requested one. */
  readonly unchanged: boolean;
}

/**
 * `rescheduleAppointment` — move a booking, keeping it the same booking.
 *
 * ### Why this exists rather than "cancel, then book again"
 * A sequential cancel-and-rebook has a window in which the client owns
 * nothing: if the new commit loses a race, the old slot is already gone. It
 * also mints a NEW appointment id, which quietly breaks everything keyed to
 * the old one — the client's own deep links, the notification that told them
 * about it, and any future receipt. This moves the appointment inside ONE
 * transaction: same id, same status, same contact, new time — or nothing.
 *
 * ### The same rules the first booking passed
 * The decision is `decideBooking`, unchanged: terms re-resolved from the
 * catalog, the roster re-read, the collision set re-checked. A client cannot
 * reschedule into a slot they could not have booked in the first place.
 *
 * ### Nobody is left behind (owner decision, 2026-09-25)
 * The cart can express the owner and anonymous guests and nothing else, so a
 * companion ACCOUNT staff seated on the visit used to vanish the moment the
 * client moved it. Every seat the cart cannot express is now CARRIED: its id,
 * subject, service, variant, barber, preference, terms, outcome and tip are
 * the stored seat's own, and only its start moves — by the same amount the
 * cart's first seat moved, which keeps a sequential party sequential and a
 * parallel one parallel. It is decided WITH the cart, in one `decideBooking`
 * call, so its barber's availability is checked exactly like everyone
 * else's. If it cannot be placed the whole move is refused with
 * `booking.reschedule.carried_seat_unplaceable`: moving the client while
 * dropping their companion is the one outcome that is never acceptable.
 *
 * ### The cancellation window governs moves too
 * Moving a booking two hours out is exactly as disruptive to the shop as
 * cancelling it, so it is refused on the same `BookingPolicy.mayCancelAt`
 * rule — and refused HERE, not merely hidden in the client.
 *
 * ### A retried move is answered, not repeated
 * A NAMED move (`attemptId`) stamps its name into the visit's ledger in the
 * same write, so its retry is recognised before anything else is asked and
 * answered from the ledger — even after the shop has touched the visit
 * since, which a retry must never undo. An unnamed one is recognised by the
 * stored visit already being the requested placement. Either way nothing is
 * re-decided or written and `replayed` comes back — so the retry neither
 * refuses itself (a move INTO the window would) nor moves twice.
 *
 * ### A move needs a seat of the client's to follow
 * A visit left holding only somebody the cart cannot name is refused as
 * `shop_only` — see `CarriedSeatRefusal`.
 */
export class RescheduleBookingUseCase {
  constructor(
    private readonly store: FirestoreBookingStore,
    private readonly clock: ClockPort,
    private readonly ids: IdGenerator,
    private readonly policy: BookingPolicy = BookingPolicy.default(),
  ) {}

  async execute(
    input: RescheduleBookingInput,
  ): Promise<Result<RescheduledBooking, RescheduleBookingError>> {
    if (!input.ownerUserId) {
      return fail(new CommitBookingUnauthenticatedError());
    }
    const ownerUserId = input.ownerUserId;
    // The verified owner as the domain names people — what the ONE rule for
    // whose seat the cart speaks for is keyed by (`Seat.isMovableByBooker`).
    const owner = UserId.create(ownerUserId);
    if (owner.isFailure()) {
      return fail(new CommitBookingUnauthenticatedError());
    }

    /** The move's name and fingerprint, when the client named it. */
    const operation =
      input.attemptId !== undefined && isClientOperationId(input.attemptId)
        ? {
            id: `${MOVE_OPERATION}${input.attemptId}`,
            digest: moveDigest(input),
          }
        : null;

    /*
     * Reassigned by `plan` on EVERY transaction attempt, before `decide` reads
     * it — so a retried attempt can never decide against the previous
     * attempt's read. A holder rather than a bare `let`, because assignments
     * made inside callbacks are invisible to the compiler's narrowing.
     */
    const attempt: {
      planned: PlannedMove | null;
      /** The ledger's entry for this move, when this call is its replay. */
      replay: AppliedOperation | null;
      /** The visit as this attempt read it — a replay's answer comes from it. */
      current: PersistedDocument | null;
    } = { planned: null, replay: null, current: null };

    const result = await this.store.reschedule<RescheduleBookingError>(
      input.appointmentId,
      // The CLIENT's rule: you may move your own booking and nobody else's.
      // Staff have their own use case with its own predicate — see
      // `StaffEditAppointmentUseCase`.
      (current) => current['ownerUserId'] === ownerUserId,
      (current) => {
        attempt.planned = null;
        attempt.current = current;
        /*
         * A NAMED MOVE THE LEDGER REMEMBERS IS ANSWERED, NOT APPLIED — and
         * before anything else is asked: the move already happened, and
         * whatever the visit went through since (a staff drag, a closing
         * window, a cancellation) is newer than it. `null` tells the store
         * that nothing is to be written.
         */
        const replay = replayOf(current, operation);
        if (replay.isFailure()) return fail(replay.error);
        attempt.replay = replay.value;
        if (replay.value !== null) return ok(null);

        const planned = this.plan(input, owner.value, current);
        if (planned.isFailure()) return fail(planned.error);
        attempt.planned = planned.value;
        return ok(planned.value.unchanged ? null : planned.value.request);
      },
      (snapshot, current) => {
        // Unreachable: `plan` runs first on every attempt and either sets this
        // or fails the attempt. Checked rather than asserted because a
        // silently-null plan would decide the WRONG party.
        if (attempt.planned === null) {
          return fail(new CommitBookingInvalidInputError('seats'));
        }
        return this.decide(snapshot, current, attempt.planned, ownerUserId);
      },
      // A client `set()` replaces the document whole, exactly like a staff
      // edit's — so it carries the fields the mapper does not own and bumps
      // the revision a staff sheet holding this visit will be checked against.
      (current) => ({
        ...preservedAppointmentFields(current),
        revision: revisionOf(current) + 1,
        // The move's name, stamped by the SAME write that moves the visit:
        // the ledger can never say "moved" about a move that did not land,
        // nor miss one that did. An unnamed move leaves the ledger as it was
        // — `preservedAppointmentFields` already carries it forward.
        ...(operation === null
          ? {}
          : AppliedOperations.fromDocument(current)
              .record({
                id: operation.id,
                revision: revisionOf(current) + 1,
                digest: operation.digest,
              })
              .toFields()),
      }),
    );

    if (result.isFailure()) return fail(result.error);
    if (result.value.kind === 'replayed' && attempt.replay !== null) {
      return ok({
        appointmentId: input.appointmentId,
        // The revision the ORIGINAL move stamped — the ledger's, not
        // whatever the visit has reached since.
        revision: attempt.replay.revision,
        subjectUserIds: subjectsOfStored(input.appointmentId, attempt.current),
        replayed: true,
        replayedAttempt: true,
      });
    }
    const planned = attempt.planned;
    if (planned === null) {
      return fail(new CommitBookingInvalidInputError('seats'));
    }
    if (result.value.kind === 'replayed') {
      return ok({
        appointmentId: input.appointmentId,
        revision: planned.revision,
        subjectUserIds: subjectUserIdsOf(planned.stored),
        replayed: true,
        replayedAttempt: false,
      });
    }
    return ok({
      appointmentId: input.appointmentId,
      revision: planned.revision + 1,
      subjectUserIds: subjectUserIdsOf(result.value.decision.appointment),
      replayed: false,
      replayedAttempt: false,
    });
  }

  /**
   * The stored visit plus the client's cart → the request the decision runs
   * on, the seats carried beside it, and whether anything changes at all.
   */
  private plan(
    input: RescheduleBookingInput,
    owner: UserId,
    current: PersistedDocument,
  ): Result<PlannedMove, RescheduleBookingError> {
    const status = (current['status'] ?? {}) as AppointmentStatus;
    // The domain's own lifecycle graph, not a re-encoded copy: a completed,
    // no-showed or already-cancelled visit cannot move.
    if (!canTransition(status, 'cancelled')) {
      return fail(new CommitBookingInvalidInputError('status'));
    }
    if (input.seats.length === 0) {
      return fail(new CommitBookingInvalidInputError('seats'));
    }
    // Defence in depth: `toSeats` never produces one, and a client must never
    // be able to seat another ACCOUNT — a carried companion comes from the
    // stored document below, never from the wire.
    if (input.seats.some((seat) => seat.subject.kind === 'companion')) {
      return fail(new CommitBookingInvalidInputError('subject'));
    }

    // The stored visit as the aggregate, through the SAME mapper every other
    // reader uses. A visit whose seats do not parse is refused rather than
    // rebuilt from the cart alone: that rebuild is exactly how a person the
    // cart cannot name used to disappear.
    const parsed = appointmentFromDocument(input.appointmentId, current);
    if (parsed.isFailure()) {
      return fail(new CommitBookingInvalidInputError('seats'));
    }
    const stored = parsed.value;
    // WHOSE seat is whose — the domain's one rule, the same one the web flow
    // builds the cart by. The cart stands in for the booker's own seat and
    // their anonymous guests; everybody else (a companion the shop seated, a
    // `self` seat bound to another account) is somebody the cart has no way
    // to name, so they are carried forward from the stored visit instead.
    const replaced = stored.seatsTheBookerCanMove(owner);
    const carried = stored.seats.filter(
      (seat) => !seat.isMovableByBooker(owner),
    );
    const anchor = stored.moveAnchor(owner);
    // A visit with NO seat of the client's — their own was removed and only a
    // companion the shop seated is left — is the shop's to move. The cart
    // would not be standing in for anyone: it would ADD people to the visit
    // and drag the companion along behind them. Refused whole, named, and
    // before any time is read, so the answer does not depend on which slot a
    // stale or hand-built cart asked for.
    if (replaced.length === 0 || anchor === null) {
      return fail(
        new RescheduleCarriedSeatUnplaceableError(
          'shop_only',
          carried.map((seat) => seat.id.value),
        ),
      );
    }

    const zone = stored.timeSlot.start.zoneName;
    const cartStarts: number[] = [];
    for (const seat of input.seats) {
      // Read once, at this ingestion boundary, with the shop's zone: a
      // wall-clock start inside the spring-forward gap is refused by name.
      const start = readStartIso(seat.startIso, zone);
      if (!start.ok) {
        return fail(
          start.error.errorCode === TimeErrorCode.DstGap
            ? new CommitBookingDstGapError(start.error)
            : new CommitBookingInvalidInputError('startIso'),
        );
      }
      cartStarts.push(start.value);
    }

    /*
     * THE SHIFT. The cart stands in for the seats it can express, so every
     * carried seat keeps its distance from the domain's `moveAnchor` and
     * lands that far from the cart's new earliest seat. This is the domain's
     * one statement of it (`carriedOffsetMinutes` / `carriedStartMs`), the
     * same one the web flow's grid keeps room by and its review card shows.
     * A companion 45 minutes after the owner is still 45 minutes after them,
     * two people side by side stay side by side, and a DST boundary between
     * the old day and the new one changes nothing about either.
     */
    const cartEarliestMs = Math.min(...cartStarts);

    /*
     * LINE IDS ARE RE-KEYED, both sides. `termsOverrides` is looked up by line
     * id, and the cart's are the client's to choose — left as sent, a cart
     * line named after a carried seat's line would inherit that seat's price.
     * Positional ids from the server make the two sets disjoint by
     * construction.
     */
    const cartSeats: RequestedSeat[] = input.seats.map((seat, index) => ({
      ...seat,
      lineId: `cart-${index}`,
    }));
    const carriedSeats: RequestedSeat[] = [];
    const overrides = new Map<string, StaffTermsOverride>();
    const carriedSeatIds = new Map<string, string>();
    for (const [index, seat] of carried.entries()) {
      const subject = seat.subject;
      if (subject.kind !== 'account') continue; // unreachable — see the filter
      const shifted = ZonedDateTime.fromMillis(
        carriedStartMs(
          cartEarliestMs,
          carriedOffsetMinutes(seat.startsAt.toMillis(), anchor.toMillis()),
        ),
        seat.startsAt.zoneName,
      );
      if (shifted.isFailure()) {
        return fail(new CommitBookingInvalidInputError('startIso'));
      }
      const lineId = `${CARRIED_LINE}${index}`;
      carriedSeats.push({
        lineId,
        serviceId: seat.serviceId.value,
        variantId: seat.variantId?.value ?? null,
        barberId: seat.barberId.value,
        ...(seat.pref ? { barberPref: seat.pref.kind } : {}),
        startIso: shifted.value.toISO(),
        subject: { kind: 'companion', userId: subject.userId.value },
      });
      // The terms they were SOLD at: a move is not a re-sale, and the chair
      // time the decision checks has to be the time this seat actually takes.
      // Server-built from the stored document, never from the payload — so
      // no client can reach this through the wire.
      overrides.set(lineId, {
        priceMinorUnits: seat.terms.price.toMinorUnits(),
        currencyCode: seat.terms.price.currencyCode(),
        durationMinutes: seat.terms.durationMinutes,
        setupMinutes: seat.terms.setupMinutes,
        cleanupMinutes: seat.terms.cleanupMinutes,
      });
      carriedSeatIds.set(lineId, seat.id.value);
    }

    const request: DecideBookingRequest = {
      locationId: input.locationId,
      seats: [...cartSeats, ...carriedSeats],
      // The id is REUSED as the attempt id, which is what keeps the moved
      // appointment the same document — `decideBooking` mints one only when
      // it is not given one.
      attemptId: input.appointmentId,
      contact: input.contact,
    };

    // Unchanged when the cart names exactly the seats it stands in for, at
    // the same shop — the carried seats then shift by nothing either.
    const storedKeys = replaced
      .map((seat) =>
        placementKey({
          person:
            seat.subject.kind === 'anonymous'
              ? `guest:${seat.subject.label.value}`
              : 'self',
          serviceId: seat.serviceId.value,
          variantId: seat.variantId?.value ?? null,
          barberId: seat.barberId.value,
          startMs: seat.startsAt.toMillis(),
          barberPref: seat.pref?.kind ?? null,
        }),
      )
      .sort();
    const cartKeys = input.seats
      .map((seat, index) =>
        placementKey({
          person:
            seat.subject.kind === 'guest'
              ? `guest:${seat.subject.label.trim()}`
              : 'self',
          serviceId: seat.serviceId,
          variantId: seat.variantId,
          barberId: seat.barberId,
          // `cartStarts` was built from `input.seats` in order.
          startMs: cartStarts.at(index) ?? Number.NaN,
          barberPref: seat.barberPref ?? null,
        }),
      )
      .sort();
    const unchanged =
      stored.locationId.value === input.locationId &&
      storedKeys.length === cartKeys.length &&
      storedKeys.every((key, index) => key === cartKeys.at(index));

    // A party MID-SERVICE cannot move. Checked after the replay test, so a
    // retry of a move that already landed is still answered as one.
    //
    // Why at all: the cart's seats are rebuilt with fresh ids and fresh
    // `scheduled` outcomes, so moving a party where one guest has already
    // been served — or already no-showed — would silently erase that fact.
    // The root status cannot catch this: a partially-resolved party is still
    // `confirmed`.
    if (!unchanged && stored.seats.some((seat) => seat.isResolved())) {
      return fail(new CommitBookingInvalidInputError('seat_resolved'));
    }

    return ok({
      stored,
      carried,
      request,
      cartOnly: { ...request, seats: cartSeats },
      overrides,
      carriedSeatIds,
      standing: standingSeatsOf(stored, owner),
      revision: revisionOf(current),
      unchanged,
    });
  }

  /** The planned party → the appointment this move writes, or a refusal. */
  private decide(
    snapshot: BookingSnapshot,
    current: PersistedDocument,
    planned: PlannedMove,
    ownerUserId: string,
  ): Result<BookingDecision, RescheduleBookingError> {
    const now = this.clock.now(snapshot.zone);
    if (now.isFailure()) {
      return fail(new CommitBookingStoreError(now.error));
    }

    // The window is read off the CURRENT start — the booking being moved —
    // because that is the commitment the shop planned around.
    const currentStart = String(
      (current['timeSlot'] as Record<string, unknown> | undefined)?.[
        'startIso'
      ] ?? '',
    );
    const startMs = Date.parse(currentStart);
    if (
      Number.isFinite(startMs) &&
      !this.policy.mayCancelAt(startMs, now.value.toMillis())
    ) {
      return fail(new CommitBookingInvalidInputError('window_closed'));
    }

    // A carried seat keeps its stored terms, which is what lets
    // `decideBooking` place a seat whose service has since left the catalogue
    // — right for a staff edit, wrong here: a retired service is exactly
    // "the service is no longer offered", and the client cannot re-seat
    // somebody else into what replaced it.
    const offered = new Set(
      snapshot.services.map((service) => service.id.value),
    );
    const retired = planned.carried.filter(
      (seat) => !offered.has(seat.serviceId.value),
    );

    const decided =
      retired.length > 0
        ? null
        : this.decideParty(
            planned.request,
            snapshot,
            now.value,
            planned,
            ownerUserId,
          );
    if (decided === null || decided.isFailure()) {
      if (decided !== null && planned.carried.length === 0) {
        return fail(decided.error);
      }
      // WHOSE seat failed? The decision stops at the first refusal and does
      // not say, so the client's own choice is decided ALONE: if that fails
      // too, the client's pick is the problem and they get the ordinary
      // answer (a taken slot sends them back to a fresh grid). Only when the
      // cart places cleanly is the carried party to blame.
      const own = this.decideParty(
        planned.cartOnly,
        snapshot,
        now.value,
        planned,
        ownerUserId,
      );
      if (own.isFailure()) return fail(own.error);
      return fail(
        decided === null
          ? new RescheduleCarriedSeatUnplaceableError(
              'service_unavailable',
              retired.map((seat) => seat.id.value),
            )
          : new RescheduleCarriedSeatUnplaceableError(
              carriedRefusalOf(decided.error),
              planned.carried.map((seat) => seat.id.value),
            ),
      );
    }

    // The request listed the cart first and the carried seats after it, and
    // the decision consumed it in order — so position says which is which.
    // A carried seat comes back as the STORED seat with the decided start:
    // identity, subject, preference, terms, provenance, outcome and tip are
    // facts about that person, and a move changes none of them.
    const cartCount = planned.request.seats.length - planned.carried.length;
    const seats = decided.value.appointment.seats.map((seat, index) => {
      const carried =
        index >= cartCount ? planned.carried.at(index - cartCount) : undefined;
      return carried
        ? Seat.of({ ...carried.toProps(), startsAt: seat.startsAt })
        : seat;
    });

    // Everything that belongs to the appointment's IDENTITY rather than its
    // placement comes from the stored visit: the status (a move must not
    // downgrade a confirmed booking to pending), the contact, `bookedAt` (a
    // restamp would collapse booking lead time for exactly the bookings
    // planned furthest ahead), the rebooking edge, the arrival stamp (without
    // it FINISHING THE VISIT vanishes from the sheet), and the bill — the
    // discounts the shop granted and the vouchers that already paid.
    const stored = planned.stored;
    const restored = Appointment.reconstitute({
      id: decided.value.appointment.id.value,
      locationId: decided.value.appointment.locationId.value,
      seats,
      status: stored.status,
      contact: stored.contact,
      bookedAt: stored.bookedAt,
      bookedFromAppointmentId: stored.bookedFrom?.value ?? null,
      arrivedAt: stored.arrivedAt,
      discounts: stored.discounts,
      voucherRedemptions: stored.voucherRedemptions,
    });
    if (restored.isFailure()) {
      return fail(new CommitBookingInvariantError(restored.error));
    }

    return ok({
      appointment: restored.value,
      busyWrites: decided.value.busyWrites,
    });
  }

  /**
   * One `decideBooking` run over `request` — the commit path's decision,
   * unforked. Cart seats get fresh ids; carried seats keep their stored ones,
   * so every per-seat action open on the staff sheet survives the move.
   */
  private decideParty(
    request: DecideBookingRequest,
    snapshot: BookingSnapshot,
    now: ZonedDateTime,
    planned: PlannedMove,
    ownerUserId: string,
  ): Result<BookingDecision, CommitBookingError> {
    const ids = request.seats.map(
      (seat) => planned.carriedSeatIds.get(seat.lineId) ?? this.ids.next(),
    );
    let cursor = 0;
    return decideBooking(request, snapshot, {
      now,
      policy: this.policy,
      nextId: () => ids[cursor++] ?? this.ids.next(),
      ownerUserId,
      termsOverrides: planned.overrides,
      /*
       * ON A CLIENT'S MOVE, ONLY CARRIED SEATS KEEP A STANDING PAIR (BA
       * ruling, round 6 — the owner's round-5 decision, narrowed for the
       * move and accepted). The client re-picks their OWN seats — theirs
       * and their anonymous guests' — on a person-aware grid, so those
       * seats are placed anew, minted with fresh ids, and obey "one person,
       * one chair at a time" in full: a same-label guest pair must be
       * renamed or separated before it moves. Only the seats the move
       * CARRIES (a companion the shop seated, a `self` seat bound to
       * another account) keep their stored ids, and with them a pair they
       * already stood in — so a companion entered twice by hand moves with
       * the client instead of refusing the move.
       */
      standing: planned.standing,
    });
  }
}

/**
 * The stored visit's seats as `decideBooking` counts people — the same
 * subjects the move rebuilds them as: the booker's own seat as `self`, a
 * guest by label, anybody else (a companion, a `self` seat bound to another
 * account) as the account the carried seat names. Only the seats' mutual
 * double seatings are read off it (`DecideBookingDeps.standing`), keyed by
 * seat id, so a cart seat — minted fresh — never matches one: on a client's
 * move only CARRIED seats keep a standing pair (BA ruling, round 6).
 */
function standingSeatsOf(
  stored: Appointment,
  owner: UserId,
): readonly StandingSeat[] {
  return stored.seats.map((seat) => {
    const subject = seat.subject;
    return {
      id: seat.id.value,
      subject:
        subject.kind === 'anonymous'
          ? { kind: 'guest', label: subject.label.value }
          : seat.isMovableByBooker(owner)
            ? { kind: 'self' }
            : { kind: 'companion', userId: subject.userId.value },
      startMs: seat.startsAt.toMillis(),
      durationMinutes: seat.terms.durationMinutes,
    };
  });
}
