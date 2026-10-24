import {
  type Actor,
  AuditContext,
  type BookingPolicy,
  CustomerOrigin,
  DiscountSource,
  PlacementPolicy,
  type Seat,
  StoodSeatPairs,
  SubjectRelationship,
  SeatSubject,
  VoucherCode,
  VoucherRedemption,
  WriteOp,
  EditCommand,
  RequestedSubjectRole,
  ResizeEdge,
  type BookingCall,
} from '@core/components';
import {
  Result,
  type AppointmentId,
  AuditResourceId,
  type BarberId,
  type CouponGrantId,
  type CouponId,
  defect,
  type LocationId,
  MinuteDelta,
  type OperationId,
  type SeatId,
  type ServiceId,
  type TimeZone,
  type UserId,
  type LocalDate,
  MinuteOfDay,
  UtcEpochMs,
} from '@core/primitives';
import {
  BookingError,
  BookingErrorCode,
  type RepositoryError,
  ShopUnavailableReason,
  type TimeError,
  StaffEditError,
  type StaffEditBeforeArrival,
  type StaffEditForbidden,
  type StaffEditInvalidCommand,
  type StaffEditStale,
  type StaffEditOverlaps,
} from '@core/errors';
import {
  type AccountContact,
  type Appointment,
  Collections,
  type Coupon,
  type CouponGrant,
  type GiftVoucher,
  QueryOp,
} from '@core/entities';
import type {
  AccountContactPorts,
  AuditAppendPorts,
  CouponLookupPorts,
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
  BillingSystem,
  BillPending,
  BookingDecisionSystem,
  CouponGrantSystem,
  CustomerRecordSystem,
  type DecideBookingInput,
  type DecisionStandingSeat,
  DiscountSystem,
  type EditCommandRequest,
  type EditDraft,
  LedgerVerdict,
  MoveSystem,
  type ResolvedCode,
  type ResolvedGrant,
  type SeatedSpan,
  SeatingRuleSystem,
  VoucherSystem,
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
  readRedemptionVouchers,
  zoneOf,
} from './booking-read-set.pipeline';
import { frameWallClock } from './book-appointment.pipeline';
import {
  customerIdsFor,
  customerIdsOf,
  runWithCustomerRetry,
} from './customer-records.pipeline';

/**
 * `editAppointment` — the SHOP moving its own book (blueprint §4.1, flip 1
 * §3.2). Not the client's reschedule with a role check: the cancellation
 * window, the ownership check, the rostered window and the refusal to touch
 * a party mid-service are all client rules, and none applies here. A batch
 * of commands (a gesture, or a «Запази» of the day, the start, the minutes
 * and any repriced leg) is FOLDED over the stored seats in the caller's
 * order and decided ONCE, so the whole save lands or none of it does.
 *
 * - **Outside, before the transaction:** the policy, and every typed coupon
 *   code through `findCouponByCode` (`code ==`, `couponStatus == ENABLED`) —
 *   a code is a lookup, as today.
 * - **In the transaction, before any write:** the appointment (a re-sent
 *   named intent is ANSWERED, not applied — before the revision check its
 *   own first send moved on); the grants the batch AND the stored bill name
 *   (`tx.get` each), then ONE `getAll` of their coupons (the receipt's label,
 *   the coupon's own combinability; a coupon that is gone labels the promise
 *   by `couponId || grantId`, not exclusive); the vouchers by id (the live
 *   lines), then `giftVouchers where code == normalized limit 1` for each
 *   code the batch names that the id reads did not resolve; the booking
 *   read set of the target shop (its zone is the clock every wire instant,
 *   and every chair of the folded visit, is read on — a gap start is
 *   `DST_GAP_INVALID_TIME`); and the busy days, exceptions and added
 *   accounts' client records of the folded placement in one `getAll`.
 * - **The decision:** `AppointmentEditSystem` folds and guards (a visit
 *   that never happened is history; nothing may end before its arrival);
 *   `BookingDecisionSystem` re-decides under the shop's rules (outside the
 *   roster, any service mix, an overlap only when acknowledged — a
 *   collision is answered as the acknowledgeable `overlaps`), with the
 *   stored ids, terms, outcomes and tips carried back; `BillingSystem`
 *   settles the bill's discounts, then the vouchers against the bill as the
 *   batch leaves it.
 * - **One plan:** the appointment `Update` (the revision stamped, a named
 *   intent recorded, the pairs this save broke remembered for its undo),
 *   the busy `Set`s merged onto what this attempt read, each settled
 *   voucher's balance, and a `customers` `Create` for an added account with
 *   no record. No grant write (F1-2).
 * - **After:** the act's rows (`operation:<operationId>`, else
 *   `revision:<n>`) — a replay appends them again under the same key.
 */

/**
 * The staff edit as the edge decoded it — the call component
 * `BookingCall.StaffEdit` (each command's placement on the shop's wall
 * clock: a `MOVE`'s day and start, a `RESIZE`'s day and the minute its
 * handle lands on, an `ADD_SEAT`'s day and start — the pipeline places them
 * on the target shop's zone, Law 7.3) & the verified roles and actor.
 */
export type EditAppointmentCommand = {
  readonly appointmentId: AppointmentId;
  /** The VERIFIED token's roles — a new manual discount needs one that handles money. */
  readonly actorRoles: readonly string[];
  readonly commands: readonly BookingCall.EditCommand[];
  /** «Запази въпреки застъпването» — the ONLY thing that turns the collision check off. */
  readonly acknowledgedOverlap: boolean;
  /** The revision the intent was drawn on; `null` makes no claim. */
  readonly expectedVersion: number | null;
  /** The client's name for this ONE intent; `null` for an older client. */
  readonly operationId: OperationId | null;
  readonly actor: Actor | null;
};

export type EditAppointmentAnswer = {
  readonly appointmentId: AppointmentId;
  /** What the sheet sends as `expectedVersion` next — on a replay, the original's. */
  readonly revision: number;
  /** The intent had already been applied: nothing written. */
  readonly replayed: boolean;
};

export type EditAppointmentError =
  | StaffEditInvalidCommand
  | StaffEditForbidden
  | StaffEditStale
  | StaffEditBeforeArrival
  | StaffEditOverlaps
  | BookingError
  | TimeError
  | RepositoryError;

export type EditAppointmentPorts = TxPorts &
  PolicyReadPorts &
  CouponLookupPorts &
  AccountContactPorts &
  AuditAppendPorts &
  TelemetryPorts;

type CouponsByCode = ReadonlyMap<VoucherCode, Coupon | null>;

type Operation = { readonly id: OperationId; readonly digest: string };

type Loaded = {
  readonly snapshot: 'LOADED';
  readonly stored: Appointment;
  readonly zone: TimeZone;
  readonly set: BookingReadSet;
  readonly placement: PlacementSet;
  readonly draft: EditDraft;
  /** The folded envelope's instant on the target shop's zone — computed ONCE, by the fold. */
  readonly startUtcMs: UtcEpochMs;
  readonly requests: readonly EditCommandRequest[];
  readonly targetLocationId: LocationId;
  readonly freshSeatIds: readonly SeatId[];
  /** The decision's subject of each fresh `SELF` seat — the owner, whoever the fold placed. */
  readonly freshSubjects: ReadonlyMap<SeatId, BookingCall.SubjectInput>;
  readonly addedAccounts: readonly UserId[];
  readonly grants: readonly CouponGrant[];
  readonly coupons: ReadonlyMap<CouponId, Coupon | null>;
  readonly vouchers: readonly GiftVoucher[];
};

type Snapshot =
  | { readonly snapshot: 'REFUSED'; readonly error: EditAppointmentError }
  | {
      readonly snapshot: 'REPLAY';
      readonly stored: Appointment;
      readonly revision: number;
    }
  | Loaded;

/** How a call ended. */
const EditOutcome = {
  Edited: 'EDITED',
  Replayed: 'REPLAYED',
  /** An added account has no client record and no contact was read for it yet. */
  NeedsContacts: 'NEEDS_CONTACTS',
} as const;
type EditOutcome = (typeof EditOutcome)[keyof typeof EditOutcome];

type Decided = {
  readonly stored: Appointment;
  readonly editOutcome: EditOutcome;
  readonly revision: number;
  readonly needsContacts: readonly UserId[];
  /** The batch as the fold applied it (none on a replay) — what the audit planner reads. */
  readonly requests: readonly EditCommandRequest[];
  readonly writes: readonly WriteOp[];
};

export const editAppointment =
  (ports: EditAppointmentPorts) =>
  async (
    cmd: EditAppointmentCommand,
  ): Promise<Result<EditAppointmentAnswer, EditAppointmentError>> => {
    const policy = await ports.loadPolicy();
    if (!policy.ok) return policy;

    // THE TYPED CODES, outside the transaction — a code is a lookup.
    const couponsByCode = new Map<VoucherCode, Coupon | null>();
    for (const request of AppointmentEditSystem.lastDiscounts(cmd.commands) ??
      []) {
      if (request.discountSource !== DiscountSource.Code) continue;
      if (couponsByCode.has(request.code)) continue;
      const found = await ports.findCouponByCode(request.code);
      if (!found.ok) return found;
      couponsByCode.set(request.code, found.value);
    }
    const operation: Operation | null =
      cmd.operationId === null
        ? null
        : {
            id: cmd.operationId,
            digest: AppointmentEditSystem.digestOf(
              ports.hash(AppointmentEditSystem.digestBasis(cmd.commands)),
            ),
          };
    const nowUtcMs = ports.nowUtcMs();

    const run = (contacts: ReadonlyMap<UserId, AccountContact>) =>
      runWithCustomerRetry(() =>
        ports.commit(
          (tx) => readEdit(tx, cmd, operation, ports.hash),
          (snapshot) =>
            decideEdit(snapshot, {
              cmd,
              operation,
              policy: policy.value,
              couponsByCode,
              contacts,
              nowUtcMs,
              hash: ports.hash,
            }),
        ),
      );
    let committed = await run(new Map());
    if (
      committed.ok &&
      committed.value.editOutcome === EditOutcome.NeedsContacts
    ) {
      // An account the batch adds has no client record: its contact
      // snapshot is read OUTSIDE any transaction, then the edit runs again.
      const contacts = await ports.loadAccountContacts(
        committed.value.needsContacts,
      );
      if (!contacts.ok) return contacts;
      committed = await run(contacts.value);
    }
    if (!committed.ok) return committed;
    const { stored, editOutcome, revision } = committed.value;

    const fact: AuditFact = {
      resourceId: AuditResourceId.forAppointment(stored.id),
      // Everyone the visit had before — plus the owner a batch seats. A
      // replay's stored visit already holds what its first send added.
      subjects: AuditSystem.staffEditSubjects(
        AuditSystem.subjectsOf(stored),
        stored.ownerCustomerId,
        committed.value.requests,
      ),
      changeKey: AuditSystem.changeKey.staffEdit(cmd.operationId, revision),
      context: AuditContext.staffEdit(
        AppointmentEditSystem.auditVerb(cmd.commands),
        revision,
      ),
    };
    await appendAuditFacts(ports, [fact], cmd.actor);
    return Result.ok({
      appointmentId: cmd.appointmentId,
      revision,
      replayed: editOutcome === EditOutcome.Replayed,
    });
  };

/** An instant on the shop's clock. */
function wallOf(at: UtcEpochMs, zone: TimeZone) {
  return ZonedTimeSystem.toLocal(at, zone);
}

/**
 * A wall-clock minute the shop's zone shows — the ingestion boundary's ONE
 * check (Law 7.3, Phase 4a 4A-2 (a)): a time inside the spring-forward gap
 * is refused `DST_GAP_INVALID_TIME`, never shifted; a fall-back repeat
 * reads the earlier offset. An exclusive end of `1440` is the next day's
 * first instant, which every zone shows.
 */
function onTheClock(
  localDate: LocalDate,
  minute: number,
  zone: TimeZone,
): Result<UtcEpochMs | null, TimeError> {
  const start = MinuteOfDay.of(minute);
  return start.ok
    ? ZonedTimeSystem.toUtc(localDate, start.value, zone)
    : Result.ok(null);
}

/**
 * ONE command on the running draft's clock — the fold's resolver
 * (`AppointmentEditSystem.foldCommands`), the boundary's one zone-dependent
 * step (Law 7.3): every wall clock a command names must be one the shop's
 * zone shows, and an added seat's end is placed on the absolute timeline
 * here. The rest is the system's: a resize end measured from the running
 * day (`resizeEndOf`), the added seat's occupant (`addedOccupantOf`). A
 * resize start must stay on the running day (`atMinutes`); an added seat
 * must start on it (`startMinutes`).
 */
function requestOf(
  command: BookingCall.EditCommand,
  day: LocalDate,
  zone: TimeZone,
  owner: UserId | null,
): Result<EditCommandRequest, StaffEditInvalidCommand | TimeError> {
  switch (command.editCommand) {
    case EditCommand.Move: {
      const shown = onTheClock(command.localDate, command.startMinutes, zone);
      return shown.ok ? Result.ok(command) : shown;
    }
    case EditCommand.Resize: {
      const shown = onTheClock(command.localDate, command.atMinutes, zone);
      if (!shown.ok) return shown;
      if (command.resizeEdge === ResizeEdge.End) {
        const end = AppointmentEditSystem.resizeEndOf(
          day,
          command.localDate,
          command.atMinutes,
        );
        if (!end.ok) return end;
        return Result.ok({
          editCommand: EditCommand.Resize,
          resizeEdge: ResizeEdge.End,
          atMinutes: end.value,
          seatIds: command.seatIds,
        });
      }
      if (command.localDate !== day) {
        return Result.err(StaffEditError.invalidCommand('atMinutes'));
      }
      return Result.ok({
        editCommand: EditCommand.Resize,
        resizeEdge: ResizeEdge.Start,
        atMinutes: command.atMinutes,
        seatIds: command.seatIds,
      });
    }
    case EditCommand.AddSeat: {
      if (command.localDate !== day) {
        return Result.err(StaffEditError.invalidCommand('startMinutes'));
      }
      const shown = ZonedTimeSystem.toUtc(
        command.localDate,
        command.startMinutes,
        zone,
      );
      if (!shown.ok) return shown;
      // A DurationMinutes is a positive safe integer, always a MinuteDelta.
      const span = MinuteDelta.of(command.durationMinutes);
      if (!span.ok) return defect('a duration that is no minute delta');
      return Result.ok({
        editCommand: EditCommand.AddSeat,
        seatId: command.seatId,
        serviceId: command.serviceId,
        variantId: command.variantId,
        barberId: command.barberId,
        startMinutes: command.startMinutes,
        durationMinutes: command.durationMinutes,
        // The instant the seat ends, on the absolute timeline (its stamp on a finished visit).
        workedAtUtcMs: UtcEpochMs.plusMinutes(shown.value, span.value),
        ...AppointmentEditSystem.addedOccupantOf(
          command.addedSubject,
          owner,
          command.seatId,
        ),
      });
    }
    case EditCommand.Reprice:
    case EditCommand.Redurate:
    case EditCommand.Restaff:
    case EditCommand.RemoveSeat:
    case EditCommand.Relocate:
      return Result.ok(command);
    case EditCommand.Discounts:
      return Result.ok({ editCommand: EditCommand.Discounts });
    case EditCommand.Vouchers:
      return Result.ok({ editCommand: EditCommand.Vouchers });
  }
}

/** The transaction's read half — see {@link editAppointment}. */
async function readEdit(
  tx: ReadTx,
  cmd: EditAppointmentCommand,
  operation: Operation | null,
  hash: (input: string) => string,
): Promise<Snapshot> {
  const stored = await readAppointment(tx, cmd.appointmentId);
  if (stored === null) {
    return {
      snapshot: 'REFUSED',
      error: BookingError.invalidInput('appointmentId'),
    };
  }
  // A RE-SENT INTENT IS ANSWERED, NOT APPLIED — and before anything else.
  if (operation !== null) {
    const verdict = AppointmentEditSystem.ledgerVerdict(
      stored.appliedOperations,
      operation.id,
      operation.digest,
    );
    if (verdict.ledgerVerdict === LedgerVerdict.Mismatch) {
      return {
        snapshot: 'REFUSED',
        error: StaffEditError.invalidCommand('operationId'),
      };
    }
    if (verdict.ledgerVerdict === LedgerVerdict.Replay) {
      return { snapshot: 'REPLAY', stored, revision: verdict.applied.revision };
    }
  }
  const fresh = AppointmentEditSystem.checkRevision(
    stored,
    cmd.expectedVersion,
  );
  if (!fresh.ok) return { snapshot: 'REFUSED', error: fresh.error };

  // The promises the bill names: the grants of the batch and of the stored
  // discounts, then their coupons in ONE getAll.
  const grantIds: CouponGrantId[] = [];
  for (const request of AppointmentEditSystem.lastDiscounts(cmd.commands) ??
    []) {
    if (
      request.discountSource === DiscountSource.Grant &&
      isReadableId(request.grantId)
    ) {
      if (!grantIds.includes(request.grantId)) grantIds.push(request.grantId);
    }
  }
  for (const discount of stored.discounts) {
    if (discount.discountSource !== DiscountSource.Grant) continue;
    const grantId = discount.discountGrantId;
    if (isReadableId(grantId) && !grantIds.includes(grantId))
      grantIds.push(grantId);
  }
  const grantDocs =
    grantIds.length === 0
      ? []
      : await tx.getAll<CouponGrant>(
          grantIds.map((id) => [Collections.CouponGrants, id]),
        );
  const grants: CouponGrant[] = [];
  for (const grant of grantDocs) if (grant !== null) grants.push(grant);
  const couponIds: CouponId[] = [];
  for (const grant of grants) {
    if (isReadableId(grant.couponId) && !couponIds.includes(grant.couponId)) {
      couponIds.push(grant.couponId);
    }
  }
  const couponDocs =
    couponIds.length === 0
      ? []
      : await tx.getAll<Coupon>(
          couponIds.map((id) => [Collections.Coupons, id]),
        );
  const coupons = new Map<CouponId, Coupon | null>();
  for (let i = 0; i < couponIds.length; i++) {
    coupons.set(couponIds[i] as CouponId, couponDocs[i] ?? null);
  }

  // The vouchers: by id (the live lines), then by code for each code the
  // batch names that the ids did not resolve — every one of them in the
  // conflict set, so two counters drawing on one voucher serialise.
  const vouchers: GiftVoucher[] = [
    ...(await readRedemptionVouchers(tx, stored.voucherRedemptions)),
  ];
  const pending = AppointmentEditSystem.pendingVouchers(cmd.commands);
  const codes =
    pending.billPending === BillPending.Set
      ? pending.codes
      : stored.voucherRedemptions
          .filter(VoucherRedemption.isLive)
          .map((line) => line.code);
  for (const raw of codes) {
    const code = VoucherCode.normalize(raw);
    if (vouchers.some((voucher) => voucher.code === code)) continue;
    const hits = await tx.query<GiftVoucher>({
      collection: [Collections.GiftVouchers],
      where: [{ field: 'code', op: QueryOp.Eq, value: code }],
      orderBy: [],
      limit: 1,
    });
    const hit = hits[0];
    if (hit !== undefined) vouchers.push(hit);
  }
  // The target shop and its clock.
  const targetLocationId =
    AppointmentEditSystem.relocatedTo(cmd.commands) ?? stored.locationId;
  const serviceIds: ServiceId[] = stored.seats.map((seat) => seat.serviceId);
  const barberIds: BarberId[] = stored.seats.map((seat) => seat.barberId);
  for (const command of cmd.commands) {
    if (command.editCommand === EditCommand.AddSeat) {
      serviceIds.push(command.serviceId);
      barberIds.push(command.barberId);
    }
    if (command.editCommand === EditCommand.Restaff)
      barberIds.push(command.barberId);
  }
  const set = isReadableId(targetLocationId)
    ? await readBookingSet(tx, {
        locationId: targetLocationId,
        serviceIds,
        barberIds,
        customerIds: [],
      })
    : null;
  const zone =
    set === null || set.location === null ? null : zoneOf(set.location);
  if (set === null || zone === null) {
    return {
      snapshot: 'REFUSED',
      error: BookingError.shopUnavailable(
        targetLocationId,
        ShopUnavailableReason.NotFound,
      ),
    };
  }
  const addedAccounts = AppointmentEditSystem.addedAccounts(
    cmd.commands,
    stored.ownerUserId,
  );
  const customerIds = customerIdsFor(addedAccounts, hash);
  // THE BATCH FOLDED over the stored seats in the caller's order, each
  // command resolved on the clock of the draft the one before it left.
  const folded = AppointmentEditSystem.foldCommands(
    stored,
    cmd.commands,
    customerIds,
    (command, day) => requestOf(command, day, zone, stored.ownerUserId),
  );
  if (!folded.ok) return { snapshot: 'REFUSED', error: folded.error };
  // Then EVERY CHAIR OF THE FOLDED VISIT is read on the target shop's zone,
  // as the booking's frame reads a new party (Law 7.3): a relocated visit
  // lands on another zone's clock, and a seat no command named moves too —
  // the rest of a party shifted as one, the seat that becomes the
  // envelope's start once the first is removed. A start the zone never
  // shows is refused `DST_GAP_INVALID_TIME`, never shifted and never
  // answered with the stored instant; the envelope's instant is computed
  // here, ONCE.
  const draft: EditDraft = {
    localDate: folded.value.localDate,
    seats: folded.value.seats,
  };
  const framed = frameWallClock(
    draft.localDate,
    draft.seats.map((seat) => seat.startMinutes),
    zone,
  );
  if (!framed.ok) return { snapshot: 'REFUSED', error: framed.error };
  const startUtcMs = framed.value.startUtcMs;
  if (startUtcMs === null) {
    return {
      snapshot: 'REFUSED',
      error: StaffEditError.invalidCommand('seats'),
    };
  }
  const freshSubjects = new Map<SeatId, BookingCall.SubjectInput>();
  for (const command of cmd.commands) {
    if (
      command.editCommand === EditCommand.AddSeat &&
      command.addedSubject.requestedSubjectRole === RequestedSubjectRole.Self
    ) {
      freshSubjects.set(command.seatId, {
        requestedSubjectRole: RequestedSubjectRole.Self,
      });
    }
  }
  const placement = await readPlacementSet(
    tx,
    placementKeysOf(draft.seats, draft.localDate),
    customerIdsOf(customerIds),
  );
  return {
    snapshot: 'LOADED',
    stored,
    zone,
    set,
    placement,
    draft,
    startUtcMs,
    requests: folded.value.requests,
    targetLocationId,
    freshSeatIds: folded.value.freshSeatIds,
    freshSubjects,
    addedAccounts,
    grants,
    coupons,
    vouchers,
  };
}

/** A stored seat's person as the decision's request — a `CLIENT` account cannot be re-decided. */
function subjectOfSeat(seat: Seat): BookingCall.SubjectInput | null {
  if (seat.seatSubject === SeatSubject.Anonymous) {
    return {
      requestedSubjectRole: RequestedSubjectRole.Guest,
      label: seat.guestLabel,
      guestKey: null,
    };
  }
  switch (seat.subjectRelationship) {
    case SubjectRelationship.Self:
      return { requestedSubjectRole: RequestedSubjectRole.Self };
    case SubjectRelationship.Companion:
      return {
        requestedSubjectRole: RequestedSubjectRole.Companion,
        companionUserId: seat.subjectUserId,
      };
    default:
      return null;
  }
}

type DecideContext = {
  readonly cmd: EditAppointmentCommand;
  readonly operation: Operation | null;
  readonly policy: BookingPolicy;
  readonly couponsByCode: CouponsByCode;
  readonly contacts: ReadonlyMap<UserId, AccountContact>;
  readonly nowUtcMs: UtcEpochMs;
  readonly hash: (input: string) => string;
};

/** The pure half — the decision and its one write plan. */
function decideEdit(
  snapshot: Snapshot,
  context: DecideContext,
): Result<Decided, EditAppointmentError> {
  if (snapshot.snapshot === 'REFUSED') return Result.err(snapshot.error);
  if (snapshot.snapshot === 'REPLAY') {
    return Result.ok({
      stored: snapshot.stored,
      editOutcome: EditOutcome.Replayed,
      revision: snapshot.revision,
      needsContacts: [],
      requests: [],
      writes: [],
    });
  }
  const loaded = snapshot;
  const { stored, draft, zone } = loaded;
  const cmd = context.cmd;
  const nowUtcMs = context.nowUtcMs;
  const first = stored.seats[0] as Seat;

  // 1. The bill's discounts after the batch (refused before the placement):
  //    each grant as its coupon labels it, each typed code as its coupon.
  const resolvedGrants: ResolvedGrant[] = [];
  for (const grant of loaded.grants) {
    resolvedGrants.push(
      CouponGrantSystem.resolved(
        grant,
        loaded.coupons.get(grant.couponId) ?? null,
        nowUtcMs,
      ),
    );
  }
  const resolvedCodes: ResolvedCode[] = [];
  for (const [code, coupon] of context.couponsByCode) {
    if (coupon !== null)
      resolvedCodes.push(DiscountSystem.resolvedCode(coupon, code));
  }
  const settledDiscounts = BillingSystem.settleDiscounts(
    BillingSystem.pendingDiscounts(
      AppointmentEditSystem.lastDiscounts(cmd.commands),
      resolvedGrants,
      resolvedCodes,
      first.currency,
    ),
    stored.discounts,
    stored.ownerCustomerId,
    cmd.actorRoles,
    first.currency,
    nowUtcMs,
  );
  if (!settledDiscounts.ok) return settledDiscounts;
  const discounts = settledDiscounts.value;

  // 2. May the folded visit be written at all?
  const refusal = AppointmentEditSystem.guard(
    stored.bookingStatus,
    draft.localDate,
    draft.seats,
    stored.arrivedAtUtcMs === null ? null : wallOf(stored.arrivedAtUtcMs, zone),
  );
  if (refusal !== null) return Result.err(refusal);

  // 3. A fresh seat must name a chair this shop rosters.
  if (
    !AppointmentEditSystem.freshSeatsRostered(
      draft.seats,
      loaded.freshSeatIds,
      loaded.set.schedules,
    )
  ) {
    return Result.err(StaffEditError.invalidCommand('barberId'));
  }

  // 4. The decision, under the shop's rules, with the stored ids and terms.
  const lines: BookingCall.SeatInput[] = [];
  for (const seat of draft.seats) {
    const subject =
      loaded.freshSubjects.get(seat.seatId) ?? subjectOfSeat(seat);
    if (subject === null) return Result.err(BookingError.invalidInput('seats'));
    lines.push({
      lineId: seat.seatId,
      serviceId: seat.serviceId,
      variantId: seat.variantId,
      barberId: seat.barberId,
      barberPreference: seat.barberPreference,
      startMinutes: seat.startMinutes,
      subject,
    });
  }
  const standing: DecisionStandingSeat[] = [];
  const before: SeatedSpan[] = [];
  for (const seat of stored.seats) {
    const subject = subjectOfSeat(seat);
    if (subject === null) return Result.err(BookingError.invalidInput('seats'));
    standing.push({
      seatId: seat.seatId,
      subject,
      startMinutes: seat.startMinutes,
      durationMinutes: seat.durationMinutes,
    });
    before.push(SeatingRuleSystem.spanOf(seat, subject));
  }
  const ids = draft.seats.map((seat) => seat.seatId);
  let cursor = 0;
  const owner = stored.ownerUserId;
  const input: DecideBookingInput = {
    locationId: loaded.targetLocationId,
    localDate: draft.localDate,
    seats: lines,
    attemptId: stored.id,
    bookedFromAppointmentId: null,
    contact: null,
    placement: stored.placement,
  };
  const decided = BookingDecisionSystem.decide(
    input,
    bookingSnapshotOf(loaded.set, loaded.placement),
    context.policy,
    PlacementPolicy.withOverlap(
      PlacementPolicy.staffPlacement(),
      cmd.acknowledgedOverlap,
    ),
    MoveSystem.release(stored),
    {
      now: ZonedTimeSystem.shopNow(nowUtcMs, zone),
      startUtcMs: loaded.startUtcMs,
      nextId: () => ids[cursor++] ?? '',
      ownerUserId: owner,
      customerIds: customerIdsFor(
        BookingDecisionSystem.accountSubjects(lines, owner),
        context.hash,
      ),
      // A move is not a re-sale: every stored seat's terms ride forward; a
      // fresh seat is priced by the catalogue.
      termsOverrides: AppointmentEditSystem.termsOverridesOf(
        draft.seats,
        loaded.freshSeatIds,
      ),
      standing,
      stood: StoodSeatPairs.liveAt(stored, stored.revision),
      parsePhone: parseContactPhone,
    },
  );
  if (!decided.ok) {
    if (decided.error.errorCode !== BookingErrorCode.SlotUnavailable)
      return decided;
    // With the window off for staff, `slot_unavailable` can mean nothing but
    // a collision — the acknowledgeable overlap.
    return Result.err(
      AppointmentEditSystem.overlapOf(decided.error, cmd.commands),
    );
  }

  // 5. The decided seats with the stored outcomes and tips carried back.
  const seats = AppointmentEditSystem.carryBack(
    decided.value.appointment.seats,
    draft.seats,
  );

  // 6. The vouchers, settled LAST against the bill as the batch leaves it.
  const subtotal = BillingSystem.subtotalOf(seats);
  if (!subtotal.ok) return Result.err(StaffEditError.invalidCommand('seats'));
  const paid = BillingSystem.settleVouchers(
    AppointmentEditSystem.pendingVouchers(cmd.commands),
    stored.voucherRedemptions,
    BillingSystem.totalOf(subtotal.value, discounts),
    loaded.vouchers,
    nowUtcMs,
  );
  if (!paid.ok) return paid;

  // 7. The client records of added accounts: a missing one needs its
  //    contact snapshot first (read outside, then the edit runs again).
  const added = customerIdsFor(loaded.addedAccounts, context.hash);
  const missing = CustomerRecordSystem.missingContacts(
    added,
    loaded.placement.customers,
    context.contacts,
  );
  if (missing.length > 0) {
    return Result.ok({
      stored,
      editOutcome: EditOutcome.NeedsContacts,
      revision: stored.revision,
      needsContacts: missing,
      requests: loaded.requests,
      writes: [],
    });
  }

  const revision = stored.revision + 1;
  const after = AppointmentIndexSystem.withQueryKeys({
    ...stored,
    locationId: loaded.targetLocationId,
    localDate: draft.localDate,
    // The envelope's instant, read ONCE by the fold on the target shop's zone.
    utcEpochMs: loaded.startUtcMs,
    seats,
    discounts,
    voucherRedemptions: paid.value.voucherRedemptions,
    revision,
    appliedOperations:
      context.operation === null
        ? stored.appliedOperations
        : AppointmentEditSystem.record(
            stored.appliedOperations,
            context.operation.id,
            revision,
            context.operation.digest,
          ),
    // THE PAIRS THIS SAVE BROKE, remembered for its undo under the revision
    // it stamps (none: whatever an older save remembered is dropped).
    ...StoodSeatPairs.remember(
      revision,
      SeatingRuleSystem.brokenBy(
        SeatingRuleSystem.standingOf(before),
        SeatingRuleSystem.standingOf(
          draft.seats.flatMap((seat) => {
            const subject =
              loaded.freshSubjects.get(seat.seatId) ?? subjectOfSeat(seat);
            return subject === null
              ? []
              : [SeatingRuleSystem.spanOf(seat, subject)];
          }),
        ),
      ),
    ),
  });
  const voucherWrites: WriteOp[] = [];
  for (const settled of paid.value.touched) {
    const was = loaded.vouchers.find((voucher) => voucher.id === settled.id);
    if (was !== undefined)
      voucherWrites.push(VoucherSystem.transitionWrite(was, settled));
  }
  return Result.ok({
    stored,
    editOutcome: EditOutcome.Edited,
    revision,
    needsContacts: [],
    requests: loaded.requests,
    writes: [
      WriteOp.update(appointmentPath(stored.id), {
        ...placementFields(after),
        discounts: after.discounts,
        voucherRedemptions: after.voucherRedemptions,
        stoodSeatPairsRevision: after.stoodSeatPairsRevision,
        stoodSeatPairs: after.stoodSeatPairs,
      }),
      ...busyMergeWrites(loaded.placement, decided.value.busyWrites, zone),
      ...voucherWrites,
      ...CustomerRecordSystem.createsFor(
        added,
        loaded.placement.customers,
        context.contacts,
        CustomerOrigin.FirstBooking,
        nowUtcMs,
      ),
    ],
  });
}
