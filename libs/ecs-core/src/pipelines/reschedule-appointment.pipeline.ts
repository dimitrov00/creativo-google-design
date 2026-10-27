import {
  type Actor,
  AuditContext,
  BookingCall,
  type BookingPolicy,
  BookingReadSnapshot,
  type ChairTime,
  LedgerVerdict,
  MoveOutcome,
  Placement,
  PlacementPolicy,
  RequestedSubjectRole,
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
  LogEvent,
  type MinuteOfDay,
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
  BookingErrorField,
  ShopUnavailableReason,
  CancellationRefusalCode,
  type RescheduleAppointmentError,
} from '@core/errors';
import type { Appointment, BarberBusyDay } from '@core/entities';
import type {
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
  AuditDeltaSystem,
  type AuditFact,
  AuditSystem,
  BookingDecisionSystem,
  type BookingDecision,
  CancellationPolicySystem,
  type CarriedLine,
  CustomerRecordSystem,
  type DecideBookingInput,
  DecisionInputSystem,
  type DecisionStandingSeat,
  type MovedCartLine,
  type MovePlan,
  MoveSystem,
  PartyAdmissionSystem,
  ZonedTimeSystem,
} from '@core/systems';
import {
  appointmentPath,
  logUnaudited,
  type BookingReadSet,
  bookingSnapshotOf,
  busyMergeWrites,
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
import { frameWallClock, slotRefusalOf } from './book-appointment.pipeline';
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
 *   Once planned, the carried seats (minutes no request named) are read on
 *   that zone too, and the envelope's instant is the whole party's earliest
 *   start — a carried seat in the gap is the same refusal, never answered
 *   with the cart's instant.
 * - **The plan** (`MoveSystem.plan`): the cart stands in for the seats the
 *   booker can name; everybody else is CARRIED at their kept distance, on
 *   the terms they were sold at. A request for exactly where the visit
 *   already is changes nothing. The decision runs the whole party under the
 *   client's rules after the free-cancellation window on the stored start;
 *   a carried seat it cannot place is the client's call to the shop
 *   (`carried_seat_unplaceable`, naming why) — unless the cart itself does
 *   not fit, which is the cart's own refusal. A walk-in the shop seated
 *   keeps its record through the move: the cart names them by label, and
 *   the decision seats the line of that label `WALK_IN` again
 *   (`CustomerRecordSystem.walkInsByLabel`, OR-26).
 * - **One plan:** the appointment `Update` (the revision stamped, a named
 *   move recorded in the ledger), the busy `Set`s of the NEW day merged
 *   onto what this attempt read (the old day is left to `rebuildBusy`) and,
 *   LAST, the act's rows (WS-1: `move:<attemptId>` — every move is named,
 *   WS-4.1), naming everyone the move touched, `Create`d in the SAME plan so
 *   they land with the move or not at all. A replayed named move and a
 *   request for where the visit already is plan none — a replay never meets
 *   its own row.
 * - **A refusal logs what the decision read** (WS-4.2, RU-25):
 *   `booking.move_rejected` with the `errorCode` and
 *   `DecisionInputSystem.slotFacts` of the LAST snapshot (the new day's
 *   busy days, the stored visit's revision, the chairs the plan handed
 *   back, so its own block is never named) — captured in the impure read
 *   callback, never inside the pure `decide` (Law 4) — never in the error
 *   (OR-12).
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
  /** The client's name for this move — REQUIRED (WS-4.1; the web always minted it). */
  readonly attemptId: ClientOperationId;
  /** The act's operation id — the attempt id's own text, parsed once at the edge (RU-20). */
  readonly operationId: OperationId;
  readonly actor: Actor | null;
};

export type RescheduleAppointmentAnswer = {
  readonly appointmentId: AppointmentId;
  /** The revision the visit stands at after this call (a replay: the one it stamped). */
  readonly revision: number;
  /** Nothing was written — a named move replayed, or a request for where the visit already is. */
  readonly replayed: boolean;
};

export type RescheduleAppointmentPorts = TxPorts &
  PolicyReadPorts &
  TelemetryPorts;

/** The ledger name of a client's move — one ledger with the staff edits. */
const MOVE_OPERATION = 'move:';

type Operation = { readonly id: OperationId; readonly digest: string };

type Loaded = {
  readonly bookingReadSnapshot: typeof BookingReadSnapshot.Loaded;
  readonly stored: Appointment;
  readonly locationId: LocationId;
  readonly localDate: LocalDate;
  readonly zone: TimeZone;
  /** The whole party's envelope instant on the shop's zone — cart and carried seats, computed ONCE. */
  readonly startUtcMs: UtcEpochMs;
  readonly plan: MovePlan;
  readonly set: BookingReadSet;
  readonly placement: PlacementSet;
};

type Snapshot =
  | {
      readonly bookingReadSnapshot: typeof BookingReadSnapshot.Refused;
      readonly error: RescheduleAppointmentError;
    }
  | {
      readonly bookingReadSnapshot: typeof BookingReadSnapshot.Replay;
      readonly stored: Appointment;
      readonly revision: number;
    }
  | {
      readonly bookingReadSnapshot: typeof BookingReadSnapshot.Unchanged;
      readonly stored: Appointment;
    }
  | Loaded;

type Decided = {
  /** How the call ended: written, a named move replayed, or nothing to do (`MoveOutcome`, a component). */
  readonly moveOutcome: MoveOutcome;
  readonly revision: number;
  /** The facts no row was planned for: no verified actor. */
  readonly unaudited: readonly AuditFact[];
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
    const operation: Operation = {
      id: OperationId.of(`${MOVE_OPERATION}${cmd.attemptId}`),
      // The shop, the day and the seats, as sent — the staff edit's basis
      // over one `{ move }` command, so both kinds of intent share a ledger.
      digest: AppointmentEditSystem.digestOf(
        ports.hash(
          MoveSystem.digestBasis({
            locationId: cmd.locationId,
            localDate: cmd.localDate,
            seats: cmd.seats,
          }),
        ),
      ),
    };
    // Read before the transaction: a contention re-run of `decide` derives
    // the same plan, row ids included.
    const nowUtcMs = ports.nowUtcMs();

    // The decision's input, kept by the IMPURE read (Law 4): the snapshot
    // the last attempt read is exactly what a refusing `decide` saw.
    let lastRead: Snapshot | null = null;
    const committed = await ports.commit(
      (tx) => {
        lastRead = null;
        return readMove(tx, cmd, owner, operation).then((snapshot) => {
          lastRead = snapshot;
          return snapshot;
        });
      },
      (snapshot) =>
        decideMove(
          snapshot,
          cmd,
          owner,
          operation,
          policy.value,
          nowUtcMs,
          ports,
        ),
    );
    if (!committed.ok) {
      ports.log('warn', LogEvent.BookingMoveRejected, {
        errorCode: committed.error.errorCode,
        ...DecisionInputSystem.slotFacts(
          busyRead(lastRead),
          slotRefusalOf(committed.error),
          revisionRead(lastRead),
          releaseRead(lastRead),
        ),
      });
      return committed;
    }
    const { moveOutcome, revision, unaudited } = committed.value;
    logUnaudited(ports, unaudited);
    return Result.ok({
      appointmentId: cmd.appointmentId,
      revision,
      replayed: moveOutcome !== MoveOutcome.Moved,
    });
  };

/** The busy days a move's snapshot read — the new day's, once its placement was read. */
function busyRead(snapshot: Snapshot | null): readonly BarberBusyDay[] {
  return snapshot !== null &&
    snapshot.bookingReadSnapshot === BookingReadSnapshot.Loaded
    ? snapshot.placement.busy
    : [];
}

/** The stored visit's revision, when the snapshot holds the visit. */
function revisionRead(snapshot: Snapshot | null): number | null {
  return snapshot === null ||
    snapshot.bookingReadSnapshot === BookingReadSnapshot.Refused
    ? null
    : snapshot.stored.revision;
}

/** The chairs the move's decision was handed back — its plan's `release`, once loaded. */
function releaseRead(snapshot: Snapshot | null): readonly ChairTime[] {
  return snapshot !== null &&
    snapshot.bookingReadSnapshot === BookingReadSnapshot.Loaded
    ? snapshot.plan.release
    : [];
}

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
  operation: Operation,
): Promise<Snapshot> {
  const stored = await readAppointment(tx, cmd.appointmentId);
  if (stored === null || stored.ownerUserId !== owner) {
    return {
      bookingReadSnapshot: BookingReadSnapshot.Refused,
      error: BookingError.invalidInput('appointmentId'),
    };
  }
  const verdict = AppointmentEditSystem.ledgerVerdict(
    stored.appliedOperations,
    operation.id,
    operation.digest,
  );
  if (verdict.ledgerVerdict === LedgerVerdict.Mismatch) {
    return {
      bookingReadSnapshot: BookingReadSnapshot.Refused,
      error: BookingError.invalidInput('attemptId'),
    };
  }
  if (verdict.ledgerVerdict === LedgerVerdict.Replay) {
    return {
      bookingReadSnapshot: BookingReadSnapshot.Replay,
      stored,
      revision: verdict.applied.revision,
    };
  }
  const notFound: Snapshot = {
    bookingReadSnapshot: BookingReadSnapshot.Refused,
    error: BookingError.shopUnavailable(
      cmd.locationId,
      ShopUnavailableReason.NotFound,
    ),
  };
  // A shop id `LocationId.parse` refuses — blank, a `/`, a reserved name
  // (OR-44) — is an invalid request, refused UNREAD (DEP-F31): no document
  // could ever bear it, so it is no "shop not found".
  const locationId = LocationId.parse(cmd.locationId);
  if (!locationId.ok) {
    return {
      bookingReadSnapshot: BookingReadSnapshot.Refused,
      error: BookingError.invalidInput(BookingErrorField.LocationId),
    };
  }
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
    return {
      bookingReadSnapshot: BookingReadSnapshot.Refused,
      error: framed.error,
    };
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
      bookingReadSnapshot: BookingReadSnapshot.Refused,
      error: BookingError.invalidInput('startMinutes'),
    };
  }
  // A visit moved IN from another shop is asked what a new booking is:
  // listed (`MoveSystem.plan`'s last refusal).
  const plan = MoveSystem.plan(
    stored,
    owner,
    {
      locationId: locationId.value,
      localDate: frame.localDate,
      seats: cart,
    },
    PartyAdmissionSystem.shopListed(set.location),
  );
  if (!plan.ok) {
    return {
      bookingReadSnapshot: BookingReadSnapshot.Refused,
      error: plan.error,
    };
  }
  if (plan.value.unchanged) {
    return { bookingReadSnapshot: BookingReadSnapshot.Unchanged, stored };
  }
  const keyed: {
    readonly barberId: string;
    readonly startMinutes: MinuteOfDay | null;
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
  // THE PARTY ON THE CLOCK: a carried seat keeps its distance from the
  // booker, so it lands on a minute the request never named — one the zone
  // must show too; the envelope's instant is the party's earliest start.
  const party = frameWallClock(
    frame.localDate,
    keyed.map((seat) => seat.startMinutes),
    zone,
  );
  if (!party.ok) {
    return {
      bookingReadSnapshot: BookingReadSnapshot.Refused,
      error: party.error,
    };
  }
  if (party.value.startUtcMs === null) {
    return {
      bookingReadSnapshot: BookingReadSnapshot.Refused,
      error: BookingError.invalidInput('startMinutes'),
    };
  }
  const placement = await readPlacementSet(
    tx,
    placementKeysOf(keyed, frame.localDate),
  );
  return {
    bookingReadSnapshot: BookingReadSnapshot.Loaded,
    stored,
    locationId: locationId.value,
    localDate: frame.localDate,
    zone,
    startUtcMs: party.value.startUtcMs,
    plan: plan.value,
    set,
    placement,
  };
}

/**
 * The visit as it stood, for "one person, one chair" — the booker's own
 * seats are `SELF`; a guest (anonymous, or a walk-in the shop keeps a
 * record for) is their label.
 */
function standingOf(
  stored: Appointment,
  owner: UserId,
): readonly DecisionStandingSeat[] {
  const standing: DecisionStandingSeat[] = [];
  for (const seat of stored.seats) {
    standing.push({
      seatId: seat.seatId,
      subject:
        seat.seatSubject !== SeatSubject.Account
          ? {
              requestedSubjectRole: RequestedSubjectRole.Guest,
              label: seat.guestLabel,
              guestKey: null,
              contact: null,
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
            contact: null,
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
      startUtcMs: loaded.startUtcMs,
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
      walkIns: CustomerRecordSystem.walkInsByLabel(loaded.stored.seats, lines),
    },
  );
}

/** The pure half — the decision and its one write plan. */
function decideMove(
  snapshot: Snapshot,
  cmd: RescheduleAppointmentCommand,
  owner: UserId,
  operation: Operation,
  policy: BookingPolicy,
  nowUtcMs: UtcEpochMs,
  ports: DecidePorts,
): Result<Decided, RescheduleAppointmentError> {
  if (snapshot.bookingReadSnapshot === BookingReadSnapshot.Refused) {
    return Result.err(snapshot.error);
  }
  // A replayed named move and a move to where the visit already is plan NO
  // row: the first landed with its move; the second moved nothing.
  if (snapshot.bookingReadSnapshot === BookingReadSnapshot.Replay) {
    return Result.ok({
      moveOutcome: MoveOutcome.Replayed,
      revision: snapshot.revision,
      unaudited: [],
      writes: [],
    });
  }
  if (snapshot.bookingReadSnapshot === BookingReadSnapshot.Unchanged) {
    return Result.ok({
      moveOutcome: MoveOutcome.Unchanged,
      revision: snapshot.stored.revision,
      unaudited: [],
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
  // The whole party, else the cart alone — the ladder is `MoveSystem`'s.
  const decided = MoveSystem.decideCarried(
    plan,
    bookingSnapshotOf(loaded.set, loaded.placement).services,
    (carried) =>
      decideLines(
        loaded,
        [...cartLines, ...carried.map(carriedLine)],
        carried,
        owner,
        policy,
        nowUtcMs,
        ports,
      ),
  );
  if (!decided.ok) return decided;

  // The cart seats are the decided ones; a carried seat keeps everything
  // it was but its start.
  const seats = MoveSystem.seatsAfter(decided.value, plan);
  const revision = stored.revision + 1;
  const after = AppointmentIndexSystem.withQueryKeys({
    ...stored,
    locationId: loaded.locationId,
    localDate: loaded.localDate,
    // The envelope's instant, computed ONCE at ingestion from the shop's zone.
    utcEpochMs: loaded.startUtcMs,
    seats,
    revision,
    appliedOperations: AppointmentEditSystem.record(
      stored.appliedOperations,
      operation.id,
      revision,
      operation.digest,
    ),
    // The call that wrote it last (WS-4.3) — the join key to its row.
    writeOperationId: cmd.operationId,
  });
  // Everyone the move touched: who the visit had, and who it has now.
  const audit = AuditSystem.commitWrites(
    [
      {
        resourceId: AuditResourceId.forAppointment(stored.id),
        subjects: [
          ...AuditSystem.subjectsOf(stored),
          ...AuditSystem.subjectsOf(after),
        ],
        changeKey: AuditSystem.changeKey.move(cmd.attemptId),
        operationId: cmd.operationId,
        // Where the move took the visit — stored against moved (WS-2).
        context: AuditContext.rescheduled(
          revision,
          AuditDeltaSystem.rescheduled(stored, after),
        ),
      },
    ],
    cmd.actor,
    nowUtcMs,
    ports.hash,
  );
  return Result.ok({
    moveOutcome: MoveOutcome.Moved,
    revision,
    unaudited: audit.unaudited,
    writes: [
      WriteOp.update(appointmentPath(stored.id), placementFields(after)),
      ...busyMergeWrites(
        loaded.placement,
        decided.value.busyWrites,
        loaded.zone,
      ),
      ...audit.writes,
    ],
  });
}
