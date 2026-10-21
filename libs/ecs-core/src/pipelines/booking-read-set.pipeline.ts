import {
  type Actor,
  BlockKind,
  type E164,
  MinuteBlock,
  type MinuteRange,
  ServiceStatus,
  VoucherRedemption,
  WriteAction,
  WriteOp,
  type DocBody,
  type DocPath,
} from '@core/components';
import {
  AuditEntryId,
  BarberId,
  BusyKey,
  type AppointmentId,
  type CustomerId,
  type GiftVoucherId,
  type LocationId,
  type ServiceId,
  LocalDate,
  type MinuteOfDay,
  type TimeZone,
  UtcEpochMs,
  defect,
} from '@core/primitives';
import {
  type Appointment,
  type AuditEntry,
  type BarberBusyDay,
  type BarberSchedule,
  type Customer,
  type GiftVoucher,
  type ScheduleException,
  type Service,
  type ShopLocation,
  Collections,
} from '@core/entities';
import type {
  AuditAppendPorts,
  ClockPorts,
  HashPorts,
  IdPorts,
  LogPorts,
  ReadTx,
} from '@core/ports';
import {
  type AuditFact,
  AuditSystem,
  type BookingSnapshot,
  type BusyWrite,
  type DecisionBusyDay,
  type DecisionSchedule,
  BusySystem,
  PhoneSystem,
  VoucherSystem,
  ZonedTimeSystem,
} from '@core/systems';

/**
 * THE BOOKING READ SET (flip 1 §3.2) — the transactional reads every
 * placing pipeline shares (`bookAppointment`, `rescheduleAppointment`,
 * `editAppointment`), in TWO batched round trips before any write:
 *
 * 1. {@link readBookingSet} — ONE `getAll` of everything whose id is
 *    derivable before a read: the location, the catalogue services, the
 *    barbers' schedules and the account subjects' `customers/{id}` (F1-5:
 *    the client records ride the phase-one read, no extra round trip);
 * 2. {@link readPlacementSet} — ONE `getAll` of `barberBusy` AND
 *    `scheduleExceptions` for every `BusyKey` of the placement, read even
 *    when absent: an empty read still enters the conflict set, so two
 *    clients racing for a barber's first booking of the day serialise, and
 *    a commit racing a just-declared day off loses honestly. It cannot join
 *    phase one — a busy key names the shop DAY, which the location's zone
 *    gives.
 *
 * A `ReadTx` helper, no ports. Plus the glue the three pipelines share:
 * the decision's snapshot over the read set ({@link bookingSnapshotOf}),
 * the busy `Set`s merged onto the EXACT busy bodies this attempt read
 * ({@link busyMergeWrites} — merging onto anything else would drop every
 * other booking already in that document), the shop-day framing of wire
 * instants ({@link frameShopDay}, the ingestion boundary of Law 7.3) and
 * the contact phone parser the decision is handed.
 */

/** Everything phase one reads by id (duplicates are read once). */
export type BookingReadRequest = {
  readonly locationId: LocationId;
  readonly serviceIds: readonly ServiceId[];
  readonly barberIds: readonly BarberId[];
  readonly customerIds: readonly CustomerId[];
};

/** What phase one found — absent documents are absent from the lists. */
export type BookingReadSet = {
  readonly location: ShopLocation | null;
  /** Every service read, whatever its status ({@link bookingSnapshotOf} keeps the bookable ones). */
  readonly services: readonly Service[];
  readonly schedules: readonly BarberSchedule[];
  /** Every client record asked for, `null` when absent (F1-5: absent → a `FIRST_BOOKING` create). */
  readonly customers: ReadonlyMap<CustomerId, Customer | null>;
};

/** What phase two found, and the keys it read (absent included). */
export type PlacementSet = {
  readonly keys: readonly BusyKey[];
  readonly busy: readonly BarberBusyDay[];
  readonly exceptions: readonly ScheduleException[];
  /** The client records asked for in the same round trip, `null` when absent. */
  readonly customers: ReadonlyMap<CustomerId, Customer | null>;
};

/** The empty placement — a request whose seats name no readable day. */
export const NO_PLACEMENT: PlacementSet = {
  keys: [],
  busy: [],
  exceptions: [],
  customers: new Map(),
};

/**
 * Could `raw` name a Firestore document? The SDK throws on an empty id or
 * one holding a `/` as the reference is built, and the server refuses `.`,
 * `..` and a reserved `__…__` name — an id that could not is never read: it
 * names nothing (the commit refuses such a shop UNREAD as not found).
 */
export function isReadableId(raw: string): boolean {
  return (
    raw.length > 0 &&
    !raw.includes('/') &&
    raw !== '.' &&
    raw !== '..' &&
    !/^__.*__$/.test(raw)
  );
}

function distinctReadable<T extends string>(ids: readonly T[]): readonly T[] {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i] as T;
    if (isReadableId(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/** `appointments/{id}`. */
export function appointmentPath(id: AppointmentId): DocPath {
  return [Collections.Appointments, id];
}

/** `customers/{id}`. */
export function customerPath(id: CustomerId): DocPath {
  return [Collections.Customers, id];
}

/** One appointment inside the transaction — the entity, or `null`. */
export function readAppointment(
  tx: ReadTx,
  id: AppointmentId,
): Promise<Appointment | null> {
  return tx.get<Appointment>(appointmentPath(id));
}

/** Phase one: ONE `getAll` of the location, the services, the schedules and the client records. */
export async function readBookingSet(
  tx: ReadTx,
  request: BookingReadRequest,
): Promise<BookingReadSet> {
  const serviceIds = distinctReadable(request.serviceIds);
  const barberIds = distinctReadable(request.barberIds);
  const customerIds = distinctReadable(request.customerIds);
  const paths: DocPath[] = [[Collections.Locations, request.locationId]];
  for (const id of serviceIds) paths.push([Collections.Services, id]);
  for (const id of barberIds) paths.push([Collections.BarberSchedules, id]);
  for (const id of customerIds) paths.push(customerPath(id));
  const docs = await tx.getAll<unknown>(paths);

  const services: Service[] = [];
  for (let i = 0; i < serviceIds.length; i++) {
    const doc = docs[1 + i] as Service | null;
    if (doc !== null) services.push(doc);
  }
  const schedules: BarberSchedule[] = [];
  const offset = 1 + serviceIds.length;
  for (let i = 0; i < barberIds.length; i++) {
    const doc = docs[offset + i] as BarberSchedule | null;
    if (doc !== null) schedules.push(doc);
  }
  const customers = new Map<CustomerId, Customer | null>();
  const customerOffset = offset + barberIds.length;
  for (const [i, id] of customerIds.entries()) {
    customers.set(id, (docs[customerOffset + i] as Customer | null) ?? null);
  }
  return {
    location: (docs[0] as ShopLocation | null) ?? null,
    services,
    schedules,
    customers,
  };
}

/**
 * Phase two: ONE `getAll` of the busy days AND the exceptions of every key,
 * absent ones read too — and, in the same round trip, the client records a
 * caller could only name once it knew the placement (an edit's added
 * accounts).
 */
export async function readPlacementSet(
  tx: ReadTx,
  keys: readonly BusyKey[],
  customerIds: readonly CustomerId[] = [],
): Promise<PlacementSet> {
  const distinct: BusyKey[] = [];
  for (const key of keys) if (!distinct.includes(key)) distinct.push(key);
  const records = distinctReadable(customerIds);
  if (distinct.length === 0 && records.length === 0) return NO_PLACEMENT;
  const paths: DocPath[] = [];
  for (const key of distinct) paths.push([Collections.BarberBusy, key]);
  for (const key of distinct) {
    paths.push([Collections.ScheduleExceptions, key]);
  }
  for (const id of records) paths.push(customerPath(id));
  const docs = await tx.getAll<unknown>(paths);
  const busy: BarberBusyDay[] = [];
  const exceptions: ScheduleException[] = [];
  for (let i = 0; i < distinct.length; i++) {
    const day = docs[i] as BarberBusyDay | null;
    if (day !== null) busy.push(day);
    const exception = docs[distinct.length + i] as ScheduleException | null;
    if (exception !== null) exceptions.push(exception);
  }
  const customers = new Map<CustomerId, Customer | null>();
  for (const [i, id] of records.entries()) {
    customers.set(
      id,
      (docs[2 * distinct.length + i] as Customer | null) ?? null,
    );
  }
  return { keys: distinct, busy, exceptions, customers };
}

/**
 * The busy keys a placement touches: each seat's barber (an id that parses)
 * on the visit's ONE shop day (T7), distinct, sorted. A seat with no
 * placed start touches no document — the decision refuses it.
 */
export function placementKeysOf(
  seats: readonly {
    readonly barberId: string;
    readonly startMinutes: MinuteOfDay | null;
  }[],
  localDate: LocalDate | null,
): readonly BusyKey[] {
  if (localDate === null) return [];
  const keys: BusyKey[] = [];
  for (const seat of seats) {
    const barber = BarberId.parse(seat.barberId);
    if (!barber.ok || seat.startMinutes === null) continue;
    if (!isReadableId(barber.value)) continue;
    const key = BusyKey.of(barber.value, localDate);
    if (!keys.includes(key)) keys.push(key);
  }
  return keys.sort();
}

/**
 * The decision's snapshot over what this attempt read: the shop's week,
 * the BOOKABLE services (a retired one is absent, so the decision refuses
 * it as unknown rather than guessing at terms nobody authored), each
 * schedule under its barber, each busy day's blocks as its spans (a block
 * IS a minute range) and every published exception as read.
 */
export function bookingSnapshotOf(
  set: BookingReadSet,
  placement: PlacementSet,
): BookingSnapshot {
  const services: Service[] = [];
  for (const service of set.services) {
    if (service.serviceStatus === ServiceStatus.Active) services.push(service);
  }
  const schedules: DecisionSchedule[] = [];
  for (const schedule of set.schedules) {
    schedules.push({
      barberId: schedule.id,
      versions: schedule.versions,
      turnaroundMinutes: schedule.turnaroundMinutes,
    });
  }
  const busy: DecisionBusyDay[] = [];
  for (const day of placement.busy) {
    busy.push({
      id: BusyKey.of(day.barberId, day.localDate),
      spans: day.blocks,
    });
  }
  return {
    shopHours: set.location === null ? [] : set.location.openingHours,
    services,
    schedules,
    busy,
    exceptions: placement.exceptions,
  };
}

/** The stored blocks of one key, or none when the day held nothing. */
function storedSpans(
  placement: PlacementSet,
  key: BusyKey,
): readonly MinuteRange[] {
  for (const day of placement.busy) {
    if (BusyKey.of(day.barberId, day.localDate) === key) return day.blocks;
  }
  return [];
}

/**
 * The busy `Set`s of a decision — one per (barber, shop day) document,
 * merged onto the EXACT body this attempt read (`BusySystem.mergeBusy`:
 * normalized, so a visitor learns density, never client count). Two seats
 * for one barber on one day are ONE write: issuing two would have the
 * second overwrite the first's merge with a stale base. The day's
 * `utcEpochMs` is its first instant in the location's zone; `purgeAt` is the
 * adapter's (F1-7). Every key written is a key {@link readPlacementSet} read.
 */
export function busyMergeWrites(
  placement: PlacementSet,
  busyWrites: readonly BusyWrite[],
  timeZone: TimeZone,
): readonly WriteOp[] {
  const keys: BusyKey[] = [];
  const adds: MinuteRange[][] = [];
  const owners: BusyWrite[] = [];
  for (const write of busyWrites) {
    const key = BusyKey.of(write.barberId, write.localDate);
    let at = keys.indexOf(key);
    if (at < 0) {
      at = keys.length;
      keys.push(key);
      adds.push([]);
      owners.push(write);
    }
    (adds[at] as MinuteRange[]).push({
      startMinutes: write.startMinutes,
      endMinutes: write.endMinutes,
    });
  }
  const writes: WriteOp[] = [];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i] as BusyKey;
    const owner = owners[i] as BusyWrite;
    const merged = BusySystem.mergeBusy(
      storedSpans(placement, key),
      adds[i] as MinuteRange[],
      [],
    );
    const blocks: MinuteBlock[] = [];
    for (const span of merged) {
      blocks.push(
        MinuteBlock.of(span.startMinutes, span.endMinutes, BlockKind.Busy),
      );
    }
    const body: Omit<BarberBusyDay, 'id'> = {
      barberId: owner.barberId,
      localDate: owner.localDate,
      utcEpochMs: ZonedTimeSystem.startOfLocalDay(owner.localDate, timeZone),
      blocks,
    };
    writes.push(WriteOp.set([Collections.BarberBusy, key], body));
  }
  return writes;
}

/**
 * Wire instants on the shop's clock (the ingestion boundary, Law 7.3): the
 * visit's ONE shop day is the day of the first start that parsed (T7); each
 * start becomes its minute of THAT day — `null` for a start that did not
 * parse or that falls on another day (the decision refuses that start) —
 * and the envelope's instant is the earliest start placed on
 * the day.
 */
export type ShopDayFrame = {
  readonly localDate: LocalDate | null;
  readonly startMinutes: readonly (MinuteOfDay | null)[];
  readonly startUtcMs: UtcEpochMs | null;
};

export function frameShopDay(
  starts: readonly (UtcEpochMs | null)[],
  timeZone: TimeZone,
): ShopDayFrame {
  let localDate: LocalDate | null = null;
  for (const start of starts) {
    if (start === null) continue;
    localDate = ZonedTimeSystem.toLocal(start, timeZone).localDate;
    break;
  }
  const minutes: (MinuteOfDay | null)[] = [];
  let startUtcMs: UtcEpochMs | null = null;
  for (const start of starts) {
    if (start === null || localDate === null) {
      minutes.push(null);
      continue;
    }
    const wall = ZonedTimeSystem.toLocal(start, timeZone);
    if (wall.localDate !== localDate) {
      minutes.push(null);
      continue;
    }
    minutes.push(wall.minute);
    if (startUtcMs === null || UtcEpochMs.compare(start, startUtcMs) < 0) {
      startUtcMs = start;
    }
  }
  return { localDate, startMinutes: minutes, startUtcMs };
}

/** A contact phone as the decision validates it — E.164 or local text, no default country (the kernel's rule). */
export function parseContactPhone(raw: string): E164 | null {
  const parsed = PhoneSystem.parse(raw, null);
  return parsed.ok ? parsed.value.e164 : null;
}

/**
 * The clock a request whose shop zone cannot be read is judged on — UTC,
 * as today: every seat of such a request is refused unplaced before any
 * answer reads its day.
 */
export const UTC_ZONE: TimeZone = ((): TimeZone => {
  const zone = ZonedTimeSystem.checkZone('UTC');
  return zone.ok ? zone.value : defect('the runtime knows no UTC zone');
})();

/** The location's zone, or `null` when its stored zone is not one the runtime knows. */
export function zoneOf(location: ShopLocation): TimeZone | null {
  const zone = ZonedTimeSystem.checkZone(location.timeZone);
  return zone.ok ? zone.value : null;
}

/** A civil day as its `LocalDate`, or `null` — for a stored day read back. */
export function localDateOrNull(raw: string): LocalDate | null {
  const parsed = LocalDate.parse(raw);
  return parsed.ok ? parsed.value : null;
}

/** What the after-commit audit write needs: the write port, the id mints, the clock and the log. */
export type AuditWritePorts = AuditAppendPorts &
  HashPorts &
  IdPorts &
  ClockPorts &
  LogPorts;

/**
 * The act's audit rows, AFTER the commit and never inside it (blueprint §4):
 * planned by `AuditSystem.plan` — one row per person per fact — each id
 * `hash(idBasis)` (a replay derives the same id and writes nothing twice;
 * a fact with no change key mints `nextId()`), written by `appendAudit`,
 * which is never fatal. A missing verified actor or a row the planner
 * refuses is logged loudly and writes nothing — the act already happened.
 */
export async function appendAuditFacts(
  ports: AuditWritePorts,
  facts: readonly AuditFact[],
  actor: Actor | null,
): Promise<void> {
  if (facts.length === 0) return;
  const first = facts[0] as AuditFact;
  if (actor === null) {
    ports.log('error', 'audit row has no verified actor', {
      action: first.context.auditAction,
      resourceId: first.resourceId,
    });
    return;
  }
  const planned = AuditSystem.plan(facts, actor, ports.nowUtcMs());
  if (!planned.ok) {
    ports.log('error', 'audit entry refused by domain', {
      action: first.context.auditAction,
      errorCode: planned.error.errorCode,
    });
    return;
  }
  const rows: AuditEntry[] = [];
  for (const plan of planned.value) {
    rows.push({
      id: AuditEntryId.of(
        plan.idBasis === null ? ports.nextId() : ports.hash(plan.idBasis),
      ),
      ...plan.row,
    });
  }
  await ports.appendAudit(rows);
}

/** `giftVouchers/{id}`. */
export function voucherPath(id: GiftVoucherId): DocPath {
  return [Collections.GiftVouchers, id];
}

/**
 * The vouchers a visit's LIVE redemption lines name, in ONE `getAll`
 * (absent read too) — what a cancellation gives back, read before any write
 * so the restore settles against the balance this attempt read.
 */
export async function readRedemptionVouchers(
  tx: ReadTx,
  redemptions: readonly VoucherRedemption[],
): Promise<readonly GiftVoucher[]> {
  const ids: GiftVoucherId[] = [];
  for (const line of redemptions) {
    if (VoucherRedemption.isLive(line) && !ids.includes(line.voucherId)) {
      ids.push(line.voucherId);
    }
  }
  if (ids.length === 0) return [];
  const docs = await tx.getAll<GiftVoucher>(ids.map(voucherPath));
  const found: GiftVoucher[] = [];
  for (const doc of docs) if (doc !== null) found.push(doc);
  return found;
}

/**
 * `op` with more root fields set — the same path, the same deletions — so a
 * write the plan already holds absorbs a field instead of a second write of
 * one document. Only an `Update`/`Set` carries fields; anything else is
 * returned as is.
 */
export function withMoreFields(op: WriteOp, extra: DocBody): WriteOp {
  switch (op.writeAction) {
    case WriteAction.Update:
      return WriteOp.transition(
        op.path,
        { ...op.fields, ...extra },
        op.deleteFields,
      );
    case WriteAction.Set:
      return WriteOp.set(op.path, { ...op.body, ...extra });
    default:
      return op;
  }
}

/**
 * What a visit that ends CANCELLED gives back to the gift vouchers it drew
 * on (2026-09-10), in the SAME plan: `VoucherSystem.restorePlan` — each live
 * line reversed at `nowUtcMs`, each voucher's balance restored — folded into
 * the appointment's own write (its `voucherRedemptions`) beside one balance
 * `Update` per voucher. `appointmentWrites` unchanged when the visit paid
 * with no live line (nearly always).
 */
export function voucherRestoreWrites(
  appointmentWrites: readonly WriteOp[],
  redemptions: readonly VoucherRedemption[],
  vouchers: readonly GiftVoucher[],
  nowUtcMs: UtcEpochMs,
): readonly WriteOp[] {
  const plan = VoucherSystem.restorePlan(redemptions, vouchers, nowUtcMs);
  if (plan === null) return appointmentWrites;
  const writes: WriteOp[] = [];
  for (let i = 0; i < appointmentWrites.length; i++) {
    const op = appointmentWrites[i] as WriteOp;
    writes.push(
      i === 0
        ? withMoreFields(op, { voucherRedemptions: plan.voucherRedemptions })
        : op,
    );
  }
  for (const after of plan.vouchers) {
    let before: GiftVoucher | null = null;
    for (const voucher of vouchers) {
      if (voucher.id === after.id) before = voucher;
    }
    if (before !== null)
      writes.push(VoucherSystem.transitionWrite(before, after));
  }
  return writes;
}

/**
 * The root fields a placing write sets — the geometry, the query mirrors
 * (`AppointmentIndexSystem.withQueryKeys`) and the edit ledger: what a move
 * or a staff edit changes about a visit that stays the same document.
 */
export function placementFields(after: Appointment): DocBody {
  return {
    locationId: after.locationId,
    seats: after.seats,
    localDate: after.localDate,
    startMinutes: after.startMinutes,
    endMinutes: after.endMinutes,
    utcEpochMs: after.utcEpochMs,
    ownerUserId: after.ownerUserId,
    subjectUserIds: after.subjectUserIds,
    ownerCustomerId: after.ownerCustomerId,
    subjectCustomerIds: after.subjectCustomerIds,
    barberIds: after.barberIds,
    busyKeys: after.busyKeys,
    revision: after.revision,
    appliedOperations: after.appliedOperations,
  };
}
