import {
  BlockKind,
  DiscountProvenance,
  type E164,
  MinuteBlock,
  type MinuteRange,
  VoucherRedemption,
  WriteAction,
  WriteOp,
  type DocBody,
  type DocPath,
} from '@core/components';
import {
  BarberId,
  BusyKey,
  type AppointmentId,
  CouponGrantId,
  CustomerId,
  type GiftVoucherId,
  type LocationId,
  ServiceId,
  type LocalDate,
  LogEvent,
  type MinuteOfDay,
  TimeZone,
  UtcEpochMs,
} from '@core/primitives';
import {
  type Appointment,
  type BarberBusyDay,
  type BarberSchedule,
  type CouponGrant,
  type Customer,
  type GiftVoucher,
  type ScheduleException,
  type Service,
  type ShopLocation,
  Collections,
} from '@core/entities';
import type { LogPorts, ReadTx } from '@core/ports';
import {
  type AuditFact,
  type BookingSnapshot,
  type BusyWrite,
  BusySystem,
  CouponGrantSystem,
  PartyAdmissionSystem,
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
 *    barbers' schedules and the client records — the account subjects'
 *    `customers/{id}` (F1-5) and the walk-ins' (OR-26: the id derives from
 *    the contact, `CustomerId.forWalkIn`) — riding the phase-one read, no
 *    extra round trip;
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
 * other booking already in that document) and the contact phone parser
 * the decision is handed. (The call's wall clock is framed on the shop's
 * zone by `frameWallClock`, `book-appointment.pipeline.ts`.)
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
  /**
   * Every client record asked for, `null` when absent (F1-5: an account's
   * absent → a `FIRST_BOOKING` create; OR-26: a walk-in's → `STAFF_WALK_IN`).
   */
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
 * The ids of `ids` that could name a Firestore document, each once — `is`
 * is the brand's own door (`XId.is`, OR-44): the SDK throws on an empty id
 * or a `/` as the reference is built and the server refuses a reserved name
 * (`.`, `..`, `__…__`), so an id the door refuses — a blank one too — is
 * never read: it names nothing.
 */
function distinctReadable<T extends string>(
  ids: readonly T[],
  is: (raw: unknown) => raw is T,
): readonly T[] {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i] as T;
    if (is(id) && !out.includes(id)) out.push(id);
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
  const serviceIds = distinctReadable(request.serviceIds, ServiceId.is);
  const barberIds = distinctReadable(request.barberIds, BarberId.is);
  const customerIds = distinctReadable(request.customerIds, CustomerId.is);
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
  const records = distinctReadable(customerIds, CustomerId.is);
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
 * The busy keys a placement touches: each seat's barber (an id
 * `BarberId.parse` takes — never a reserved name, OR-44) on the visit's ONE
 * shop day (T7), distinct, sorted. A seat with no placed start touches no
 * document — the decision refuses it.
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
    const key = BusyKey.of(barber.value, localDate);
    if (!keys.includes(key)) keys.push(key);
  }
  return keys.sort();
}

/**
 * The decision's snapshot over what this attempt read: the shop's week,
 * the BOOKABLE services (`PartyAdmissionSystem.bookableServices` — a
 * retired one is absent, so the decision refuses it as unknown rather than
 * guessing at terms nobody authored), and the schedules, busy days and
 * published exceptions exactly as read (the decision reads the stored
 * slices: no inbound mapping).
 */
export function bookingSnapshotOf(
  set: BookingReadSet,
  placement: PlacementSet,
): BookingSnapshot {
  return {
    shopHours: set.location === null ? [] : set.location.openingHours,
    services: PartyAdmissionSystem.bookableServices(set.services),
    schedules: set.schedules,
    busy: placement.busy,
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
 * A call's starts on the shop's clock (the ingestion boundary, Law 7.3, as
 * `frameWallClock` frames them): the visit's ONE shop day; each start's
 * minute of THAT day — `null` for a start the decision refuses — and the
 * envelope's instant, the earliest start placed on the day.
 */
export type ShopDayFrame = {
  readonly localDate: LocalDate | null;
  readonly startMinutes: readonly (MinuteOfDay | null)[];
  readonly startUtcMs: UtcEpochMs | null;
};

/** A contact phone as the decision validates it — E.164 or local text, no default country (the kernel's rule). */
export function parseContactPhone(raw: string): E164 | null {
  const parsed = PhoneSystem.parse(raw, null);
  return parsed.ok ? parsed.value.e164 : null;
}

/** The location's zone, or `null` when its stored zone is not one the runtime knows. */
export function zoneOf(location: ShopLocation): TimeZone | null {
  const zone = ZonedTimeSystem.checkZone(location.timeZone);
  return zone.ok ? zone.value : null;
}

/**
 * After a landed commit, the facts its decide step could not audit for
 * want of a verified actor (`AuditSystem.commitWrites`' `unaudited`): the
 * act committed without rows (unchanged behaviour — unreachable over the
 * wire, every decoder refuses an anonymous caller first), so each fact is
 * logged loudly, one `LogEvent.AuditActorMissing` error line per fact. The
 * rows themselves are never written here: they are `WriteOp.create`
 * entries of the act's own commit plan (WS-1).
 */
export function logUnaudited(
  ports: LogPorts,
  unaudited: readonly AuditFact[],
): void {
  for (const fact of unaudited) {
    ports.log('error', LogEvent.AuditActorMissing, {
      action: fact.context.auditAction,
      resourceId: fact.resourceId,
    });
  }
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

/** `couponGrants/{id}`. */
export function grantPath(id: CouponGrantId): DocPath {
  return [Collections.CouponGrants, id];
}

/**
 * The coupon grants a bill's GRANT lines name, in ONE `getAll` (each once,
 * absent read too) — what a cancel or a no-show gives back (OR-13), read
 * before any write so the restore settles against the grant this attempt
 * read. A bill with no grant line — nearly every one — reads nothing; an
 * id the brand's door refuses names nothing and is never read.
 */
export async function readDiscountGrants(
  tx: ReadTx,
  discounts: readonly DiscountProvenance[],
): Promise<readonly CouponGrant[]> {
  const named: CouponGrantId[] = [];
  for (const discount of discounts) {
    const grantId = DiscountProvenance.grantIdOf(discount);
    if (grantId !== null) named.push(grantId);
  }
  const ids = distinctReadable(named, CouponGrantId.is);
  if (ids.length === 0) return [];
  const docs = await tx.getAll<CouponGrant>(ids.map(grantPath));
  const found: CouponGrant[] = [];
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
 * What a visit whose move releases its holdings
 * (`BillingSystem.releasesHoldings` — it ends cancelled or no-show, OR-13,
 * DEP-F10b) gives back to the gift vouchers it drew on (2026-09-10), in the
 * SAME plan: `VoucherSystem.restorePlan` — each live line reversed at
 * `nowUtcMs`, each voucher's balance restored — folded into the
 * appointment's own write (its `voucherRedemptions`) beside one balance
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
 * What the same release gives back of the coupon grants the bill honoured
 * (OR-13, DEP-F10b), in the SAME plan: `CouponGrantSystem.releasePlan` —
 * every grant line dropped from the appointment's root `discounts`, folded
 * into its own write, and each grant they named restored against the
 * `grants` this attempt read (one the restore refuses, or one not read, is
 * skipped: the move still lands). A reopen re-burns nothing — the barber
 * re-adds the reward. `appointmentWrites` unchanged when the bill names no
 * grant (nearly always).
 */
export function grantReleaseWrites<D extends DiscountProvenance>(
  appointmentWrites: readonly WriteOp[],
  discounts: readonly D[],
  grants: readonly CouponGrant[],
): readonly WriteOp[] {
  const plan = CouponGrantSystem.releasePlan(discounts, grants);
  if (plan.discounts === discounts) return appointmentWrites;
  const writes: WriteOp[] = [];
  for (let i = 0; i < appointmentWrites.length; i++) {
    const op = appointmentWrites[i] as WriteOp;
    writes.push(
      i === 0 ? withMoreFields(op, { discounts: plan.discounts }) : op,
    );
  }
  writes.push(...plan.writes);
  return writes;
}

/**
 * The root fields a placing write sets — the geometry, the query mirrors
 * (`AppointmentIndexSystem.withQueryKeys`), the edit ledger and the writing
 * call's `writeOperationId` (WS-4.3): what a move or a staff edit changes
 * about a visit that stays the same document.
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
    writeOperationId: after.writeOperationId,
  };
}
