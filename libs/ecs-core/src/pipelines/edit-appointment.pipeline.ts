import {
  type AccountOccupant,
  type Actor,
  AuditAction,
  AuditContext,
  type BookingPolicy,
  Combinability,
  CouponValue,
  DiscountMethod,
  DiscountSource,
  type PlacementPolicy,
  Seat,
  SeatLabel,
  SeatOccupant,
  SeatSubject,
  StaffTermsOverride,
  type StaffEditAction,
  StoodSeatPairs,
  SubjectRelationship,
  VoucherCode,
  WriteOp,
} from '@core/components';
import {
  BookingError,
  BookingErrorCode,
  type RepositoryError,
  Result,
  ShopUnavailableReason,
  type AppointmentId,
  AuditResourceId,
  type BarberId,
  type CouponGrantId,
  type CouponId,
  type CustomerId,
  type DurationMinutes,
  type LocationId,
  OperationId,
  type PriceCents,
  type SeatId,
  SeatKeyText,
  type ServiceId,
  type ServiceVariantId,
  type TimeZone,
  type UserId,
  EndMinute,
  LocalDate,
  type MinuteOfDay,
  UtcEpochMs,
} from '@core/primitives';
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
  type DecideBookingInput,
  type DecisionStandingSeat,
  EditCommand,
  type EditCommandRequest,
  type EditDraft,
  GuestLabelSystem,
  LedgerVerdict,
  MoveSystem,
  type PendingDiscount,
  type PendingDiscounts,
  type PendingVouchers,
  type RequestedSeatInput,
  type RequestedSubjectInput,
  RequestedSubjectRole,
  ResizeEdge,
  type ResolvedCode,
  type ResolvedGrant,
  type SeatedSpan,
  SeatingRuleSystem,
  StaffEditError,
  StaffEditErrorCode,
  type StaffEditBeforeArrival,
  type StaffEditForbidden,
  type StaffEditInvalidCommand,
  type StaffEditStale,
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
  voucherPath,
  zoneOf,
} from './booking-read-set.pipeline';
import {
  customerCreates,
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
 *   read set of the target shop (its zone is the clock every wire instant
 *   is read on); and the busy days, exceptions and added accounts' client
 *   records of the folded placement in one `getAll`.
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

/** A requested discount as the batch names it. */
export type StaffDiscountRequest =
  | {
      readonly discountSource: typeof DiscountSource.Grant;
      readonly grantId: CouponGrantId;
    }
  | {
      readonly discountSource: typeof DiscountSource.Code;
      /** Normalised (trimmed, upper-case). */
      readonly code: VoucherCode;
    }
  | {
      readonly discountSource: typeof DiscountSource.Manual;
      readonly discountMethod: typeof DiscountMethod.PercentOff;
      readonly discountPercent: number;
    }
  | {
      readonly discountSource: typeof DiscountSource.Manual;
      readonly discountMethod: typeof DiscountMethod.FixedAmount;
      readonly discountAmountCents: PriceCents;
    };

/** Who an added seat is for: the visit's owner, or a guest by label. */
export type AddedSeatSubject =
  | { readonly requestedSubjectRole: typeof RequestedSubjectRole.Self }
  | {
      readonly requestedSubjectRole: typeof RequestedSubjectRole.Guest;
      readonly label: SeatLabel;
    };

/**
 * One staff command as the edge decoded it — its times INSTANTS (the
 * pipeline reads them on the shop's clock, Law 7.3), every field present.
 */
export type EditCommandInput =
  | {
      readonly editCommand: typeof EditCommand.Move;
      readonly startUtcMs: UtcEpochMs;
      readonly seatIds: readonly SeatId[] | null;
    }
  | {
      readonly editCommand: typeof EditCommand.Resize;
      readonly resizeEdge: ResizeEdge;
      /** Already rounded to the whole minute (the legacy fold's reading). */
      readonly atUtcMs: UtcEpochMs;
      readonly seatIds: readonly SeatId[] | null;
    }
  | {
      readonly editCommand: typeof EditCommand.Reprice;
      readonly seatId: SeatId;
      readonly priceCents: PriceCents;
    }
  | {
      readonly editCommand: typeof EditCommand.Redurate;
      readonly seatId: SeatId;
      readonly durationMinutes: DurationMinutes;
    }
  | {
      readonly editCommand: typeof EditCommand.Restaff;
      readonly seatId: SeatId;
      readonly barberId: BarberId;
    }
  | {
      readonly editCommand: typeof EditCommand.AddSeat;
      readonly seatId: SeatId;
      readonly serviceId: ServiceId;
      readonly variantId: ServiceVariantId | null;
      readonly barberId: BarberId;
      readonly startUtcMs: UtcEpochMs;
      readonly durationMinutes: DurationMinutes;
      readonly addedSubject: AddedSeatSubject;
    }
  | {
      readonly editCommand: typeof EditCommand.RemoveSeat;
      readonly seatId: SeatId;
    }
  | {
      readonly editCommand: typeof EditCommand.Relocate;
      readonly locationId: LocationId;
    }
  | {
      readonly editCommand: typeof EditCommand.Discounts;
      readonly discounts: readonly StaffDiscountRequest[];
    }
  | {
      readonly editCommand: typeof EditCommand.Vouchers;
      /** Normalised, distinct. */
      readonly codes: readonly VoucherCode[];
    };

export type EditAppointmentCommand = {
  readonly appointmentId: AppointmentId;
  /** The VERIFIED token's roles — a new manual discount needs one that handles money. */
  readonly actorRoles: readonly string[];
  readonly commands: readonly EditCommandInput[];
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

/** A collision the shop may acknowledge — the edge it names is the lone resize's handle. */
export type StaffEditOverlaps = {
  readonly errorCode: typeof StaffEditErrorCode.Overlaps;
  readonly barberId: BarberId;
  readonly localDate: LocalDate;
  readonly startMinutes: MinuteOfDay;
  readonly edge: ResizeEdge | null;
};

export type EditAppointmentError =
  | StaffEditInvalidCommand
  | StaffEditForbidden
  | StaffEditStale
  | StaffEditBeforeArrival
  | StaffEditOverlaps
  | BookingError
  | RepositoryError;

export type EditAppointmentPorts = TxPorts &
  PolicyReadPorts &
  CouponLookupPorts &
  AccountContactPorts &
  AuditAppendPorts &
  TelemetryPorts;

/** The staff verb each lone command is audited under. */
const STAFF_VERB: { readonly [C in EditCommand]: StaffEditAction } = {
  [EditCommand.Move]: AuditAction.BookingStaffMove,
  [EditCommand.Resize]: AuditAction.BookingStaffResize,
  [EditCommand.Reprice]: AuditAction.BookingStaffReprice,
  [EditCommand.Redurate]: AuditAction.BookingStaffRedurate,
  [EditCommand.Restaff]: AuditAction.BookingStaffRestaff,
  [EditCommand.AddSeat]: AuditAction.BookingStaffAddSeat,
  [EditCommand.RemoveSeat]: AuditAction.BookingStaffRemoveSeat,
  [EditCommand.Relocate]: AuditAction.BookingStaffRelocate,
  [EditCommand.Discounts]: AuditAction.BookingStaffDiscounts,
  [EditCommand.Vouchers]: AuditAction.BookingStaffVouchers,
};

/** A batch's verb: its lone command's, or a save. */
function verbOf(commands: readonly EditCommandInput[]): StaffEditAction {
  const only = commands.length === 1 ? commands[0] : undefined;
  return only === undefined
    ? AuditAction.BookingStaffSave
    : STAFF_VERB[only.editCommand];
}

/** The batch's LAST word on the discounts, or `null` when it said nothing (keep). */
function lastDiscounts(
  commands: readonly EditCommandInput[],
): readonly StaffDiscountRequest[] | null {
  let last: readonly StaffDiscountRequest[] | null = null;
  for (const command of commands) {
    if (command.editCommand === EditCommand.Discounts) last = command.discounts;
  }
  return last;
}

/** The batch's last word on the vouchers. */
function pendingVouchersOf(
  commands: readonly EditCommandInput[],
): PendingVouchers {
  let codes: readonly VoucherCode[] | null = null;
  for (const command of commands) {
    if (command.editCommand === EditCommand.Vouchers) codes = command.codes;
  }
  return codes === null
    ? { billPending: BillPending.Keep }
    : { billPending: BillPending.Set, codes };
}

/** The shop the batch moves the visit to — the last `RELOCATE` — or `null`. */
function relocatedTo(commands: readonly EditCommandInput[]): LocationId | null {
  let target: LocationId | null = null;
  for (const command of commands) {
    if (command.editCommand === EditCommand.Relocate)
      target = command.locationId;
  }
  return target;
}

type CouponsByCode = ReadonlyMap<VoucherCode, Coupon | null>;

type Operation = { readonly id: OperationId; readonly digest: string };

type Loaded = {
  readonly snapshot: 'LOADED';
  readonly stored: Appointment;
  readonly zone: TimeZone;
  readonly set: BookingReadSet;
  readonly placement: PlacementSet;
  readonly draft: EditDraft;
  readonly requests: readonly EditCommandRequest[];
  readonly targetLocationId: LocationId;
  readonly freshSeatIds: readonly SeatId[];
  /** The decision's subject of each fresh `SELF` seat — the owner, whoever the fold placed. */
  readonly freshSubjects: ReadonlyMap<SeatId, RequestedSubjectInput>;
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
    for (const request of lastDiscounts(cmd.commands) ?? []) {
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
            digest: ports
              .hash(AppointmentEditSystem.digestBasis(cmd.commands))
              .slice(0, 16),
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
      context: AuditContext.staffEdit(verbOf(cmd.commands), revision),
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
 * ONE command on the running draft's clock (the boundary's reading, Law
 * 7.3): a move names the day it lands on; a resize start must stay on the
 * running day, a resize end may be its closing midnight (an end at or
 * before the day's start drives the duration to nothing: `minutes`; past
 * the midnight it leaves the day: `atUtcMs`); an added seat must start on the
 * running day.
 */
function requestOf(
  command: EditCommandInput,
  day: LocalDate,
  zone: TimeZone,
  owner: UserId | null,
): Result<EditCommandRequest, StaffEditInvalidCommand> {
  switch (command.editCommand) {
    case EditCommand.Move: {
      const wall = wallOf(command.startUtcMs, zone);
      return Result.ok({
        editCommand: EditCommand.Move,
        localDate: wall.localDate,
        startMinutes: wall.minute,
        seatIds: command.seatIds,
      });
    }
    case EditCommand.Resize: {
      const wall = wallOf(command.atUtcMs, zone);
      if (command.resizeEdge === ResizeEdge.End) {
        const minutes =
          LocalDate.daysBetween(day, wall.localDate) * 1440 + wall.minute;
        if (minutes <= 0)
          return Result.err(StaffEditError.invalidCommand('minutes'));
        const end = EndMinute.of(minutes);
        if (!end.ok)
          return Result.err(StaffEditError.invalidCommand('atUtcMs'));
        return Result.ok({
          editCommand: EditCommand.Resize,
          resizeEdge: ResizeEdge.End,
          atMinutes: end.value,
          seatIds: command.seatIds,
        });
      }
      if (wall.localDate !== day) {
        return Result.err(StaffEditError.invalidCommand('atUtcMs'));
      }
      return Result.ok({
        editCommand: EditCommand.Resize,
        resizeEdge: ResizeEdge.Start,
        atMinutes: wall.minute,
        seatIds: command.seatIds,
      });
    }
    case EditCommand.AddSeat: {
      const wall = wallOf(command.startUtcMs, zone);
      if (wall.localDate !== day) {
        return Result.err(StaffEditError.invalidCommand('startUtcMs'));
      }
      const occupant: AccountOccupant =
        command.addedSubject.requestedSubjectRole ===
          RequestedSubjectRole.Self && owner !== null
          ? {
              seatSubject: SeatSubject.Account,
              subjectUserId: owner,
              subjectRelationship: SubjectRelationship.Self,
            }
          : SeatOccupant.anonymous(
              command.addedSubject.requestedSubjectRole ===
                RequestedSubjectRole.Guest
                ? command.addedSubject.label
                : SeatLabel.of(command.seatId),
            );
      return Result.ok({
        editCommand: EditCommand.AddSeat,
        seatId: command.seatId,
        serviceId: command.serviceId,
        variantId: command.variantId,
        barberId: command.barberId,
        startMinutes: wall.minute,
        durationMinutes: command.durationMinutes,
        // The instant the seat ends, on the absolute timeline (its stamp on a finished visit).
        workedAtUtcMs: UtcEpochMs.plusMs(
          command.startUtcMs,
          command.durationMinutes * 60_000,
        ),
        ...occupant,
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

/**
 * The batch FOLDED over the stored seats in the caller's order, each
 * command read on the clock of the draft the one before it left
 * (`AppointmentEditSystem.applyCommand`, the system's own step): a save
 * that moves the day and then stretches the block resizes the MOVED seats.
 */
function foldOnClock(
  stored: Appointment,
  commands: readonly EditCommandInput[],
  zone: TimeZone,
  customerIds: ReadonlyMap<UserId, CustomerId>,
): Result<
  {
    readonly draft: EditDraft;
    readonly fresh: readonly SeatId[];
    readonly requests: readonly EditCommandRequest[];
  },
  StaffEditInvalidCommand
> {
  if (commands.length === 0)
    return Result.err(StaffEditError.invalidCommand('command'));
  if (stored.seats.length === 0)
    return Result.err(StaffEditError.invalidCommand('seats'));
  const context = AppointmentEditSystem.foldContextOf(stored, customerIds);
  let draft: EditDraft = { localDate: stored.localDate, seats: stored.seats };
  const requests: EditCommandRequest[] = [];
  for (const command of commands) {
    const request = requestOf(
      command,
      draft.localDate,
      zone,
      stored.ownerUserId,
    );
    if (!request.ok) return request;
    requests.push(request.value);
    // The place is settled outside the fold — the seats do not change under it.
    if (command.editCommand === EditCommand.Relocate) continue;
    const applied = AppointmentEditSystem.applyCommand(
      draft,
      request.value,
      context,
    );
    if (!applied.ok) return applied;
    draft = applied.value;
  }
  const fresh: SeatId[] = [];
  for (const seat of draft.seats) {
    if (!context.held.includes(seat.seatId)) fresh.push(seat.seatId);
  }
  return Result.ok({ draft, fresh, requests });
}

/** The accounts the batch adds — an added `SELF` seat names the owner (nobody else can join through an edit). */
function addedAccountsOf(
  commands: readonly EditCommandInput[],
  owner: UserId | null,
): readonly UserId[] {
  if (owner === null) return [];
  for (const command of commands) {
    if (
      command.editCommand === EditCommand.AddSeat &&
      command.addedSubject.requestedSubjectRole === RequestedSubjectRole.Self
    ) {
      return [owner];
    }
  }
  return [];
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
  for (const request of lastDiscounts(cmd.commands) ?? []) {
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
  const vouchers: GiftVoucher[] = [];
  const liveIds: GiftVoucher['id'][] = [];
  for (const line of stored.voucherRedemptions) {
    if (line.reversedAtUtcMs === null && !liveIds.includes(line.voucherId)) {
      liveIds.push(line.voucherId);
    }
  }
  if (liveIds.length > 0) {
    const byId = await tx.getAll<GiftVoucher>(liveIds.map(voucherPath));
    for (const voucher of byId) if (voucher !== null) vouchers.push(voucher);
  }
  const pending = pendingVouchersOf(cmd.commands);
  const codes =
    pending.billPending === BillPending.Set
      ? pending.codes
      : stored.voucherRedemptions
          .filter((line) => line.reversedAtUtcMs === null)
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
  const targetLocationId = relocatedTo(cmd.commands) ?? stored.locationId;
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
  const addedAccounts = addedAccountsOf(cmd.commands, stored.ownerUserId);
  const customerIds = customerIdsFor(addedAccounts, hash);
  const folded = foldOnClock(stored, cmd.commands, zone, customerIds);
  if (!folded.ok) return { snapshot: 'REFUSED', error: folded.error };
  const freshSubjects = new Map<SeatId, RequestedSubjectInput>();
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
    placementKeysOf(folded.value.draft.seats, folded.value.draft.localDate),
    customerIdsOf(customerIds),
  );
  return {
    snapshot: 'LOADED',
    stored,
    zone,
    set,
    placement,
    draft: folded.value.draft,
    requests: folded.value.requests,
    targetLocationId,
    freshSeatIds: folded.value.fresh,
    freshSubjects,
    addedAccounts,
    grants,
    coupons,
    vouchers,
  };
}

/** A stored seat's person as the decision's request — a `CLIENT` account cannot be re-decided. */
function subjectOfSeat(seat: Seat): RequestedSubjectInput | null {
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

/** A seat as the "one person, one chair" rule counts it. */
function spanOf(seat: Seat, subject: RequestedSubjectInput): SeatedSpan {
  return {
    seatId: seat.seatId,
    personKey: GuestLabelSystem.personKeyOf(subject),
    startMinutes: seat.startMinutes,
    endMinutes: EndMinute.ofProven(seat.startMinutes + seat.durationMinutes),
  };
}

/** A grant as the bill's settle reads it — its coupon's label and combinability. */
function resolvedGrantOf(
  grant: CouponGrant,
  coupon: Coupon | null,
  nowUtcMs: UtcEpochMs,
): ResolvedGrant {
  return {
    grantId: grant.id,
    customerId: grant.customerId,
    // The coupon's NAME is the receipt's word; a grant whose coupon is gone
    // is labelled by itself and read as stackable — the promise stands.
    label:
      coupon !== null && coupon.name.trim().length > 0
        ? coupon.name
        : grant.couponId || grant.id,
    usable: CouponGrantSystem.isUsable(grant, nowUtcMs),
    exclusive:
      coupon === null ? false : Combinability.isExclusive(coupon.combinability),
    ...CouponValue.of(grant),
  };
}

/** A coupon a typed code opened, as the settle reads it. */
function resolvedCodeOf(coupon: Coupon, code: VoucherCode): ResolvedCode {
  return {
    couponId: coupon.id,
    label: coupon.name,
    code,
    exclusive: Combinability.isExclusive(coupon.combinability),
    ...CouponValue.of(coupon),
  };
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

  // 1. The bill's discounts after the batch (refused before the placement).
  const requests = lastDiscounts(cmd.commands);
  let discounts = stored.discounts;
  if (requests !== null) {
    const items: PendingDiscount[] = [];
    for (const request of requests) {
      switch (request.discountSource) {
        case DiscountSource.Grant: {
          const grant =
            loaded.grants.find((each) => each.id === request.grantId) ?? null;
          items.push({
            discountSource: DiscountSource.Grant,
            grantId: request.grantId,
            resolved:
              grant === null
                ? null
                : resolvedGrantOf(
                    grant,
                    loaded.coupons.get(grant.couponId) ?? null,
                    nowUtcMs,
                  ),
          });
          break;
        }
        case DiscountSource.Code: {
          const coupon = context.couponsByCode.get(request.code) ?? null;
          items.push({
            discountSource: DiscountSource.Code,
            code: request.code,
            resolved:
              coupon === null ? null : resolvedCodeOf(coupon, request.code),
          });
          break;
        }
        default:
          items.push({
            discountSource: DiscountSource.Manual,
            value:
              request.discountMethod === DiscountMethod.PercentOff
                ? {
                    discountMethod: DiscountMethod.PercentOff,
                    discountPercent: request.discountPercent,
                  }
                : {
                    discountMethod: DiscountMethod.FixedAmount,
                    discountAmountCents: request.discountAmountCents,
                    discountCurrency: first.currency,
                  },
          });
      }
    }
    const pending: PendingDiscounts = { billPending: BillPending.Set, items };
    const settled = BillingSystem.settleDiscounts(
      pending,
      stored.discounts,
      stored.ownerCustomerId,
      cmd.actorRoles,
      first.currency,
      nowUtcMs,
    );
    if (!settled.ok) return settled;
    discounts = settled.value;
  }

  // 2. May the folded visit be written at all?
  const refusal = AppointmentEditSystem.guard(
    stored.bookingStatus,
    draft.localDate,
    draft.seats.map((seat) => ({
      startMinutes: seat.startMinutes,
      endMinutes: EndMinute.ofProven(seat.startMinutes + seat.durationMinutes),
    })),
    stored.arrivedAtUtcMs === null ? null : wallOf(stored.arrivedAtUtcMs, zone),
  );
  if (refusal !== null) return Result.err(refusal);

  // 3. A fresh seat must name a chair this shop rosters.
  for (const seat of draft.seats) {
    if (!loaded.freshSeatIds.includes(seat.seatId)) continue;
    if (
      !loaded.set.schedules.some((schedule) => schedule.id === seat.barberId)
    ) {
      return Result.err(StaffEditError.invalidCommand('barberId'));
    }
  }

  // 4. The decision, under the shop's rules, with the stored ids and terms.
  const lines: RequestedSeatInput[] = [];
  const overrides: StaffTermsOverride[] = [];
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
    // A move is not a re-sale: every stored seat's terms ride forward; a
    // fresh seat is priced by the catalogue.
    if (!loaded.freshSeatIds.includes(seat.seatId)) {
      overrides.push(StaffTermsOverride.of(SeatKeyText.of(seat.seatId), seat));
    }
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
    before.push(spanOf(seat, subject));
  }
  const ids = draft.seats.map((seat) => seat.seatId);
  let cursor = 0;
  const owner = stored.ownerUserId;
  const placementPolicy: PlacementPolicy = {
    allowOutsideWindow: true,
    skipMinNotice: true,
    allowOverlap: cmd.acknowledgedOverlap,
    allowConflictingServices: true,
  };
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
    placementPolicy,
    MoveSystem.release(stored),
    {
      now: ZonedTimeSystem.shopNow(nowUtcMs, zone),
      startUtcMs: stored.utcEpochMs,
      nextId: () => ids[cursor++] ?? '',
      ownerUserId: owner,
      customerIds: customerIdsFor(
        BookingDecisionSystem.accountSubjects(lines, owner),
        context.hash,
      ),
      termsOverrides: overrides,
      standing,
      stood: StoodSeatPairs.liveAt(stored, stored.revision),
      parsePhone: parseContactPhone,
    },
  );
  if (!decided.ok) {
    if (decided.error.errorCode !== BookingErrorCode.SlotUnavailable)
      return decided;
    // With the window off for staff, `slot_unavailable` can mean nothing but
    // a collision — the acknowledgeable overlap, naming the lone resize's handle.
    const only = cmd.commands.length === 1 ? cmd.commands[0] : undefined;
    return Result.err({
      errorCode: StaffEditErrorCode.Overlaps,
      barberId: decided.error.barberId,
      localDate: decided.error.localDate,
      startMinutes: decided.error.startMinutes,
      edge: only?.editCommand === EditCommand.Resize ? only.resizeEdge : null,
    });
  }

  // 5. The decided seats with the stored outcomes and tips carried back.
  const seats: Seat[] = [];
  const decidedSeats = decided.value.appointment.seats;
  for (let i = 0; i < decidedSeats.length; i++) {
    const seat = decidedSeats[i] as Seat;
    const folded = draft.seats[i];
    // The decision rebuilt this seat from the catalogue, which knows
    // nothing of the guest who was served or of what was left on the counter.
    seats.push(
      folded === undefined
        ? seat
        : Seat.withTip(Seat.withOutcome(seat, folded), folded.tipCents),
    );
  }

  // 6. The vouchers, settled LAST against the bill as the batch leaves it.
  const subtotal = BillingSystem.subtotalOf(seats);
  if (!subtotal.ok) return Result.err(StaffEditError.invalidCommand('seats'));
  const paid = BillingSystem.settleVouchers(
    pendingVouchersOf(cmd.commands),
    stored.voucherRedemptions,
    BillingSystem.totalOf(subtotal.value, discounts),
    loaded.vouchers,
    nowUtcMs,
  );
  if (!paid.ok) return paid;

  // 7. The client records of added accounts: a missing one needs its
  //    contact snapshot first (read outside, then the edit runs again).
  const added = customerIdsFor(loaded.addedAccounts, context.hash);
  const missing: UserId[] = [];
  for (const [userId, customerId] of added) {
    if (
      loaded.placement.customers.get(customerId) === null &&
      !context.contacts.has(userId)
    ) {
      missing.push(userId);
    }
  }
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
            return subject === null ? [] : [spanOf(seat, subject)];
          }),
        ),
      ),
    ),
  });
  const start = ZonedTimeSystem.toUtc(
    draft.localDate,
    after.startMinutes,
    zone,
  );
  const placed: Appointment = {
    ...after,
    utcEpochMs: start.ok ? start.value : stored.utcEpochMs,
  };
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
        ...placementFields(placed),
        discounts: placed.discounts,
        voucherRedemptions: placed.voucherRedemptions,
        stoodSeatPairsRevision: placed.stoodSeatPairsRevision,
        stoodSeatPairs: placed.stoodSeatPairs,
      }),
      ...busyMergeWrites(loaded.placement, decided.value.busyWrites, zone),
      ...voucherWrites,
      ...customerCreates(
        added,
        loaded.placement.customers,
        context.contacts,
        nowUtcMs,
      ),
    ],
  });
}
