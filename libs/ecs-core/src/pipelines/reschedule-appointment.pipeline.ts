import {
  type Actor,
  AuditContext,
  BookingCall,
  type BookingPolicy,
  Placement,
  PlacementPolicy,
  RequestedSubjectRole,
  type Seat,
  SeatSubject,
  StaffTermsOverride,
  WriteOp,
} from '@core/components';
import {
  Result,
  type AppointmentId,
  AuditResourceId,
  BarberId,
  CartLineId,
  type ClientOperationId,
  type LocalDate,
  LocationId,
  OperationId,
  SeatKeyText,
  ServiceId,
  ServiceVariantId,
  type TimeZone,
  UserId,
  type UtcEpochMs,
} from '@core/primitives';
import {
  BookingError,
  type RepositoryError,
  ShopUnavailableReason,
  CancellationRefusalCode,
  CarriedSeatRefusal,
  MoveErrorCode,
  type TimeError,
} from '@core/errors';
import type { Appointment } from '@core/entities';
import type {
  AuditAppendPorts,
  HashPorts,
  IdPorts,
  PolicyReadPorts,
  ReadTx,
  TelemetryPorts,
  TxPorts,
} from '@core/ports';
import {
  AppointmentEditSystem,
  AppointmentIndexSystem,
  type AuditFact,
  AuditSystem,
  BookingDecisionSystem,
  type BookingDecision,
  CancellationPolicySystem,
  type CarriedLine,
  type DecideBookingInput,
  type DecisionStandingSeat,
  LedgerVerdict,
  type MoveError,
  type MovedCartLine,
  type MovePlan,
  MoveSystem,
  PartyAdmissionSystem,
  ZonedTimeSystem,
} from '@core/systems';
import {
  appendAuditFacts,
  appointmentPath,
  type BookingReadSet,
  bookingSnapshotOf,
  busyMergeWrites,
  isReadableId,
  type PlacementSet,
  placementFields,
  placementKeysOf,
  parseContactPhone,
  readAppointment,
  readBookingSet,
  readPlacementSet,
  type ShopDayFrame,
  zoneOf,
} from './booking-read-set.pipeline';
import { frameWallClock } from './book-appointment.pipeline';
import { customerIdsFor } from './customer-records.pipeline';

/**
 * `rescheduleAppointment` — a CLIENT moving their own visit (blueprint
 * §4.1). Not "cancel, then book": an appointment must not collide with
 * ITSELF, so its own chair time is handed back to the decision first
 * (`MovePlan.release`), and it keeps its identity — id, status, contact,
 * booking instant, arrival, bill, placement stamp.
 *
 * - **Outside:** the tenant policy.
 * - **In the transaction, stated explicitly:** the stored visit (the
 *   caller's own — anyone else's is answered as not found: an id's
 *   existence is no leak), the ledger's verdict on a named move
 *   (`move:<attemptId>` already applied → its original answer, nothing
 *   written), then the booking read set of the NEW placement — the shop
 *   the request names, the services and schedules of every seat, and the
 *   busy days and exceptions of the new day's keys (read even when absent).
 * - **The wall clock, once (Law 7.3):** the call carries the shop day and
 *   each cart seat's minute; having read the shop, the pipeline places them
 *   on ITS zone (`frameWallClock`) — a gap start is `DST_GAP_INVALID_TIME`.
 * - **The plan** (`MoveSystem.plan`): the cart stands in for the seats the
 *   booker can name; everybody else is CARRIED at their kept distance, on
 *   the terms they were sold at. A request for exactly where the visit
 *   already is changes nothing. The decision runs the whole party under the
 *   client's rules after the free-cancellation window on the stored start;
 *   a carried seat it cannot place is the client's call to the shop
 *   (`carried_seat_unplaceable`, naming why) — unless the cart itself does
 *   not fit, which is the cart's own refusal.
 * - **One plan:** the appointment `Update` (the revision stamped, a named
 *   move recorded in the ledger) and the busy `Set`s of the NEW day merged
 *   onto what this attempt read; the old day is left to `rebuildBusy`.
 * - **After:** the row (`move:<attemptId>`, else `revision:<n>`), naming
 *   everyone the move touched; a replayed named move appends it again
 *   (`loggedOnRetry`), a request for where the visit already is logs none.
 */

/**
 * The move as the edge decoded it — the call component
 * `BookingCall.Reschedule` with its seats in their raw twin
 * (`BookingCall.SeatInput`: each start a minute of the request's day, the
 * booker or a guest by label — a `COMPANION` is refused, a cart never names
 * another account) & the verified caller and actor.
 */
export type RescheduleAppointmentCommand = {
  readonly appointmentId: AppointmentId;
  /** The verified caller; only the visit's owner may move it. */
  readonly callerUserId: UserId | null;
  /** The shop as sent — a move may take the visit to another shop. */
  readonly locationId: string;
  /** The ONE shop day the cart is on, as sent (`YYYY-MM-DD`). */
  readonly localDate: string;
  readonly seats: readonly BookingCall.SeatInput[];
  /** The client's name for this move; `null` makes no claim. */
  readonly attemptId: ClientOperationId | null;
  readonly actor: Actor | null;
};

export type RescheduleAppointmentAnswer = {
  readonly appointmentId: AppointmentId;
  /** The revision the visit stands at after this call (a replay: the one it stamped). */
  readonly revision: number;
  /** Nothing was written — a named move replayed, or a request for where the visit already is. */
  readonly replayed: boolean;
};

export type RescheduleAppointmentError =
  BookingError | MoveError | TimeError | RepositoryError;

export type RescheduleAppointmentPorts = TxPorts &
  PolicyReadPorts &
  AuditAppendPorts &
  TelemetryPorts;

/** The ledger name of a client's move — one ledger with the staff edits. */
const MOVE_OPERATION = 'move:';

type Operation = { readonly id: OperationId; readonly digest: string };

type Loaded = {
  readonly snapshot: 'LOADED';
  readonly stored: Appointment;
  readonly locationId: LocationId;
  readonly localDate: LocalDate;
  readonly zone: TimeZone;
  readonly cartStartUtcMs: UtcEpochMs;
  readonly plan: MovePlan;
  readonly set: BookingReadSet;
  readonly placement: PlacementSet;
};

type Snapshot =
  | { readonly snapshot: 'REFUSED'; readonly error: RescheduleAppointmentError }
  | {
      readonly snapshot: 'REPLAY';
      readonly stored: Appointment;
      readonly revision: number;
    }
  | { readonly snapshot: 'UNCHANGED'; readonly stored: Appointment }
  | Loaded;

/** How a call ended: written, a named move replayed, or nothing to do. */
const MoveOutcome = {
  Moved: 'MOVED',
  Replayed: 'REPLAYED',
  Unchanged: 'UNCHANGED',
} as const;
type MoveOutcome = (typeof MoveOutcome)[keyof typeof MoveOutcome];

type Decided = {
  readonly stored: Appointment;
  readonly after: Appointment | null;
  readonly moveOutcome: MoveOutcome;
  readonly revision: number;
  readonly writes: readonly WriteOp[];
};

export const rescheduleAppointment =
  (ports: RescheduleAppointmentPorts) =>
  async (
    cmd: RescheduleAppointmentCommand,
  ): Promise<
    Result<RescheduleAppointmentAnswer, RescheduleAppointmentError>
  > => {
    const owner = cmd.callerUserId;
    if (owner === null) return Result.err(BookingError.unauthenticated());
    const policy = await ports.loadPolicy();
    if (!policy.ok) return policy;
    const operation: Operation | null =
      cmd.attemptId === null
        ? null
        : {
            id: OperationId.of(`${MOVE_OPERATION}${cmd.attemptId}`),
            // The shop, the day and the seats, as sent — the staff edit's
            // basis over one `{ move }` command, so both kinds of intent
            // share a ledger.
            digest: ports
              .hash(
                MoveSystem.digestBasis({
                  locationId: cmd.locationId,
                  localDate: cmd.localDate,
                  seats: cmd.seats,
                }),
              )
              .slice(0, 16),
          };
    const nowUtcMs = ports.nowUtcMs();

    const committed = await ports.commit(
      (tx) => readMove(tx, cmd, owner, operation),
      (snapshot) =>
        decideMove(snapshot, owner, operation, policy.value, nowUtcMs, ports),
    );
    if (!committed.ok) return committed;
    const { stored, after, moveOutcome, revision } = committed.value;

    if (moveOutcome !== MoveOutcome.Unchanged) {
      const fact: AuditFact = {
        resourceId: AuditResourceId.forAppointment(stored.id),
        subjects:
          after === null
            ? AuditSystem.subjectsOf(stored)
            : [
                ...AuditSystem.subjectsOf(stored),
                ...AuditSystem.subjectsOf(after),
              ],
        changeKey:
          cmd.attemptId === null
            ? AuditSystem.changeKey.revision(revision)
            : AuditSystem.changeKey.move(cmd.attemptId),
        context: AuditContext.rescheduled(
          revision,
          moveOutcome === MoveOutcome.Replayed,
        ),
      };
      await appendAuditFacts(ports, [fact], cmd.actor);
    }
    return Result.ok({
      appointmentId: cmd.appointmentId,
      revision,
      replayed: moveOutcome !== MoveOutcome.Moved,
    });
  };

/** The cart on the request's shop day — `null` when a start or an id is none. */
function cartOf(
  cmd: RescheduleAppointmentCommand,
  frame: ShopDayFrame,
): readonly BookingCall.Seat[] | null {
  const cart: BookingCall.Seat[] = [];
  for (let i = 0; i < cmd.seats.length; i++) {
    const seat = cmd.seats[i] as BookingCall.SeatInput;
    const startMinutes = frame.startMinutes.at(i) ?? null;
    const service = ServiceId.parse(seat.serviceId);
    const barber = BarberId.parse(seat.barberId);
    if (startMinutes === null || !service.ok || !barber.ok) return null;
    cart.push({
      // Positional, like `MoveSystem.plan`'s own re-keying (`cart-<i>`).
      lineId: CartLineId.of(`cart-${i}`),
      serviceId: service.value,
      // The variant as sent: the decision re-reads it (a blank one is refused there).
      variantId:
        seat.variantId === null ? null : ServiceVariantId.of(seat.variantId),
      barberId: barber.value,
      barberPreference: seat.barberPreference,
      startMinutes,
      subject: subjectOf(seat),
    });
  }
  return cart;
}

/**
 * A sent seat's subject in the call's ONE subject shape. A guest is read by
 * label alone, as the move always read it (its key never reaches the
 * decision). A companion is never on a client cart: `MoveSystem.plan`
 * refuses it (`subject`) before the account id is read.
 */
function subjectOf(seat: BookingCall.SeatInput): BookingCall.Subject {
  const subject = seat.subject;
  switch (subject.requestedSubjectRole) {
    case RequestedSubjectRole.Guest:
      return BookingCall.guestSubject(subject.label, null);
    case RequestedSubjectRole.Companion:
      return BookingCall.companionSubject(UserId.of(subject.companionUserId));
    case RequestedSubjectRole.Self:
      return BookingCall.selfSubject();
  }
}

/** The transaction's read half — see {@link rescheduleAppointment}. */
async function readMove(
  tx: ReadTx,
  cmd: RescheduleAppointmentCommand,
  owner: UserId,
  operation: Operation | null,
): Promise<Snapshot> {
  const stored = await readAppointment(tx, cmd.appointmentId);
  if (stored === null || stored.ownerUserId !== owner) {
    return {
      snapshot: 'REFUSED',
      error: BookingError.invalidInput('appointmentId'),
    };
  }
  if (operation !== null) {
    const verdict = AppointmentEditSystem.ledgerVerdict(
      stored.appliedOperations,
      operation.id,
      operation.digest,
    );
    if (verdict.ledgerVerdict === LedgerVerdict.Mismatch) {
      return {
        snapshot: 'REFUSED',
        error: BookingError.invalidInput('attemptId'),
      };
    }
    if (verdict.ledgerVerdict === LedgerVerdict.Replay) {
      return {
        snapshot: 'REPLAY',
        stored,
        revision: verdict.applied.revision,
      };
    }
  }
  const notFound: Snapshot = {
    snapshot: 'REFUSED',
    error: BookingError.shopUnavailable(
      cmd.locationId,
      ShopUnavailableReason.NotFound,
    ),
  };
  const locationId = LocationId.parse(cmd.locationId);
  if (!locationId.ok || !isReadableId(cmd.locationId)) return notFound;
  const serviceIds: ServiceId[] = [];
  const barberIds: BarberId[] = [];
  for (const seat of cmd.seats) {
    const service = ServiceId.parse(seat.serviceId);
    const barber = BarberId.parse(seat.barberId);
    if (service.ok) serviceIds.push(service.value);
    if (barber.ok) barberIds.push(barber.value);
  }
  for (const seat of stored.seats) {
    serviceIds.push(seat.serviceId);
    barberIds.push(seat.barberId);
  }
  const set = await readBookingSet(tx, {
    locationId: locationId.value,
    serviceIds,
    barberIds,
    customerIds: [],
  });
  if (set.location === null) return notFound;
  const zone = zoneOf(set.location);
  const framed =
    zone === null
      ? null
      : frameWallClock(
          cmd.localDate,
          cmd.seats.map((seat) => seat.startMinutes),
          zone,
        );
  if (framed !== null && !framed.ok) {
    return { snapshot: 'REFUSED', error: framed.error };
  }
  const frame = framed === null ? null : framed.value;
  const cart = frame === null ? null : cartOf(cmd, frame);
  if (
    zone === null ||
    frame === null ||
    frame.localDate === null ||
    frame.startUtcMs === null ||
    cart === null
  ) {
    return {
      snapshot: 'REFUSED',
      error: BookingError.invalidInput('startMinutes'),
    };
  }
  const plan = MoveSystem.plan(stored, owner, {
    locationId: locationId.value,
    localDate: frame.localDate,
    seats: cart,
  });
  if (!plan.ok) return { snapshot: 'REFUSED', error: plan.error };
  if (plan.value.unchanged) return { snapshot: 'UNCHANGED', stored };
  // A visit moved IN from another shop arrives there, and is asked what a
  // new booking is: listed — a client's move is never a door to a hidden shop.
  if (
    locationId.value !== stored.locationId &&
    !PartyAdmissionSystem.shopListed(set.location)
  ) {
    return {
      snapshot: 'REFUSED',
      error: BookingError.shopUnavailable(
        cmd.locationId,
        ShopUnavailableReason.Unlisted,
      ),
    };
  }
  const keyed: {
    readonly barberId: string;
    readonly startMinutes: (typeof cart)[number]['startMinutes'] | null;
  }[] = [];
  for (const seat of cart) {
    keyed.push({ barberId: seat.barberId, startMinutes: seat.startMinutes });
  }
  for (const line of plan.value.carried) {
    keyed.push({
      barberId: line.seat.barberId,
      startMinutes: line.startMinutes,
    });
  }
  const placement = await readPlacementSet(
    tx,
    placementKeysOf(keyed, frame.localDate),
  );
  return {
    snapshot: 'LOADED',
    stored,
    locationId: locationId.value,
    localDate: frame.localDate,
    zone,
    cartStartUtcMs: frame.startUtcMs,
    plan: plan.value,
    set,
    placement,
  };
}

/** The visit as it stood, for "one person, one chair" — the booker's own seats are `SELF`. */
function standingOf(
  stored: Appointment,
  owner: UserId,
): readonly DecisionStandingSeat[] {
  const standing: DecisionStandingSeat[] = [];
  for (const seat of stored.seats) {
    standing.push({
      seatId: seat.seatId,
      subject:
        seat.seatSubject === SeatSubject.Anonymous
          ? {
              requestedSubjectRole: RequestedSubjectRole.Guest,
              label: seat.guestLabel,
              guestKey: null,
            }
          : seat.subjectUserId === owner
            ? { requestedSubjectRole: RequestedSubjectRole.Self }
            : {
                requestedSubjectRole: RequestedSubjectRole.Companion,
                companionUserId: seat.subjectUserId,
              },
      startMinutes: seat.startMinutes,
      durationMinutes: seat.durationMinutes,
    });
  }
  return standing;
}

/** A cart seat as the decision's request line. */
function cartLine(line: MovedCartLine): BookingCall.SeatInput {
  return {
    lineId: line.lineId,
    serviceId: line.seat.serviceId,
    variantId: line.seat.variantId,
    barberId: line.seat.barberId,
    barberPreference: line.seat.barberPreference,
    startMinutes: line.seat.startMinutes,
    subject:
      line.seat.subject.requestedSubjectRole === RequestedSubjectRole.Guest
        ? {
            requestedSubjectRole: RequestedSubjectRole.Guest,
            label: line.seat.subject.label,
            guestKey: null,
          }
        : { requestedSubjectRole: RequestedSubjectRole.Self },
  };
}

/** A carried seat as the decision's request line — a companion at its kept distance. */
function carriedLine(line: CarriedLine): BookingCall.SeatInput {
  return {
    lineId: line.lineId,
    serviceId: line.seat.serviceId,
    variantId: line.seat.variantId,
    barberId: line.seat.barberId,
    barberPreference: line.seat.barberPreference,
    startMinutes: line.startMinutes,
    subject: {
      requestedSubjectRole: RequestedSubjectRole.Companion,
      companionUserId: line.userId ?? '',
    },
  };
}

type DecidePorts = IdPorts & HashPorts;

/** The decision over one set of lines — the cart alone, or the cart with the carried seats. */
function decideLines(
  loaded: Loaded,
  lines: readonly BookingCall.SeatInput[],
  carried: readonly CarriedLine[],
  owner: UserId,
  policy: BookingPolicy,
  nowUtcMs: UtcEpochMs,
  ports: DecidePorts,
): Result<BookingDecision, BookingError> {
  const input: DecideBookingInput = {
    locationId: loaded.locationId,
    localDate: loaded.localDate,
    seats: lines,
    // REUSED as the attempt id: the moved visit stays the same document.
    attemptId: loaded.stored.id,
    bookedFromAppointmentId: null,
    contact: null,
    placement: Placement.Self,
  };
  // A carried seat keeps its id and its sold terms; a cart seat is new.
  const ids: string[] = [];
  const overrides: StaffTermsOverride[] = [];
  for (const line of lines) {
    const kept = carried.find((each) => each.lineId === line.lineId) ?? null;
    ids.push(kept === null ? ports.nextId() : kept.seatId);
    if (kept !== null) {
      overrides.push(
        StaffTermsOverride.of(SeatKeyText.of(kept.lineId), kept.terms),
      );
    }
  }
  let cursor = 0;
  return BookingDecisionSystem.decide(
    input,
    bookingSnapshotOf(loaded.set, loaded.placement),
    policy,
    PlacementPolicy.clientDefault(),
    loaded.plan.release,
    {
      now: ZonedTimeSystem.shopNow(nowUtcMs, loaded.zone),
      startUtcMs: loaded.cartStartUtcMs,
      nextId: () => ids[cursor++] ?? ports.nextId(),
      ownerUserId: owner,
      customerIds: customerIdsFor(
        BookingDecisionSystem.accountSubjects(lines, owner),
        ports.hash,
      ),
      termsOverrides: overrides,
      standing: standingOf(loaded.stored, owner),
      stood: [],
      parsePhone: parseContactPhone,
    },
  );
}

/** The pure half — the decision and its one write plan. */
function decideMove(
  snapshot: Snapshot,
  owner: UserId,
  operation: Operation | null,
  policy: BookingPolicy,
  nowUtcMs: UtcEpochMs,
  ports: DecidePorts,
): Result<Decided, RescheduleAppointmentError> {
  if (snapshot.snapshot === 'REFUSED') return Result.err(snapshot.error);
  if (snapshot.snapshot === 'REPLAY') {
    return Result.ok({
      stored: snapshot.stored,
      after: null,
      moveOutcome: MoveOutcome.Replayed,
      revision: snapshot.revision,
      writes: [],
    });
  }
  if (snapshot.snapshot === 'UNCHANGED') {
    return Result.ok({
      stored: snapshot.stored,
      after: null,
      moveOutcome: MoveOutcome.Unchanged,
      revision: snapshot.stored.revision,
      writes: [],
    });
  }
  const loaded = snapshot;
  const { stored, plan } = loaded;
  // The free-cancellation window, on the stored start: a move inside it is
  // a cancellation by another name.
  const allowed = CancellationPolicySystem.mayMove(stored, policy, nowUtcMs);
  if (!allowed.ok) {
    return Result.err(
      BookingError.invalidInput(
        allowed.error.errorCode === CancellationRefusalCode.WindowClosed
          ? 'window_closed'
          : 'bookingStatus',
      ),
    );
  }
  const cartLines = plan.cart.map(cartLine);
  const offered = bookingSnapshotOf(loaded.set, loaded.placement).services.map(
    (service) => service.id,
  );
  const retired = plan.carried.filter(
    (line) => !offered.includes(line.seat.serviceId),
  );
  const decided =
    retired.length > 0
      ? null
      : decideLines(
          loaded,
          [...cartLines, ...plan.carried.map(carriedLine)],
          plan.carried,
          owner,
          policy,
          nowUtcMs,
          ports,
        );
  if (decided === null || !decided.ok) {
    if (decided !== null && plan.carried.length === 0) return decided;
    // The cart alone first: a cart that does not fit is the cart's refusal.
    const own = decideLines(
      loaded,
      cartLines,
      [],
      owner,
      policy,
      nowUtcMs,
      ports,
    );
    if (!own.ok) return own;
    return Result.err({
      errorCode: MoveErrorCode.CarriedSeatUnplaceable,
      refusal:
        decided === null
          ? CarriedSeatRefusal.ServiceUnavailable
          : MoveSystem.carriedRefusalOf(decided.error),
      seatIds: (decided === null ? retired : plan.carried).map(
        (line) => line.seatId,
      ),
    });
  }

  // The cart seats are the decided ones; a carried seat keeps everything
  // it was but its start.
  const seats: Seat[] = [];
  const decidedSeats = decided.value.appointment.seats;
  for (let i = 0; i < decidedSeats.length; i++) {
    const seat = decidedSeats[i] as Seat;
    const carried =
      i >= cartLines.length ? plan.carried[i - cartLines.length] : undefined;
    seats.push(
      carried === undefined
        ? seat
        : { ...carried.seat, startMinutes: seat.startMinutes },
    );
  }
  const revision = stored.revision + 1;
  const placed = AppointmentIndexSystem.withQueryKeys({
    ...stored,
    locationId: loaded.locationId,
    localDate: loaded.localDate,
    seats,
    revision,
    appliedOperations:
      operation === null
        ? stored.appliedOperations
        : AppointmentEditSystem.record(
            stored.appliedOperations,
            operation.id,
            revision,
            operation.digest,
          ),
  });
  // The envelope's instant, computed ONCE at ingestion from the shop's zone.
  const start = ZonedTimeSystem.toUtc(
    loaded.localDate,
    placed.startMinutes,
    loaded.zone,
  );
  const after: Appointment = {
    ...placed,
    utcEpochMs: start.ok ? start.value : loaded.cartStartUtcMs,
  };
  return Result.ok({
    stored,
    after,
    moveOutcome: MoveOutcome.Moved,
    revision,
    writes: [
      WriteOp.update(appointmentPath(stored.id), placementFields(after)),
      ...busyMergeWrites(
        loaded.placement,
        decided.value.busyWrites,
        loaded.zone,
      ),
    ],
  });
}
