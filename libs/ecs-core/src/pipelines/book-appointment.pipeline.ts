import {
  type Actor,
  AuditContext,
  AuditAction,
  type BarberPreference,
  type BookingContact,
  type BookingPolicy,
  Placement,
  type PlacementPolicy,
  WriteOp,
} from '@core/components';
import {
  BookingError,
  type RepositoryError,
  Result,
  ShopUnavailableReason,
  type AppointmentId,
  AuditResourceId,
  BarberId,
  type CustomerId,
  LocationId,
  ServiceId,
  type UserId,
  type UtcEpochMs,
} from '@core/primitives';
import type { Appointment } from '@core/entities';
import type {
  AccountContact,
  GovernancePorts,
  IdentityPorts,
  SchedulingPorts,
  TelemetryPorts,
  TxPorts,
} from '@core/ports';
import {
  type AuditFact,
  AuditSystem,
  BookingDecisionSystem,
  type DecideBookingInput,
  PartyAdmissionSystem,
  type RequestedSubjectInput,
  ZonedTimeSystem,
} from '@core/systems';
import {
  appendAuditFacts,
  appointmentPath,
  type BookingReadSet,
  bookingSnapshotOf,
  busyMergeWrites,
  frameShopDay,
  isReadableId,
  type PlacementSet,
  placementKeysOf,
  parseContactPhone,
  readAppointment,
  readBookingSet,
  readPlacementSet,
  type ShopDayFrame,
  UTC_ZONE,
  zoneOf,
} from './booking-read-set.pipeline';
import {
  customerCreates,
  customerIdsFor,
  customerIdsOf,
  runWithCustomerRetry,
} from './customer-records.pipeline';

/**
 * `bookAppointment` — the ONLY way an appointment comes into existence
 * (blueprint §4.1, flip 1 §3.2). The client's grid is an offer computed from
 * a projection that may be seconds stale; this is the authority: it
 * re-derives the price, the duration, the roster and the collision set from
 * server state INSIDE one transaction, and the client's numbers are never
 * consulted (`BookingDecisionSystem`).
 *
 * - **Outside, before the transaction:** the tenant policy (never widens
 *   the conflict set) and the FIRST_BOOKING contact snapshot of every
 *   account on the cart (`loadAccountContacts`, F1-5).
 * - **In the transaction:** `appointments/{attemptId}` FIRST — an attempt
 *   that already committed (response lost, client retried) answers its
 *   original booking and writes nothing, before anything else is asked;
 *   then the booking read set — the shop, the services, the schedules and
 *   the subjects' `customers/{id}` in ONE `getAll`, the busy days and
 *   exceptions of every key in a second (read even when absent). A booking
 *   ARRIVES at its shop: a client's only at a shop `/book` lists, the
 *   shop's own placement at any.
 * - **One plan:** the appointment `Create`, the busy `Set`s merged onto the
 *   exact busy bodies this attempt read, and a `customers` `Create` for
 *   every record found absent (F1-5). A commit that meets a customer record
 *   created meanwhile (ALREADY_EXISTS) re-runs the whole transaction ONCE —
 *   it re-reads and finds the record — and is never answered as success.
 * - **After the commit:** the act's rows (`attempt:<attemptId>`, else the
 *   new id), never fatal. A replay appends them again — the same ids, so
 *   nothing is written twice.
 */

/** One seat as the client asked for it — the decision's foreign input, its start an instant. */
export type BookSeatRequest = {
  readonly lineId: string;
  readonly serviceId: string;
  readonly variantId: string | null;
  readonly barberId: string;
  /** What the client ASKED for; `null` is stored as unknown, never guessed. */
  readonly barberPreference: BarberPreference | null;
  /** The wire start as its instant; `null` when it did not parse (refused as `startIso`). */
  readonly startUtcMs: UtcEpochMs | null;
  readonly subject: RequestedSubjectInput;
};

export type BookAppointmentCommand = {
  /**
   * The shop as SENT — parsed by the decision (an id that names no
   * document is refused as a shop that is not there), so a replayed attempt
   * is answered before anything about the request is judged.
   */
  readonly locationId: string;
  readonly seats: readonly BookSeatRequest[];
  /** The client's idempotency key — the new appointment's id; `null` mints one. */
  readonly attemptId: AppointmentId | null;
  /** The rebooking edge — an analytics link, no authority. */
  readonly bookedFromAppointmentId: AppointmentId | null;
  readonly contact: BookingContact.Input | null;
  /**
   * The VERIFIED owner — the token's uid for a client; for the shop's own
   * placement the named client, or `null` for a walk-in of guests.
   */
  readonly ownerUserId: UserId | null;
  /** The shop placing its own book: outside the window, confirmed on creation. */
  readonly staffPlacement: boolean;
  readonly actor: Actor | null;
};

export type BookAppointmentAnswer = {
  readonly appointmentId: AppointmentId;
  /** This attempt had already committed — its original answer, nothing written. */
  readonly replayed: boolean;
};

export type BookAppointmentError = BookingError | RepositoryError;

export type BookAppointmentPorts = TxPorts &
  Pick<SchedulingPorts, 'loadPolicy'> &
  Pick<IdentityPorts, 'loadAccountContacts'> &
  Pick<GovernancePorts, 'appendAudit'> &
  TelemetryPorts;

type Snapshot =
  | { readonly snapshot: 'REPLAY'; readonly existing: Appointment }
  | { readonly snapshot: 'REFUSED'; readonly error: BookingError }
  | {
      readonly snapshot: 'LOADED';
      readonly set: BookingReadSet;
      readonly placement: PlacementSet;
      readonly frame: ShopDayFrame;
    };

type Decided = {
  readonly appointment: Appointment;
  readonly replayed: boolean;
  readonly writes: readonly WriteOp[];
};

/** The client's placement rules and the shop's (a staff placement combines what it likes). */
function placementPolicyOf(staffPlacement: boolean): PlacementPolicy {
  return {
    allowOutsideWindow: staffPlacement,
    skipMinNotice: staffPlacement,
    allowOverlap: false,
    allowConflictingServices: staffPlacement,
  };
}

/** The ids a request names that could be documents — read; the rest are refused by the decision. */
function parsedIds<T>(
  raws: readonly string[],
  parse: (raw: string) => Result<T, unknown>,
): readonly T[] {
  const out: T[] = [];
  for (const raw of raws) {
    const parsed = parse(raw);
    if (parsed.ok && isReadableId(raw)) out.push(parsed.value);
  }
  return out;
}

export const bookAppointment =
  (ports: BookAppointmentPorts) =>
  async (
    cmd: BookAppointmentCommand,
  ): Promise<Result<BookAppointmentAnswer, BookAppointmentError>> => {
    // Somebody has to own a client's booking (anonymous until confirm).
    if (cmd.ownerUserId === null && !cmd.staffPlacement) {
      return Result.err(BookingError.unauthenticated());
    }
    const policy = await ports.loadPolicy();
    if (!policy.ok) return policy;
    const accounts = BookingDecisionSystem.accountSubjects(
      cmd.seats,
      cmd.ownerUserId,
    );
    const customerIds = customerIdsFor(accounts, ports.hash);
    const contacts = await ports.loadAccountContacts(accounts);
    if (!contacts.ok) return contacts;
    const nowUtcMs = ports.nowUtcMs();

    const committed = await runWithCustomerRetry(() =>
      ports.commit(
        (tx) => readBooking(tx, cmd, customerIdsOf(customerIds)),
        (snapshot) =>
          decideBooking(
            snapshot,
            cmd,
            policy.value,
            customerIds,
            contacts.value,
            nowUtcMs,
            ports.nextId,
          ),
      ),
    );
    if (!committed.ok) {
      ports.log('warn', 'booking.rejected', {
        errorCode: committed.error.errorCode,
      });
      return committed;
    }
    const { appointment, replayed } = committed.value;
    const fact: AuditFact = {
      resourceId: AuditResourceId.forAppointment(appointment.id),
      subjects: AuditSystem.subjectsOf(appointment),
      changeKey: AuditSystem.changeKey.attempt(cmd.attemptId, appointment.id),
      context: AuditContext.placement(
        cmd.staffPlacement
          ? AuditAction.BookingStaffCreated
          : AuditAction.BookingCommitted,
        appointment.locationId,
      ),
    };
    await appendAuditFacts(ports, [fact], cmd.actor);
    return Result.ok({ appointmentId: appointment.id, replayed });
  };

/** The transaction's read half — see {@link bookAppointment}. */
async function readBooking(
  tx: Parameters<Parameters<TxPorts['commit']>[0]>[0],
  cmd: BookAppointmentCommand,
  customerIds: readonly CustomerId[],
): Promise<Snapshot> {
  if (cmd.attemptId !== null) {
    const existing = await readAppointment(tx, cmd.attemptId);
    if (existing !== null) return { snapshot: 'REPLAY', existing };
  }
  const locationId = LocationId.parse(cmd.locationId);
  if (!locationId.ok || !isReadableId(cmd.locationId)) {
    return {
      snapshot: 'REFUSED',
      error: BookingError.shopUnavailable(
        cmd.locationId,
        ShopUnavailableReason.NotFound,
      ),
    };
  }
  const set = await readBookingSet(tx, {
    locationId: locationId.value,
    serviceIds: parsedIds(
      cmd.seats.map((seat) => seat.serviceId),
      ServiceId.parse,
    ),
    barberIds: parsedIds(
      cmd.seats.map((seat) => seat.barberId),
      BarberId.parse,
    ),
    customerIds,
  });
  if (set.location === null) {
    return {
      snapshot: 'REFUSED',
      error: BookingError.shopUnavailable(
        cmd.locationId,
        ShopUnavailableReason.NotFound,
      ),
    };
  }
  const zone = zoneOf(set.location);
  const starts = cmd.seats.map((seat) => seat.startUtcMs);
  const frame: ShopDayFrame =
    zone === null
      ? {
          localDate: null,
          startMinutes: starts.map(() => null),
          startUtcMs: null,
        }
      : frameShopDay(starts, zone);
  const placement = await readPlacementSet(
    tx,
    placementKeysOf(
      cmd.seats.map((seat, index) => ({
        barberId: seat.barberId,
        startMinutes: frame.startMinutes[index] ?? null,
      })),
      frame.localDate,
    ),
  );
  return { snapshot: 'LOADED', set, placement, frame };
}

/** The pure half — the decision and its one write plan. */
function decideBooking(
  snapshot: Snapshot,
  cmd: BookAppointmentCommand,
  policy: BookingPolicy,
  customerIds: ReadonlyMap<UserId, CustomerId>,
  contacts: ReadonlyMap<UserId, AccountContact>,
  nowUtcMs: UtcEpochMs,
  nextId: () => string,
): Result<Decided, BookingError> {
  if (snapshot.snapshot === 'REPLAY') {
    return Result.ok({
      appointment: snapshot.existing,
      replayed: true,
      writes: [],
    });
  }
  if (snapshot.snapshot === 'REFUSED') return Result.err(snapshot.error);
  const { set, placement, frame } = snapshot;
  const location = set.location;
  if (location === null) {
    return Result.err(
      BookingError.shopUnavailable(
        cmd.locationId,
        ShopUnavailableReason.NotFound,
      ),
    );
  }
  // A NEW booking arrives at its shop: a client's only at a listed one.
  if (!cmd.staffPlacement && !PartyAdmissionSystem.shopListed(location)) {
    return Result.err(
      BookingError.shopUnavailable(
        cmd.locationId,
        ShopUnavailableReason.Unlisted,
      ),
    );
  }
  const zone = zoneOf(location) ?? UTC_ZONE;
  const input: DecideBookingInput = {
    locationId: cmd.locationId,
    localDate: frame.localDate ?? '',
    seats: cmd.seats.map((seat, index) => ({
      lineId: seat.lineId,
      serviceId: seat.serviceId,
      variantId: seat.variantId,
      barberId: seat.barberId,
      barberPreference: seat.barberPreference,
      startMinutes: frame.startMinutes[index] ?? null,
      subject: seat.subject,
    })),
    attemptId: cmd.attemptId,
    bookedFromAppointmentId: cmd.bookedFromAppointmentId,
    contact: cmd.contact,
    placement: cmd.staffPlacement ? Placement.Staff : Placement.Self,
  };
  const decided = BookingDecisionSystem.decide(
    input,
    bookingSnapshotOf(set, placement),
    policy,
    placementPolicyOf(cmd.staffPlacement),
    [],
    {
      now: ZonedTimeSystem.shopNow(nowUtcMs, zone),
      startUtcMs: frame.startUtcMs ?? nowUtcMs,
      nextId,
      ownerUserId: cmd.ownerUserId,
      customerIds,
      termsOverrides: [],
      standing: [],
      stood: [],
      parsePhone: parseContactPhone,
    },
  );
  if (!decided.ok) return decided;
  const { id, ...body } = decided.value.appointment;
  return Result.ok({
    appointment: decided.value.appointment,
    replayed: false,
    writes: [
      WriteOp.create(appointmentPath(id), body),
      ...busyMergeWrites(placement, decided.value.busyWrites, zone),
      ...customerCreates(customerIds, set.customers, contacts, nowUtcMs),
    ],
  });
}
