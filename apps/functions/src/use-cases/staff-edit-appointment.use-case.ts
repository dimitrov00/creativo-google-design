import {
  Money,
  Result,
  ZonedDateTime,
  fail,
  ok,
} from '@creativo/domain/kernel';
import type { Transaction } from 'firebase-admin/firestore';
import { worksTheBook } from '@creativo/domain/accounts';
import {
  Coupon,
  CouponCombinability,
  CouponValue,
  GiftVoucher,
} from '@creativo/domain/engagement';
import {
  AppliedDiscount,
  Appointment,
  type AppointmentStatus,
  BookingPolicy,
  SEAT_SCHEDULED,
  Seat,
  type SeatIdPair,
  type SeatOutcome,
  VoucherRedemption,
  toEcsDiscount,
  toEcsRedemption,
} from '@creativo/domain/scheduling';
import type { ClockPort } from '@creativo/application/shared';
import type {
  StaffDiscountRequest,
  StaffEditCommand,
} from '@creativo/application/booking';
import {
  type AppliedOperation,
  AppliedOperations,
  arrivedAtFromDocument,
  bookedAtFromDocument,
  contactFromDocument,
  discountsFromDocument,
  isClientOperationId,
  liveStoodSeatPairs,
  type PersistedDocument,
  preservedAppointmentFields,
  revisionOf,
  seatOutcomeFromDocument,
  seatTipFromDocument,
  voucherRedemptionsFromDocument,
  withStoodSeatPairs,
} from '@creativo/application/booking';
import { FirestoreBookingStore } from '../adapters/firestore-booking-store';
import {
  type CommitBookingError,
  CommitBookingInvalidInputError,
  CommitBookingInvariantError,
  CommitBookingStoreError,
} from './commit-booking.errors';
import {
  type BookingDecision,
  type BookingSnapshot,
  type DecideBookingRequest,
  type RequestedSeat,
  type StaffTermsOverride,
  decideBooking,
  standingDoubleSeatingsOf,
} from './decide-booking';
import {
  type StaffEditError,
  StaffEditBeforeArrivalError,
  StaffEditForbiddenError,
  StaffEditInvalidCommandError,
  StaffEditInvariantError,
  StaffEditOverlapError,
  StaffEditStaleError,
  StaffEditUnauthenticatedError,
} from './staff-edit-appointment.errors';
import { operationDigest } from './staff-edit-appointment.operations';
import {
  AppointmentEditSystem,
  AppointmentIndexSystem,
  type TimeCoordinate,
  AttendanceState,
  BarberId as BarberIdData,
  BarberPreference,
  BillPending,
  BillingSystem,
  BookingStatus,
  Combinability,
  CouponGrantId as CouponGrantIdData,
  CouponId as CouponIdData,
  type CouponValue as CouponValueData,
  Currency,
  DiscountMethod,
  DiscountProvenance,
  DiscountSource,
  DurationMinutes,
  EditCommand,
  type EditCommandRequest,
  EndMinute,
  type GiftVoucher as GiftVoucherData,
  GiftVoucherId as GiftVoucherIdData,
  LedgerVerdict,
  type LocalDate,
  LocalDate as LocalDateData,
  LocationId as LocationIdData,
  MinuteCount,
  MinuteOfDay,
  type Money as MoneyData,
  OperationId,
  type PendingDiscount,
  PriceCents,
  ResizeEdge,
  Seat as SeatData,
  SeatId as SeatIdData,
  SeatLabel as SeatLabelData,
  SeatOccupant,
  SeatOutcome as SeatOutcomeData,
  ServiceId as ServiceIdData,
  ServiceVariantId as ServiceVariantIdData,
  StaffEditErrorCode,
  type TimeZone,
  UserId as UserIdData,
  UtcEpochMs,
  VoucherCode as VoucherCodeData,
  VoucherLifecycle,
  type WallTime,
  ZonedTimeSystem,
  defect,
} from '@creativo/ecs-core';

/*
 * THE COMMAND LIVES IN THE PORT, and is re-exported here.
 *
 * It was declared a SECOND time in this file — the same five arms, written
 * out again — and the two copies had already begun to drift: the port grew a
 * seat scope on `move`/`resize` and this one did not, so the server could not
 * see a field the client was sending. A contract with two definitions is a
 * contract with none.
 *
 * `@creativo/application/booking` is the one that ships to both sides of the
 * wire, so it wins; the callable and the spec keep importing the name from
 * here, which is where they have always reached for it.
 */
export type { StaffEditCommand };

export interface StaffEditAppointmentInput {
  readonly appointmentId: string;
  /** From `request.auth.uid`. `null` is a refusal, never an anonymous edit. */
  readonly actorUserId: string | null;
  /** From the VERIFIED token's `roles` claim. */
  readonly actorRoles: readonly string[];
  /**
   * One command, or several applied together — see the port's own note.
   *
   * A gesture sends one; a `Запази` sends the day, the start, the duration
   * and any repriced leg as ONE intent, folded over the stored seats and
   * decided once so the whole save lands or none of it does.
   */
  readonly command: StaffEditCommand | readonly StaffEditCommand[];
  /**
   * The sheet said «Запази въпреки застъпването» and the user tapped it.
   *
   * The ONLY thing that turns the collision check off, and the reason it is a
   * request field while `allowOutsideWindow` is not: placing a booking outside
   * the roster is simply the staff rule, but sitting on somebody else's slot
   * is a decision somebody has to make out loud.
   */
  readonly acknowledgedOverlap?: boolean;
  /**
   * The revision the intent was made on — the staff sheet sends the one its
   * draft was drawn from on every save and every undo (round 5), so a
   * colleague's save since is refused (`StaffEditStaleError`) instead of
   * overwritten by an older screen.
   *
   * Absent (`undefined` or `null`) means the caller makes no claim about
   * what it read and is not refused for it — a copy whose reader did not
   * say (`Appointment.revision` null). Present, it must be a whole number
   * ≥ 0 or the edit is refused by name: dropping a malformed claim would
   * quietly switch the guard off, the way a dropped `operationId` would
   * switch off the dedupe.
   */
  readonly expectedVersion?: number | null;
  /**
   * The client's name for this ONE intent, the same on every re-send of it
   * — see the port's `operationId`. Absent (`undefined` or `null`) is an
   * older client, whose every send is its own change. Present, it must be
   * `isClientOperationId`-shaped or the edit is refused by name: dropping a
   * malformed one would quietly switch the dedupe off, and a re-sent batch
   * would then apply twice.
   */
  readonly operationId?: string | null;
}

export interface StaffEditResult {
  readonly appointmentId: string;
  /**
   * What the sheet should send as `expectedVersion` on its next save — on
   * a replay, the revision the ORIGINAL send stamped.
   */
  readonly revision: number;
  /**
   * The intent had already been applied (its `operationId` is in the
   * visit's ledger), so this call wrote NOTHING and answered with what the
   * first send committed. Its audit rows are keyed by the operation, so
   * re-attempting them fills a gap and never doubles a row.
   */
  readonly replayed: boolean;
}

/**
 * A grant, as the resolver found it — the value it carries, whose it is, and
 * whether it can still be honoured. Ownership is checked against the
 * appointment inside the transaction, where the owner is known.
 */
export interface ResolvedGrant {
  readonly grantId: string;
  readonly userId: string;
  /** The coupon's name — what the receipt calls the promise. */
  readonly label: string;
  readonly value: CouponValue;
  readonly usable: boolean;
  /** The coupon's own rule: may it share the bill? */
  readonly exclusive: boolean;
}

/** An enabled coupon a code opens. */
export interface ResolvedCode {
  readonly couponId: string;
  readonly label: string;
  readonly value: CouponValue;
  /** The code as stored — normalised — so the snapshot records what was matched. */
  readonly code: string;
  readonly exclusive: boolean;
}

/**
 * How the use case looks up the promises a discount names. Two reads, both
 * OUTSIDE the transaction: neither a grant nor a coupon is what the edit's
 * transaction protects, and the snapshot taken here is all the appointment
 * ever keeps of them (see `AppliedDiscount`).
 */
export interface DiscountResolver {
  grant(grantId: string): Promise<ResolvedGrant | null>;
  code(code: string): Promise<ResolvedCode | null>;
}

/** The default when no resolver is wired: every promise is unknown. */
const NO_RESOLVER: DiscountResolver = {
  grant: async () => null,
  code: async () => null,
};

/**
 * The gift vouchers a batch touches — read and written INSIDE the
 * transaction, unlike the promises above, because a balance is the one
 * thing two counters can race for. `read` returns every voucher named by
 * code or already drawn on by this visit (by id); `write` lands the settled
 * balances after the appointment's own write.
 */
export interface VoucherLedger {
  read(
    tx: Transaction,
    codes: readonly string[],
    ids: readonly string[],
  ): Promise<Result<readonly GiftVoucher[], StaffEditError>>;
  write(tx: Transaction, vouchers: readonly GiftVoucher[]): void;
}

/** The default when no ledger is wired: no voucher exists. */
const NO_LEDGER: VoucherLedger = {
  read: async () => ok([]),
  write: () => undefined,
};

/**
 * One requested discount, with whatever the resolver found for it — `null`
 * when it found nothing. Resolution failures are NOT refusals yet: a code
 * whose coupon was retired last week is still kept if it is already on the
 * visit, and only `plan`, holding the stored document, can tell.
 */
interface PendingDiscountItem {
  readonly request: StaffDiscountRequest;
  readonly grant?: ResolvedGrant | null;
  readonly coupon?: ResolvedCode | null;
}

/**
 * What the batch says about the bill's discounts. `keep` is the ordinary
 * case — a batch that never mentioned them carries the stored ones forward,
 * exactly as it carries a tip.
 */
type PendingDiscounts =
  | { readonly kind: 'keep' }
  | { readonly kind: 'set'; readonly items: readonly PendingDiscountItem[] };

/** The same for the vouchers paying the bill — the codes, in cover order. */
type PendingVouchers =
  | { readonly kind: 'keep' }
  | { readonly kind: 'set'; readonly codes: readonly string[] };

/** One stored seat, read as primitives before anything is decided about it. */
interface StoredSeat {
  readonly id: string;
  readonly serviceId: string;
  readonly variantId: string | null;
  readonly barberId: string;
  readonly barberPref?: 'any' | 'specific';
  readonly zone: string;
  readonly startMs: number;
  readonly durationMinutes: number;
  readonly priceMinorUnits: number;
  readonly currencyCode: string;
  readonly setupMinutes: number;
  readonly cleanupMinutes: number;
  readonly outcome: SeatOutcome;
  /**
   * What was left for the barber, in the seat's own currency. `null` is "not
   * recorded" and is NOT zero.
   *
   * Carried through the rebuild for the same reason the outcome is: the
   * decision re-derives placement and terms from the catalogue and knows
   * nothing about money the shop never charged, so a tip not restored here
   * is a tip erased by the next drag.
   */
  readonly tipMinorUnits: number | null;
  readonly subject: RequestedSeat['subject'];
  /**
   * Added in THIS batch and not yet priced: `decideBooking` resolves its
   * terms from the catalogue, so it carries no override. `durationMinutes`
   * is the client's reading of the catalogue, kept only so the batch's own
   * geometry agrees with the seat it just added.
   */
  readonly fresh?: true;
}

const MINUTE_MS = 60_000;

/** The shop the batch moves the visit to — the last «Салон» in it — or `null`. */
function relocatedTo(commands: readonly StaffEditCommand[]): string | null {
  let target: string | null = null;
  for (const command of commands) {
    if (command.kind === 'relocate') target = command.locationId;
  }
  return target;
}

function endMs(seat: StoredSeat): number {
  return seat.startMs + seat.durationMinutes * MINUTE_MS;
}

/**
 * Read one persisted seat, refusing rather than guessing.
 *
 * Nothing is defaulted into existence and nothing is downgraded. In
 * particular an ACCOUNT seat that is not the owner's own is refused outright:
 * the request shape a decision is rebuilt from can express `self` and `guest`
 * and nothing else, so re-deciding such a seat would quietly turn a linked
 * account into an anonymous label — and there would be no source left to
 * recover the link from. No writer in this codebase produces one today; the
 * refusal is here so that if one ever does, an edit stops rather than erases.
 */
function readSeat(
  raw: unknown,
  rootStatus: AppointmentStatus | undefined,
): StoredSeat | null {
  if (raw == null || typeof raw !== 'object') return null;
  const seat = raw as Record<string, unknown>;
  const slot = (seat['slot'] ?? {}) as Record<string, unknown>;
  const terms = (seat['terms'] ?? {}) as Record<string, unknown>;
  const subject = (seat['subject'] ?? {}) as Record<string, unknown>;

  const zone = String(slot['zone'] ?? '');
  const start = ZonedDateTime.fromISO(String(slot['startIso'] ?? ''), zone);
  if (start.isFailure()) return null;

  const durationMinutes = Number(terms['durationMinutes']);
  const priceMinorUnits = Number(terms['priceMinorUnits']);
  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes <= 0 ||
    !Number.isFinite(priceMinorUnits)
  ) {
    return null;
  }

  let requested: RequestedSeat['subject'];
  if (subject['kind'] === 'account') {
    // The owner's seat binds to the owner again; a companion keeps their own
    // account. Reading only `self` here refused every edit of a visit with a
    // companion on it, the seeded father-and-son party included.
    if (subject['relationship'] === 'self') {
      requested = { kind: 'self' };
    } else if (
      subject['relationship'] === 'companion' &&
      typeof subject['userId'] === 'string'
    ) {
      requested = { kind: 'companion', userId: subject['userId'] };
    } else {
      return null;
    }
  } else {
    requested = { kind: 'guest', label: String(subject['label'] ?? '') };
  }

  const pref = seat['barberPref'];
  return {
    id: String(seat['id'] ?? ''),
    serviceId: String(seat['serviceId'] ?? ''),
    variantId: seat['variantId'] == null ? null : String(seat['variantId']),
    barberId: String(seat['barberId'] ?? ''),
    // Carried forward, never re-derived. `barberPref` is the one fact that
    // says whether this client can be moved to another chair without a phone
    // call, and a staff edit that dropped it would recreate the very bug the
    // commit path was just fixed for.
    ...(pref === 'any' || pref === 'specific' ? { barberPref: pref } : {}),
    zone,
    startMs: start.value.toMillis(),
    durationMinutes,
    priceMinorUnits,
    currencyCode: String(terms['currencyCode'] ?? ''),
    setupMinutes: Number(terms['setupMinutes'] ?? 0),
    cleanupMinutes: Number(terms['cleanupMinutes'] ?? 0),
    // The ROOT status is the legacy path's discriminator — a seat with no
    // stored outcome on a settled appointment is not "scheduled", and reading
    // it as such would resurrect finished business onto the day sheet.
    outcome: seatOutcomeFromDocument(
      seat['outcome'],
      rootStatus,
      start.value.toMillis() + durationMinutes * MINUTE_MS,
    ),
    tipMinorUnits:
      typeof seat['tipMinorUnits'] === 'number' &&
      Number.isFinite(seat['tipMinorUnits'])
        ? seat['tipMinorUnits']
        : null,
    subject: requested,
  };
}

/**
 * `staffEditAppointment` — the shop moving its own book.
 *
 * ### Why this is not `rescheduleAppointment` with a role check
 * Four of its rules are the client's, and every one of them is wrong here:
 * the cancellation window (the shop is not a client asking the shop for a
 * favour — *"the shop itself may always move its own book"*, already ruled
 * for `transitionAppointment`), the ownership check (staff move other
 * people's bookings; that is the job), the rostered window (staff placement
 * is not bookable placement — `roster-window.ts` says so in prose), and the
 * refusal to touch a party with a resolved seat (a party where one guest is
 * already served is exactly the party someone needs to shorten). What is left
 * of `rescheduleAppointment` after removing them is not a reschedule.
 *
 * ### What it restores, and why each one is a bug if it does not
 * A decision rebuilds the appointment from the catalogue and the request, so
 * everything that belongs to the appointment's IDENTITY rather than its
 * placement has to be put back explicitly:
 *   - `status` — a move must not walk a confirmed booking back to pending.
 *   - `contact` — the number the shop dials.
 *   - `bookedAt` — the booking instant; restamping it would collapse booking
 *     lead time toward zero for exactly the bookings planned furthest ahead.
 *   - `arrivedAt` — 🔴 and this one is not merely lossy. `primaryVerb` gates
 *     the completion verb on `arrived`, so an erased stamp makes FINISHING
 *     THE VISIT vanish from the sheet. It cannot be backfilled.
 *   - seat ids and per-seat OUTCOMES — the guest who was served, the guest who
 *     did not show. Fresh ids would also orphan every per-seat action the
 *     sheet has open.
 *   - the seats' `barberPref`, and every document field this mapper does not
 *     own (see `preservedAppointmentFields`).
 */
export class StaffEditAppointmentUseCase {
  constructor(
    private readonly store: FirestoreBookingStore,
    private readonly clock: ClockPort,
    private readonly policy: BookingPolicy = BookingPolicy.default(),
    private readonly discounts: DiscountResolver = NO_RESOLVER,
    private readonly vouchers: VoucherLedger = NO_LEDGER,
  ) {}

  async execute(
    input: StaffEditAppointmentInput,
  ): Promise<Result<StaffEditResult, StaffEditError>> {
    if (!input.actorUserId) {
      return fail(new StaffEditUnauthenticatedError());
    }
    // `worksTheBook`, NOT `isStaff`. The two differ by `content_manager`, a
    // copy-and-media role that `firestore.rules` refuses every appointment
    // READ — handing it the book's writes would be a permission the reader is
    // denied and the writer is granted.
    if (!worksTheBook(input.actorRoles)) {
      return fail(new StaffEditForbiddenError());
    }
    if (input.appointmentId.length === 0) {
      return fail(new StaffEditInvalidCommandError('appointmentId'));
    }
    const operationId = input.operationId ?? null;
    if (operationId !== null && !isClientOperationId(operationId)) {
      return fail(new StaffEditInvalidCommandError('operationId'));
    }
    const expectedVersion = input.expectedVersion ?? null;
    if (
      expectedVersion !== null &&
      !(Number.isInteger(expectedVersion) && expectedVersion >= 0)
    ) {
      return fail(new StaffEditInvalidCommandError('expectedVersion'));
    }

    /*
     * ONE COMMAND OR SEVERAL, validated the same way and applied in order.
     *
     * A gesture sends one; a `Запази` sends the day, the start, the duration
     * and any repriced leg as one intent. Folding them before deciding is
     * what makes the save atomic — four requests would be four placement
     * decisions and a booking left half-moved when the third is refused.
     */
    const raw = Array.isArray(input.command) ? input.command : [input.command];
    if (raw.length === 0) {
      return fail(new StaffEditInvalidCommandError('command'));
    }
    const commands: StaffEditCommand[] = [];
    for (const arm of raw) {
      const shape = validateCommand(arm);
      if (shape.isFailure()) return fail(shape.error);
      commands.push(shape.value);
    }

    /*
     * THE DISCOUNTS ARE RESOLVED FIRST, outside the transaction. They name
     * promises — grants, codes — that have to be looked up, and the fold
     * inside the transaction is synchronous by design (every read strictly
     * precedes every write). What comes back is a snapshot of each promise;
     * whether it may be kept for THIS visit is decided inside, where the
     * owner and the stored bill are known. The VOUCHERS are the other way
     * round: a balance is read and written inside the transaction, through
     * the ledger, because it is the one thing two counters can race for.
     */
    const pendingDiscounts = await this.resolveDiscounts(commands);
    if (pendingDiscounts.isFailure()) return fail(pendingDiscounts.error);
    const pendingVouchers = pendingVouchersOf(commands);
    /** This intent's name and fingerprint, when the client named it. */
    const operation =
      operationId === null
        ? null
        : { id: operationId, digest: operationDigest(commands) };

    /**
     * What `plan` worked out, read back by `decide`.
     *
     * Local to the call and reassigned on every attempt, which is what makes
     * it safe: a Firestore transaction can retry, and `plan` runs first on
     * each attempt, so `decide` can never see a previous attempt's numbers.
     */
    let planned: PlannedEdit | null = null;
    let nextRevision = 0;
    /**
     * The applied intent this call re-sends, when it is one. A holder, like
     * `RescheduleBookingUseCase`'s: it is read after the transaction, and an
     * assignment made inside a callback is invisible to the compiler's
     * narrowing of a bare `let`. Reset on every attempt.
     */
    const attempt: { replayOf: AppliedOperation | null } = { replayOf: null };
    /** The vouchers `decide` settled, for the ledger to write after the visit. */
    let settledVouchers: readonly GiftVoucher[] = [];

    const written = await this.store.reschedule<
      StaffEditError,
      readonly GiftVoucher[]
    >(
      input.appointmentId,
      // Staff bypass the owner check entirely — which is also what unfreezes
      // every walk-in already in the collection. `ownerUserId: null` made
      // those rows equal to nobody's uid and therefore unreschedulable by
      // ANYONE, a state nothing ever decided on purpose.
      () => true,
      (current) => {
        /*
         * A RE-SENT INTENT IS ANSWERED, NOT APPLIED — and before anything
         * else is checked. The first send moved the revision on, so the
         * re-send's own `expectedVersion` is exactly the stale claim the
         * next check refuses; and whatever the visit went through since,
         * this intent has already happened. `null` tells the store that
         * nothing is to be written.
         */
        const replay = replayOf(current, operation);
        if (replay.isFailure()) return fail(replay.error);
        attempt.replayOf = replay.value;
        if (replay.value !== null) return ok(null);

        const result = this.plan(
          input.appointmentId,
          current,
          commands,
          expectedVersion,
          pendingDiscounts.value,
          input.actorRoles,
        );
        if (result.isFailure()) return fail(result.error);
        planned = result.value;
        nextRevision = result.value.nextRevision;
        return ok(result.value.request);
      },
      (snapshot, current, request, vouchers) => {
        // Unreachable: `plan` runs first on every attempt and either sets this
        // or fails the attempt. Checked rather than asserted because a
        // silently-null plan would decide the WRONG geometry.
        if (planned === null) {
          return fail(new StaffEditInvariantError('plan'));
        }
        const decided = this.decide(
          snapshot,
          current,
          request,
          planned,
          input,
          vouchers,
          pendingVouchers,
        );
        if (decided.isFailure()) return fail(decided.error);
        settledVouchers = decided.value.touched;
        return ok(decided.value.decision);
      },
      (current) =>
        withStoodSeatPairs(
          {
            ...preservedAppointmentFields(current),
            revision: revisionOf(current) + 1,
            // The intent's name, stamped by the SAME write that applies it:
            // the ledger can never say "applied" about an edit that did not
            // land, nor miss one that did. An unnamed send leaves the ledger
            // as it was — `preservedAppointmentFields` already carries it.
            ...(operation === null
              ? {}
              : AppliedOperations.fromDocument(current)
                  .record({
                    id: operation.id,
                    revision: revisionOf(current) + 1,
                    digest: operation.digest,
                  })
                  .toFields()),
          },
          /*
           * THE PAIRS THIS SAVE BROKE, remembered for its undo (round 6)
           * under the revision this write stamps: the next write, made on
           * it, may put them back (`liveStoodSeatPairs`). A save that broke
           * none drops whatever an older save remembered.
           */
          planned === null || planned.broken.length === 0
            ? null
            : { revision: revisionOf(current) + 1, pairs: planned.broken },
        ),
      {
        // Every voucher the batch could touch: the ones it names, and the
        // ones the visit already drew on (to give back, or to re-settle).
        read: (tx, current) => {
          const live = voucherRedemptionsFromDocument(current).filter(
            (redemption) => redemption.live,
          );
          const codes =
            pendingVouchers.kind === 'set'
              ? pendingVouchers.codes
              : live.map((redemption) => redemption.code);
          return this.vouchers.read(
            tx,
            codes,
            live.map((redemption) => redemption.voucherId),
          );
        },
        write: (tx) => this.vouchers.write(tx, settledVouchers),
      },
    );

    if (written.isFailure()) return fail(written.error);
    if (written.value.kind === 'replayed') {
      const original = attempt.replayOf;
      // Unreachable: the store reports a replay only when the plan step
      // answered `null`, which it does only after finding the intent.
      if (original === null) {
        return fail(new StaffEditInvariantError('replay'));
      }
      return ok({
        appointmentId: input.appointmentId,
        revision: original.revision,
        replayed: true,
      });
    }
    return ok({
      appointmentId: input.appointmentId,
      revision: nextRevision,
      replayed: false,
    });
  }

  /**
   * The batch's LAST word on the discounts, resolved.
   *
   * Last, not first: a save sends one `discounts` arm, and if a caller ever
   * sent two the later one is what the sheet showed when `Запази` was
   * pressed. Nothing is refused here — a promise that does not resolve may
   * still be one the visit already holds, and only `plan` can tell.
   */
  private async resolveDiscounts(
    commands: readonly StaffEditCommand[],
  ): Promise<Result<PendingDiscounts, StaffEditError>> {
    const arm = [...commands]
      .reverse()
      .find(
        (
          command,
        ): command is Extract<StaffEditCommand, { kind: 'discounts' }> =>
          command.kind === 'discounts',
      );
    if (arm === undefined) return ok({ kind: 'keep' });

    const items: PendingDiscountItem[] = [];
    for (const request of arm.discounts) {
      switch (request.source) {
        case 'grant':
          items.push({
            request,
            grant: await this.discounts.grant(request.grantId),
          });
          break;
        case 'code':
          items.push({
            request,
            coupon: await this.discounts.code(request.code),
          });
          break;
        case 'manual':
          items.push({ request });
          break;
      }
    }
    return ok({ kind: 'set', items });
  }

  /**
   * The stored appointment plus the command → the request a decision runs on.
   *
   * Every seat is rebuilt from the DOCUMENT, not from a payload: the caller
   * names an act, never a cart. That is what keeps a chair swap from being a
   * back door to re-pricing every other leg of the party.
   */
  private plan(
    appointmentId: string,
    current: PersistedDocument,
    commands: readonly StaffEditCommand[],
    expectedVersion: number | null | undefined,
    pending: PendingDiscounts,
    actorRoles: readonly string[],
  ): Result<PlannedEdit, StaffEditError> {
    const revision = revisionOf(current);
    if (expectedVersion != null && expectedVersion !== revision) {
      return fail(new StaffEditStaleError(expectedVersion, revision));
    }

    const rootStatus = current['status'] as AppointmentStatus | undefined;
    const rawSeats = Array.isArray(current['seats']) ? current['seats'] : [];
    const stored: StoredSeat[] = [];
    for (const raw of rawSeats) {
      const seat = readSeat(raw, rootStatus);
      if (!seat) return fail(new CommitBookingInvalidInputError('seats'));
      stored.push(seat);
    }
    if (stored.length === 0) {
      return fail(new CommitBookingInvalidInputError('seats'));
    }

    /*
     * FOLDED IN ORDER, so each command sees the one before it.
     *
     * A save that moves the day and then stretches the block must resize the
     * MOVED seats — applying both against the stored ones would measure the
     * second gesture from a start that no longer exists. Order is the
     * caller's, which is the only place that knows what the barber did.
     */
    let next: readonly StoredSeat[] = stored;
    // The stored seats must sit on one shop day inside it (F-6) before any
    // command folds over them.
    if (storedTimeOf(stored) === null) {
      return fail(new StaffEditInvalidCommandError('seats'));
    }
    const fold: FoldContext = {
      // A seat added to a FINISHED visit was worked, not scheduled: the
      // sheet is being filled in after the cut (owner, 2026-09-09).
      finished: rootStatus?.kind === 'completed',
      held: idsOf(stored),
    };
    for (const command of commands) {
      // Discounts and vouchers are facts about the BILL, and a relocation
      // about the PLACE — settled elsewhere; the seats do not change under
      // them.
      if (
        command.kind === 'discounts' ||
        command.kind === 'vouchers' ||
        command.kind === 'relocate'
      ) {
        continue;
      }
      const applied = applyCommand(next, command, fold);
      if (applied.isFailure()) return fail(applied.error);
      next = applied.value;
    }

    const discounts = this.settleDiscounts(
      pending,
      current,
      stored,
      actorRoles,
    );
    if (discounts.isFailure()) return fail(discounts.error);

    const seats: RequestedSeat[] = [];
    const overrides = new Map<string, StaffTermsOverride>();
    for (const seat of next) {
      const start = ZonedDateTime.fromMillis(seat.startMs, seat.zone);
      if (start.isFailure()) {
        return fail(new CommitBookingInvalidInputError('startIso'));
      }
      seats.push({
        // The SEAT ID is the line id, so the terms carried forward land back
        // on the seat they came from however the party is ordered.
        lineId: seat.id,
        serviceId: seat.serviceId,
        variantId: seat.variantId,
        barberId: seat.barberId,
        ...(seat.barberPref ? { barberPref: seat.barberPref } : {}),
        startIso: start.value.toISO(),
        subject: seat.subject,
      });
      // The terms are a SNAPSHOT taken when the booking was made, and a move
      // is not a re-sale. Carrying every one of them forward is what stops a
      // catalogue price rise from silently re-pricing a booking somebody
      // merely dragged fifteen minutes — the decision still resolves the
      // catalogue's answer, but only to record it as provenance.
      // A fresh seat is priced by the catalogue, not by what the client said.
      if (seat.fresh) continue;
      overrides.set(seat.id, {
        priceMinorUnits: seat.priceMinorUnits,
        currencyCode: seat.currencyCode,
        durationMinutes: seat.durationMinutes,
        setupMinutes: seat.setupMinutes,
        cleanupMinutes: seat.cleanupMinutes,
      });
    }

    const contact = contactFromDocument(current)?.toProps();
    return ok({
      request: {
        // The shop the batch moves the visit to, else the one it is at. The
        // decision then loads THAT shop's hours and zone and checks every
        // seat's service is offered there.
        locationId:
          relocatedTo(commands) ?? String(current['locationId'] ?? ''),
        seats,
        // REUSED as the attempt id, which is what keeps the edited
        // appointment the same DOCUMENT rather than minting a new one — the
        // client's deep links, the reminder that named it and every per-seat
        // action the sheet has open all key off this id.
        attemptId: appointmentId,
        ...(contact ? { contact } : {}),
      },
      stored,
      next,
      overrides,
      nextRevision: revision + 1,
      commands,
      discounts: discounts.value,
      stood: liveStoodSeatPairs(current),
      // Counted as the decision counts people (`standingDoubleSeatingsOf`):
      // the seats as stored, against the seats as the batch leaves them. A
      // seat the batch adds is a new id and can break nothing.
      broken: standingDoubleSeatingsOf(stored)
        .brokenBy(standingDoubleSeatingsOf(next))
        .toPairs(),
    });
  }

  /**
   * The bill's discounts after this batch — the stored ones carried forward,
   * or the set the batch named, each item either KEPT as stored (the same
   * grant, the same code, the same manual figure: a promise once kept is not
   * withdrawn by a coupon retired since) or NEW, as a snapshot stamped now.
   *
   * A NEW grant must be the appointment owner's own and still usable; a
   * new code must have opened a coupon; a new manual figure needs a role
   * that handles money — keeping one a receptionist set earlier does not,
   * so a barber saving a visit with such a discount on it is not refused.
   * Then the SET: an exclusive coupon alone, no promise twice, one manual
   * figure at most (`AppliedDiscount.isLegalSet`).
   */
  private settleDiscounts(
    pending: PendingDiscounts,
    current: PersistedDocument,
    stored: readonly StoredSeat[],
    actorRoles: readonly string[],
  ): Result<readonly AppliedDiscount[], StaffEditError> {
    const existing = discountsFromDocument(current);
    if (pending.kind === 'keep') return ok(existing);
    if (pending.items.length === 0) return ok([]);

    const template = stored[0];
    if (!template) return fail(new CommitBookingInvalidInputError('seats'));
    const now = this.clock.now(template.zone);
    if (now.isFailure()) return fail(new CommitBookingStoreError(now.error));

    // THIN SHIM (ECS Phase 2): `BillingSystem.settleDiscounts` decides — kept
    // as stored or NEW, who may add a manual figure, the legal set — and the
    // legacy snapshots ride back on what it decided.
    const currency = Currency.parse(template.currencyCode);
    const nowUtcMs = UtcEpochMs.of(now.value.toMillis());
    if (!currency.ok || !nowUtcMs.ok) {
      return fail(new StaffEditInvalidCommandError('discounts'));
    }
    const items: PendingDiscount[] = [];
    for (const item of pending.items) {
      const data = toPendingDiscountData(item, currency.value);
      // A typed figure that is no amount of cents is no discount — the
      // refusal the settle gives every figure it cannot value.
      if (data === null) {
        return fail(new StaffEditInvalidCommandError('discounts'));
      }
      items.push(data);
    }
    const existingData = existing.map(toEcsDiscount);
    const owner = current['ownerUserId'];
    const settled = BillingSystem.settleDiscounts(
      { billPending: LEGACY_BILL_PENDING.set, items },
      existingData,
      typeof owner === 'string' ? UserIdData.of(owner) : null,
      actorRoles,
      currency.value,
      nowUtcMs.value,
    );
    if (!settled.ok) {
      return fail(
        settled.error.errorCode === StaffEditErrorCode.Forbidden
          ? new StaffEditForbiddenError()
          : new StaffEditInvalidCommandError('discounts'),
      );
    }
    return ok(
      settled.value.map((discount, index) => {
        const kept = existingData.indexOf(discount);
        if (kept >= 0) return existing.at(kept) as AppliedDiscount;
        const item = pending.items.at(index) as PendingDiscountItem;
        return AppliedDiscount.of({
          id: discount.discountId,
          source: DISCOUNT_SOURCE_LEGACY[discount.discountSource],
          label: discount.label,
          value: legacyValueOf(item, template.currencyCode),
          grantId: DiscountProvenance.grantIdOf(discount),
          code: DiscountProvenance.codeOf(discount),
          appliedAt: now.value,
          combinability: Combinability.isExclusive(discount.combinability)
            ? CouponCombinability.exclusive()
            : CouponCombinability.stackable(),
        });
      }),
    );
  }

  /**
   * The vouchers paying the bill after this batch, settled against the
   * balances the ledger read in this transaction.
   *
   * ALWAYS re-settled, even when the batch said nothing about vouchers: a
   * reprice or a discount in the same save can drop the bill under what a
   * voucher had paid, and the difference must go back. Each voucher covers
   * what the ones before it left, never more than it has; a voucher no
   * longer named gives back everything it paid, and its line stays as
   * history with the instant it was reversed. A voucher NEW to the visit
   * must be redeemable; one already on it may keep or shrink its draw
   * whatever became of it since (`GiftVoucher.settle`).
   */
  private settleVouchers(
    pending: PendingVouchers,
    current: PersistedDocument,
    appointment: Appointment,
    vouchers: readonly GiftVoucher[],
    now: ZonedDateTime,
  ): Result<
    { appointment: Appointment; touched: readonly GiftVoucher[] },
    StaffEditError
  > {
    // THIN SHIM (ECS Phase 2): `BillingSystem.settleVouchers` covers the
    // bill in order and gives back what is no longer named; the legacy lines
    // and vouchers ride back on what it decided.
    const stored = voucherRedemptionsFromDocument(current);
    const storedData = stored.map(toEcsRedemption);
    const nowUtcMs = UtcEpochMs.of(now.toMillis());
    if (!nowUtcMs.ok) return fail(new StaffEditInvalidCommandError('vouchers'));
    const settled = BillingSystem.settleVouchers(
      pending.kind === 'set'
        ? { billPending: LEGACY_BILL_PENDING.set, codes: pending.codes }
        : { billPending: LEGACY_BILL_PENDING.keep },
      storedData,
      toMoneyData(appointment.total()),
      vouchers.map(toVoucherData),
      nowUtcMs.value,
    );
    if (!settled.ok) return fail(new StaffEditInvalidCommandError('vouchers'));
    const lines = settled.value.voucherRedemptions;
    if (lines === storedData) return ok({ appointment, touched: [] });

    const redemptions: VoucherRedemption[] = [];
    for (const line of lines) {
      const unchanged = storedData.indexOf(line);
      if (unchanged >= 0) {
        redemptions.push(stored.at(unchanged) as VoucherRedemption);
        continue;
      }
      const prior = stored.find(
        (entry) =>
          entry.live &&
          entry.voucherId === line.voucherId &&
          entry.appliedAt.toMillis() === line.appliedAtUtcMs,
      );
      if (line.reversedAtUtcMs !== null && prior !== undefined) {
        redemptions.push(prior.reversed(now));
        continue;
      }
      redemptions.push(
        VoucherRedemption.of({
          voucherId: line.voucherId,
          code: line.code,
          amount: fromCents(line.amountCents, line.currency),
          balanceAfter: fromCents(line.balanceAfterCents, line.currency),
          appliedAt: prior?.appliedAt ?? now,
        }),
      );
    }
    const touched: GiftVoucher[] = [];
    for (const entity of settled.value.touched) {
      const voucher = vouchers.find((entry) => entry.id.value === entity.id);
      if (voucher === undefined) continue;
      const back = GiftVoucher.reconstitute({
        id: voucher.id.value,
        code: voucher.code,
        value: voucher.initialValue,
        balance: fromCents(entity.balanceCents, entity.currency),
        issuedAt: voucher.issuedAt,
        expiresAt: voucher.expiresAt,
        issuedToUserId: voucher.issuedToUserId?.value ?? null,
        state: voucher.state,
      });
      if (back.isFailure()) {
        return fail(new StaffEditInvalidCommandError('vouchers'));
      }
      touched.push(back.value);
    }
    return ok({
      appointment: appointment.withVoucherRedemptions(redemptions),
      touched,
    });
  }

  private decide(
    snapshot: BookingSnapshot,
    current: PersistedDocument,
    request: DecideBookingRequest,
    planned: PlannedEdit,
    input: StaffEditAppointmentInput,
    vouchers: readonly GiftVoucher[],
    pendingVouchers: PendingVouchers,
  ): Result<
    { decision: BookingDecision; touched: readonly GiftVoucher[] },
    StaffEditError
  > {
    const now = this.clock.now(snapshot.zone);
    if (now.isFailure()) {
      return fail(new CommitBookingStoreError(now.error));
    }

    // A visit that NEVER HAPPENED is history; a FINISHED one may be
    // corrected; nothing may end before its arrival stamp —
    // `AppointmentEditSystem.guard`.
    // The folded seats on their day's wall clock, the arrival on the same
    // clock (T6); the refusal's legacy params from the instants already held.
    const status = (current['status'] ?? {}) as AppointmentStatus;
    const arrivedAt = arrivedAtFromDocument(current);
    const clock = seatsOnTheClock(planned.next);
    if (clock === null) return fail(new StaffEditInvalidCommandError('seats'));
    const refusal = AppointmentEditSystem.guard(
      bookingStatusOf(status.kind),
      clock.localDate,
      clock.seats.map((seat) => SeatData.range(seat)),
      arrivedAt === null ? null : wallOf(arrivedAt, clock.zone),
    );
    if (refusal !== null) {
      if (refusal.errorCode !== StaffEditErrorCode.BeforeArrival) {
        return fail(new CommitBookingInvalidInputError(refusal.field));
      }
      const finishMs = Math.max(...planned.next.map(endMs));
      const finishIso = ZonedDateTime.fromMillis(finishMs, snapshot.zone);
      return fail(
        new StaffEditBeforeArrivalError(
          finishIso.isSuccess() ? finishIso.value.toISO() : String(finishMs),
          arrivedAt === null ? '' : arrivedAt.toISO(),
        ),
      );
    }

    // A fresh seat must name a chair this shop rosters. The placement engine
    // tolerates a chair with no roster for STAFF (outside-window placement
    // is allowed), which let a display name through as an id — a seat on a
    // chair no lane draws (found live, 2026-09-08).
    for (const seat of planned.next) {
      if (seat.fresh && !snapshot.schedules.has(seat.barberId)) {
        return fail(new StaffEditInvalidCommandError('barberId'));
      }
    }
    const ids = planned.next.map((seat) => seat.id);
    let cursor = 0;

    const decided = decideBooking(request, snapshot, {
      now: now.value,
      policy: this.policy,
      // The STORED ids, in order, so per-seat outcomes and every open per-seat
      // action on the sheet survive the rebuild.
      nextId: () => ids[cursor++] ?? '',
      // The appointment's OWN owner, off the document — never the staff actor.
      // Taking the actor here would hand the receptionist the client's
      // booking. `null` is a walk-in and stays a walk-in.
      ownerUserId:
        typeof current['ownerUserId'] === 'string'
          ? current['ownerUserId']
          : null,
      // Unconditional, no request field, no second tap — see the deps' doc.
      allowOutsideWindow: true,
      // The shop combines what it likes (owner, 2026-09-17) — the deps' doc.
      allowConflictingServices: true,
      // Acknowledged, and only acknowledged.
      allowOverlap: input.acknowledgedOverlap === true,
      termsOverrides: planned.overrides,
      // …AND THE PAIRS ITS LAST SAVE BROKE, while this edit is the write that
      // follows that save (round 6): «Отмени» puts back exactly what the
      // save changed — a seat of a legacy pair re-added under its old id, a
      // pair moved back together — and is not refused for restoring what
      // the visit already held. Off the document, never the payload.
      stood: planned.stood,
      // THE VISIT AS IT STOOD, read off the document before the batch. A
      // double seating the visit already held (two walk-ins under the old
      // shared label, a companion entered twice by hand) is known by its
      // SEAT IDS, which `nextId` re-mints in order, so it stands through
      // any edit of it: a whole-visit drag, a chair-wide resize, a restaff
      // (owner decision, round 5; round 4 matched positions and refused the
      // drag). A pair that did not overlap, or a seat the batch adds, is
      // judged in full: staff can always save a visit they did not make
      // worse, and never make one worse. A `StoredSeat` is a `StandingSeat`
      // as it is (id, person, start, sold minutes), and it comes from the
      // document, never the payload.
      standing: planned.stored,
    });
    if (decided.isFailure()) {
      return fail(translateRefusal(decided.error, planned.commands));
    }

    // Per-seat outcomes are restored by INDEX, which is exact: the decision
    // consumed `request.seats` in order and `request.seats` was built from
    // `planned.next` in order. Every other field is the decided seat's own,
    // spread from `toProps()` so a field SeatProps gains later is carried,
    // not silently dropped by a hand-written copy.
    const seats = decided.value.appointment.seats.map((seat, index) =>
      Seat.of({
        ...seat.toProps(),
        // eslint-disable-next-line security/detect-object-injection -- `index` is the array index this very `map` produced, over an array the decision built from `planned.next` in order.
        outcome: planned.next[index]?.outcome ?? SEAT_SCHEDULED,
        // Restored by the same index and for the same reason: the decision
        // rebuilt this seat from the catalogue, which has no idea what the
        // client left on the counter.
        tip: seatTipFromDocument(
          // eslint-disable-next-line security/detect-object-injection -- as above: `index` indexes the array this `map` is walking.
          planned.next[index]?.tipMinorUnits ?? null,
          seat.terms.price.currencyCode(),
        ),
      }),
    );

    const restored = Appointment.reconstitute({
      id: decided.value.appointment.id.value,
      locationId: decided.value.appointment.locationId.value,
      seats,
      status,
      contact: contactFromDocument(current),
      bookedAt: bookedAtFromDocument(current),
      bookedFromAppointmentId:
        typeof current['bookedFromAppointmentId'] === 'string'
          ? current['bookedFromAppointmentId']
          : null,
      arrivedAt,
      // The bill, as this batch left it — carried forward untouched by a
      // move, the way a tip is, and never re-derived from the catalogue.
      discounts: planned.discounts,
    });
    if (restored.isFailure()) {
      return fail(new CommitBookingInvariantError(restored.error));
    }

    // The vouchers settle LAST, against the bill as this batch leaves it —
    // the seats repriced, the discounts applied.
    const paid = this.settleVouchers(
      pendingVouchers,
      current,
      restored.value,
      vouchers,
      now.value,
    );
    if (paid.isFailure()) return fail(paid.error);

    return ok({
      decision: {
        appointment: paid.value.appointment,
        busyWrites: decided.value.busyWrites,
      },
      touched: paid.value.touched,
    });
  }
}

/**
 * Has the visit already applied this intent? `null` when there is no name
 * or the name is new; the applied entry when it is a re-send; a refusal
 * when the name is known but the batch is not the one it applied — a
 * reused name, which answering "saved" would turn into a silent loss.
 */
function replayOf(
  current: PersistedDocument,
  operation: { readonly id: string; readonly digest: string } | null,
): Result<AppliedOperation | null, StaffEditError> {
  if (operation === null) return ok(null);
  // The stored ledger as the flat entries the system reads (`operationId`,
  // was `id`); a re-send's entry back as the legacy one the caller answers by.
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
      return fail(new StaffEditInvalidCommandError('operationId'));
    case LedgerVerdict.Replay:
      return ok({
        id: verdict.applied.operationId,
        revision: verdict.applied.revision,
        digest: verdict.applied.digest,
      });
  }
}

interface PlannedEdit {
  readonly request: DecideBookingRequest;
  readonly stored: readonly StoredSeat[];
  readonly next: readonly StoredSeat[];
  readonly overrides: ReadonlyMap<string, StaffTermsOverride>;
  readonly nextRevision: number;
  /** Carried so a refusal can still name which EDGE was being dragged. */
  readonly commands: readonly StaffEditCommand[];
  /** The bill's discounts after the batch — see `settleDiscount`. */
  readonly discounts: readonly AppliedDiscount[];
  /**
   * The pairs the visit's LAST save broke, when this edit is the write that
   * follows it (`liveStoodSeatPairs`) — they stand for this edit only.
   */
  readonly stood: readonly SeatIdPair[];
  /**
   * The pairs THIS batch breaks: stood in the stored visit, not in the
   * batch's result — a seat of the pair removed, or the two moved apart.
   * Remembered on the document for this save's undo.
   */
  readonly broken: readonly SeatIdPair[];
}

/** The batch's last word on the vouchers, normalised; `keep` when it said nothing. */
function pendingVouchersOf(
  commands: readonly StaffEditCommand[],
): PendingVouchers {
  const arm = [...commands]
    .reverse()
    .find(
      (command): command is Extract<StaffEditCommand, { kind: 'vouchers' }> =>
        command.kind === 'vouchers',
    );
  if (arm === undefined) return { kind: 'keep' };
  return {
    kind: 'set',
    codes: arm.codes.map((code) => Coupon.normalizeCode(code)),
  };
}

/** A typed manual figure → the domain's value, or `null` where its doors refuse it. */
function manualValue(
  raw: Extract<StaffDiscountRequest, { source: 'manual' }>['value'],
  currencyCode: string,
): CouponValue | null {
  if (raw.kind === 'percent_off') {
    const percent = CouponValue.percentOff(raw.percent);
    return percent.isSuccess() ? percent.value : null;
  }
  const money = Money.fromMinorUnitsAndCode(raw.amountMinorUnits, currencyCode);
  if (money.isFailure()) return null;
  const fixed = CouponValue.fixedAmount(money.value);
  return fixed.isSuccess() ? fixed.value : null;
}

/**
 * Shape-check the command before anything is read.
 *
 * Every field is checked as a primitive and nothing is coerced into
 * plausibility: a `redurate` of `"45"` is a caller bug, and rounding it into
 * existence is how a bug becomes a booking.
 */
function validateCommand(
  raw: unknown,
): Result<StaffEditCommand, StaffEditError> {
  const parses = (iso: unknown): boolean =>
    typeof iso === 'string' && Number.isFinite(Date.parse(iso));
  /*
   * Absent is the ordinary case — the whole party. PRESENT means the caller
   * named seats, so it must actually be a non-empty list of ids: an empty
   * array or a bare string would otherwise reach `applyCommand`, where a
   * string iterates into characters and an empty list would silently widen
   * back to everyone. Widening is the one outcome a scoped move must never
   * have — it is the bug the scope was added to fix.
   */
  const scopes = (ids: unknown): boolean =>
    ids === undefined ||
    (Array.isArray(ids) &&
      ids.length > 0 &&
      ids.every((id) => typeof id === 'string' && id.length > 0));
  const command = (raw ?? {}) as StaffEditCommand;

  switch (command.kind) {
    case 'move':
      if (!scopes(command.seatIds)) {
        return fail(new StaffEditInvalidCommandError('seatIds'));
      }
      return parses(command.startIso)
        ? ok(command)
        : fail(new StaffEditInvalidCommandError('startIso'));
    case 'resize':
      if (command.edge !== 'start' && command.edge !== 'end') {
        return fail(new StaffEditInvalidCommandError('edge'));
      }
      if (!scopes(command.seatIds)) {
        return fail(new StaffEditInvalidCommandError('seatIds'));
      }
      return parses(command.atIso)
        ? ok(command)
        : fail(new StaffEditInvalidCommandError('atIso'));
    case 'reprice':
      if (typeof command.seatId !== 'string' || command.seatId.length === 0) {
        return fail(new StaffEditInvalidCommandError('seatId'));
      }
      return Number.isInteger(command.priceMinorUnits) &&
        command.priceMinorUnits >= 0
        ? ok(command)
        : fail(new StaffEditInvalidCommandError('priceMinorUnits'));
    case 'addSeat': {
      const id = (value: unknown): value is string =>
        typeof value === 'string' && value.length > 0;
      if (!id(command.seatId)) {
        return fail(new StaffEditInvalidCommandError('seatId'));
      }
      if (!id(command.serviceId)) {
        return fail(new StaffEditInvalidCommandError('serviceId'));
      }
      if (!id(command.barberId)) {
        return fail(new StaffEditInvalidCommandError('barberId'));
      }
      if (!parses(command.startIso)) {
        return fail(new StaffEditInvalidCommandError('startIso'));
      }
      if (!Number.isInteger(command.minutes) || command.minutes <= 0) {
        return fail(new StaffEditInvalidCommandError('minutes'));
      }
      const subject = command.subject as { kind?: unknown; label?: unknown };
      const subjectOk =
        subject?.kind === 'self' ||
        (subject?.kind === 'guest' && id(subject.label));
      if (!subjectOk) {
        return fail(new StaffEditInvalidCommandError('subject'));
      }
      if (command.variantId !== undefined && command.variantId !== null) {
        if (!id(command.variantId)) {
          return fail(new StaffEditInvalidCommandError('variantId'));
        }
      }
      return ok(command);
    }
    case 'removeSeat':
      return typeof command.seatId === 'string' && command.seatId.length > 0
        ? ok(command)
        : fail(new StaffEditInvalidCommandError('seatId'));
    case 'relocate':
      return typeof command.locationId === 'string' &&
        command.locationId.length > 0
        ? ok(command)
        : fail(new StaffEditInvalidCommandError('locationId'));
    case 'discounts': {
      if (!Array.isArray(command.discounts)) {
        return fail(new StaffEditInvalidCommandError('discounts'));
      }
      const named = (value: unknown): value is string =>
        typeof value === 'string' && value.trim().length > 0;
      for (const raw of command.discounts) {
        const request = (raw ?? {}) as Partial<Record<string, unknown>>;
        switch (request['source']) {
          case 'grant':
            if (!named(request['grantId'])) {
              return fail(new StaffEditInvalidCommandError('discounts'));
            }
            break;
          case 'code':
            if (!named(request['code'])) {
              return fail(new StaffEditInvalidCommandError('discounts'));
            }
            break;
          case 'manual': {
            const value = (request['value'] ?? {}) as Record<string, unknown>;
            // Whole numbers only, in the domain's own ranges: a percent is
            // 1–100 and an amount is a positive count of minor units. Nothing
            // is rounded into plausibility — `12.5%` is a caller bug.
            const legal =
              (value['kind'] === 'percent_off' &&
                Number.isInteger(value['percent']) &&
                (value['percent'] as number) > 0 &&
                (value['percent'] as number) <= 100) ||
              (value['kind'] === 'fixed_amount' &&
                Number.isInteger(value['amountMinorUnits']) &&
                (value['amountMinorUnits'] as number) > 0);
            if (!legal) {
              return fail(new StaffEditInvalidCommandError('discounts'));
            }
            break;
          }
          default:
            return fail(new StaffEditInvalidCommandError('discounts'));
        }
      }
      return ok(command);
    }
    case 'vouchers': {
      if (!Array.isArray(command.codes)) {
        return fail(new StaffEditInvalidCommandError('vouchers'));
      }
      const codes = command.codes.map((code) =>
        typeof code === 'string' ? Coupon.normalizeCode(code) : '',
      );
      // No blanks, and no voucher twice: the second draw would be measured
      // against a balance the first already moved.
      if (codes.some((code) => code.length === 0)) {
        return fail(new StaffEditInvalidCommandError('vouchers'));
      }
      if (new Set(codes).size !== codes.length) {
        return fail(new StaffEditInvalidCommandError('vouchers'));
      }
      return ok(command);
    }
    case 'redurate':
      if (typeof command.seatId !== 'string' || command.seatId.length === 0) {
        return fail(new StaffEditInvalidCommandError('seatId'));
      }
      return Number.isInteger(command.minutes) && command.minutes > 0
        ? ok(command)
        : fail(new StaffEditInvalidCommandError('minutes'));
    case 'restaff':
      if (typeof command.seatId !== 'string' || command.seatId.length === 0) {
        return fail(new StaffEditInvalidCommandError('seatId'));
      }
      return typeof command.barberId === 'string' &&
        command.barberId.trim().length > 0
        ? ok(command)
        : fail(new StaffEditInvalidCommandError('barberId'));
    default:
      return fail(new StaffEditInvalidCommandError('kind'));
  }
}

/** What every command of one batch's fold reads besides the running seats. */
interface FoldContext {
  /** The visit is finished: a seat it gains was worked, not scheduled. */
  readonly finished: boolean;
  /**
   * Every seat id the STORED visit held before the batch — never the
   * running list. A seat id is a seat's identity: a pair the visit already
   * held stands by it (`StandingDoubleSeatings`), and so does every open
   * per-seat action on the sheet. A batch that removes a seat and adds one
   * under the same id would hand a NEW seat that identity — and with it the
   * standing of a pair it was never in — so an id the visit held is never
   * minted again by the batch that dropped it (round 6).
   */
  readonly held: ReadonlySet<string>;
}

/* ── The fold: `AppointmentEditSystem.applyCommand` (ECS Phase 2 shim) ──
 *
 * THIN SHIM. The fold's math — an unscoped move is the whole party by ONE
 * delta, a scoped edge measures from the SCOPE's own start, a resize acts on
 * the seats that OWN the dragged edge (the top handle holds the end), an
 * added seat is NEW (an id the stored visit held is never minted again) and
 * worked on a finished visit, a removed seat must be open and never the
 * last, a duration driven to zero is refused as `minutes` — is
 * `AppointmentEditSystem.applyCommand`. What follows only converts the
 * stored seats and the wire command to the ECS structs and back.
 */

/* ── The bill: `BillingSystem.settleDiscounts/settleVouchers` (ECS shim) ──
 * Converters only: the system settles, the legacy snapshots ride back. */

/*
 * Legacy ↔ ECS (flatten-spec §8.9): one table per dictionary, `Money` →
 * `*Cents` beside one `currency`, instants branded, the stored seats placed
 * on the wall clock of their own zone. A legacy instant already held is
 * never re-derived from the wall clock; only a seat the fold MOVED is
 * placed back on the timeline (`toUtc`).
 */

/** The legacy lower-case value tag → the ecs-core `DiscountMethod`. */
const LEGACY_DISCOUNT_METHOD = {
  percent_off: DiscountMethod.PercentOff,
  fixed_amount: DiscountMethod.FixedAmount,
  free_service: DiscountMethod.FreeService,
} as const satisfies Record<CouponValue['kind'], DiscountMethod>;

/** The ecs-core `DiscountSource` → the stored lower-case source. */
const DISCOUNT_SOURCE_LEGACY = {
  [DiscountSource.Grant]: 'grant',
  [DiscountSource.Code]: 'code',
  [DiscountSource.Manual]: 'manual',
} as const satisfies Record<DiscountSource, AppliedDiscount['source']>;

/** The batch's lower-case word on the bill → the ecs-core `BillPending`. */
const LEGACY_BILL_PENDING = {
  keep: BillPending.Keep,
  set: BillPending.Set,
} as const satisfies Record<PendingVouchers['kind'], BillPending>;

/** The wire's lower-case edge → the ecs-core `ResizeEdge`. */
const LEGACY_RESIZE_EDGE = {
  start: ResizeEdge.Start,
  end: ResizeEdge.End,
} as const satisfies Record<'start' | 'end', ResizeEdge>;

/** The stored lower-case status tag → the ecs-core `BookingStatus`. */
const LEGACY_BOOKING_STATUS = {
  pending: BookingStatus.Pending,
  confirmed: BookingStatus.Confirmed,
  completed: BookingStatus.Completed,
  no_show: BookingStatus.NoShow,
  cancelled: BookingStatus.Cancelled,
} as const satisfies Record<AppointmentStatus['kind'], BookingStatus>;

/** The stored lower-case barber preference → the ecs-core `BarberPreference`. */
const LEGACY_BARBER_PREFERENCE = {
  any: BarberPreference.Any,
  specific: BarberPreference.Specific,
} as const satisfies Record<'any' | 'specific', BarberPreference>;

/**
 * A stored status as the guard reads it. A status that is no lifecycle tag
 * is not one the guard refuses (it refuses `CANCELLED` and `NO_SHOW` only):
 * read as `CONFIRMED`, as the legacy guard let it through.
 */
function bookingStatusOf(kind: unknown): BookingStatus {
  return typeof kind === 'string' && Object.hasOwn(LEGACY_BOOKING_STATUS, kind)
    ? LEGACY_BOOKING_STATUS[kind as AppointmentStatus['kind']]
    : BookingStatus.Confirmed;
}

function instantOf(ms: number): UtcEpochMs | null {
  const instant = UtcEpochMs.of(ms);
  return instant.ok ? instant.value : null;
}

/** A legacy instant on the shop's wall clock in `zone` (T6); `null` for no instant. */
function wallOf(at: ZonedDateTime, zone: TimeZone): WallTime | null {
  const instant = instantOf(at.toMillis());
  return instant === null ? null : ZonedTimeSystem.toLocal(instant, zone);
}

/** A wire ISO instant on the shop's wall clock — to the nearest minute when `round`. */
function wallOfIso(
  iso: string,
  zone: TimeZone,
  round: boolean,
): WallTime | null {
  const ms = Date.parse(iso);
  const instant = instantOf(
    round ? Math.round(ms / MINUTE_MS) * MINUTE_MS : ms,
  );
  return instant === null ? null : ZonedTimeSystem.toLocal(instant, zone);
}

function toMoneyData(money: Money): MoneyData {
  const amountCents = PriceCents.of(money.toMinorUnits());
  const currency = Currency.parse(money.currencyCode());
  // Unreachable: a legacy `Money` is a non-negative amount in a known code.
  if (!amountCents.ok || !currency.ok) defect('unreachable: money');
  return { amountCents: amountCents.value, currency: currency.value };
}

function fromCents(amountCents: PriceCents, currency: Currency): Money {
  const result = Money.fromMinorUnitsAndCode(amountCents, currency);
  // Unreachable: every figure carries the visit's own, valid currency.
  if (result.isFailure()) defect('unreachable: bill currency');
  return result.value;
}

/** A legacy value as the flat slice — converted as it stands, never re-validated. */
function toValueData(value: CouponValue): CouponValueData {
  switch (value.kind) {
    case 'percent_off':
      return {
        discountMethod: LEGACY_DISCOUNT_METHOD.percent_off,
        discountPercent: value.percent,
      };
    case 'fixed_amount': {
      const money = toMoneyData(value.amount);
      return {
        discountMethod: LEGACY_DISCOUNT_METHOD.fixed_amount,
        discountAmountCents: money.amountCents,
        discountCurrency: money.currency,
      };
    }
    case 'free_service':
      return { discountMethod: LEGACY_DISCOUNT_METHOD.free_service };
  }
}

/**
 * One requested discount with what the resolver found, as the settle reads
 * it; `null` for a typed fixed figure that is no whole number of cents (the
 * settle refuses it as it refuses every figure it cannot value).
 */
function toPendingDiscountData(
  item: PendingDiscountItem,
  currency: Currency,
): PendingDiscount | null {
  const request = item.request;
  switch (request.source) {
    case 'grant': {
      const grant = item.grant ?? null;
      return {
        discountSource: DiscountSource.Grant,
        grantId: CouponGrantIdData.of(request.grantId),
        resolved:
          grant === null
            ? null
            : {
                grantId: CouponGrantIdData.of(grant.grantId),
                userId: UserIdData.of(grant.userId),
                label: grant.label,
                usable: grant.usable,
                exclusive: grant.exclusive,
                ...toValueData(grant.value),
              },
      };
    }
    case 'code': {
      const coupon = item.coupon ?? null;
      return {
        discountSource: DiscountSource.Code,
        code: request.code,
        resolved:
          coupon === null
            ? null
            : {
                couponId: CouponIdData.of(coupon.couponId),
                label: coupon.label,
                code: VoucherCodeData.of(coupon.code),
                exclusive: coupon.exclusive,
                ...toValueData(coupon.value),
              },
      };
    }
    case 'manual': {
      if (request.value.kind === 'percent_off') {
        return {
          discountSource: DiscountSource.Manual,
          value: {
            discountMethod: LEGACY_DISCOUNT_METHOD.percent_off,
            discountPercent: request.value.percent,
          },
        };
      }
      const amount = PriceCents.signed(request.value.amountMinorUnits);
      if (!amount.ok) return null;
      return {
        discountSource: DiscountSource.Manual,
        value: {
          discountMethod: LEGACY_DISCOUNT_METHOD.fixed_amount,
          discountAmountCents: amount.value,
          discountCurrency: currency,
        },
      };
    }
  }
}

/** The legacy value a NEW discount was settled from — the resolver's, or the typed figure. */
function legacyValueOf(
  item: PendingDiscountItem,
  currencyCode: string,
): CouponValue {
  const request = item.request;
  const value =
    request.source === 'grant'
      ? (item.grant?.value ?? null)
      : request.source === 'code'
        ? (item.coupon?.value ?? null)
        : manualValue(request.value, currencyCode);
  // Unreachable: the settle refused every item it could not value.
  if (value === null) defect('unreachable: an unvalued discount');
  return value;
}

/** A legacy voucher as the flat entity — its expiry's shop day on its own zone's clock (T5). */
function toVoucherData(voucher: GiftVoucher): GiftVoucherData {
  const state = voucher.state;
  const balance = toMoneyData(voucher.balance);
  const instant = (at: ZonedDateTime): UtcEpochMs => {
    const ms = instantOf(at.toMillis());
    // Unreachable: a legacy `ZonedDateTime` is an instant.
    if (ms === null) defect('unreachable: an instant');
    return ms;
  };
  const expiresLocalDate = (at: ZonedDateTime): LocalDate => {
    const zone = ZonedTimeSystem.checkZone(at.zoneName);
    // Unreachable: a legacy `ZonedDateTime` names a real zone.
    if (!zone.ok) defect('unreachable: a zone');
    return ZonedTimeSystem.toLocal(instant(at), zone.value).localDate;
  };
  return {
    id: GiftVoucherIdData.of(voucher.id.value),
    code: VoucherCodeData.of(voucher.code),
    initialValueCents: toMoneyData(voucher.initialValue).amountCents,
    balanceCents: balance.amountCents,
    currency: balance.currency,
    issuedAtUtcMs: instant(voucher.issuedAt),
    expiresAtUtcMs:
      voucher.expiresAt === null ? null : instant(voucher.expiresAt),
    expiresLocalDate:
      voucher.expiresAt === null ? null : expiresLocalDate(voucher.expiresAt),
    issuedToUserId:
      voucher.issuedToUserId === null
        ? null
        : UserIdData.of(voucher.issuedToUserId.value),
    ...(state.kind === 'void'
      ? VoucherLifecycle.voided(instant(state.voidedAt), state.reason)
      : VoucherLifecycle.active()),
  };
}

/** A stored pad as whole minutes — unreadable is none (the fold never reads it). */
function padOf(minutes: number): MinuteCount {
  const pad = MinuteCount.of(minutes);
  return pad.ok ? pad.value : MinuteCount.ZERO;
}

/**
 * The running seats on the shop's wall clock: their zone (the first seat's),
 * their day and its instant (the earliest seat's — the instant already held)
 * and every seat on that day (F-6). `null` when a seat cannot be read onto
 * the clock: no zone, no instant, a start off the day, a figure no brand
 * holds.
 */
interface SeatsOnTheClock {
  readonly zone: TimeZone;
  readonly localDate: LocalDate;
  readonly utcEpochMs: UtcEpochMs;
  readonly seats: readonly SeatData[];
}

function seatsOnTheClock(
  stored: readonly StoredSeat[],
): SeatsOnTheClock | null {
  const first = stored[0];
  if (first === undefined) return null;
  const zone = ZonedTimeSystem.checkZone(first.zone);
  if (!zone.ok) return null;
  let earliest = first.startMs;
  for (const seat of stored) {
    if (seat.startMs < earliest) earliest = seat.startMs;
  }
  const utcEpochMs = instantOf(earliest);
  if (utcEpochMs === null) return null;
  const localDate = ZonedTimeSystem.toLocal(utcEpochMs, zone.value).localDate;
  const seats: SeatData[] = [];
  for (const seat of stored) {
    const data = toSeatData(seat, zone.value, localDate);
    if (data === null) return null;
    seats.push(data);
  }
  return { zone: zone.value, localDate, utcEpochMs, seats };
}

/** The STORED visit's time slice — the envelope on its day, its start instant. */
function storedTimeOf(stored: readonly StoredSeat[]): TimeCoordinate | null {
  const clock = seatsOnTheClock(stored);
  if (clock === null) return null;
  const envelope = AppointmentIndexSystem.envelope(clock);
  if (envelope === null) return null;
  const startMinutes = MinuteOfDay.of(envelope.startMinutes);
  const endMinutes = EndMinute.of(envelope.endMinutes);
  if (!startMinutes.ok || !endMinutes.ok) return null;
  return {
    localDate: clock.localDate,
    startMinutes: startMinutes.value,
    endMinutes: endMinutes.value,
    utcEpochMs: clock.utcEpochMs,
  };
}

/** A stored seat → the ECS seat the fold reads (subject and outcome only ride along). */
function toSeatData(
  seat: StoredSeat,
  zone: TimeZone,
  localDate: LocalDate,
): SeatData | null {
  const at = instantOf(seat.startMs);
  const duration = DurationMinutes.of(seat.durationMinutes);
  const price = PriceCents.signed(seat.priceMinorUnits);
  const currency = Currency.parse(seat.currencyCode);
  if (at === null || !duration.ok || !price.ok || !currency.ok) return null;
  const wall = ZonedTimeSystem.toLocal(at, zone);
  // One shop day per appointment (F-6).
  if (wall.localDate !== localDate) return null;
  return SeatData.compose(
    {
      seatId: SeatIdData.of(seat.id),
      serviceId: ServiceIdData.of(seat.serviceId),
      variantId:
        seat.variantId === null
          ? null
          : ServiceVariantIdData.of(seat.variantId),
      barberId: BarberIdData.of(seat.barberId),
      barberPreference:
        seat.barberPref === undefined
          ? null
          : LEGACY_BARBER_PREFERENCE[seat.barberPref],
      startMinutes: wall.minute,
      tipCents: null,
    },
    {
      priceCents: price.value,
      currency: currency.value,
      durationMinutes: duration.value,
      setupMinutes: padOf(seat.setupMinutes),
      cleanupMinutes: padOf(seat.cleanupMinutes),
      catalogPriceCents: null,
      catalogDurationMinutes: null,
    },
    // The fold never reads who a seat is for; the stored subject rides
    // back from the original seat by id.
    SeatOccupant.anonymous(SeatLabelData.of(seat.id)),
    seat.outcome.kind === 'scheduled'
      ? SeatOutcomeData.scheduled()
      : SeatOutcomeData.worked(at),
  );
}

/**
 * A resize's END on the running day: an exclusive end, the day's closing
 * midnight included. An end at or before the day's start is a duration
 * driven to nothing (`minutes`); one past the closing midnight leaves the
 * day (`atIso`, F-6).
 */
function endMinuteOf(
  wall: WallTime,
  localDate: LocalDate,
): Result<EndMinute, StaffEditError> {
  const days = LocalDateData.daysBetween(localDate, wall.localDate);
  const minutes = days * 1440 + wall.minute;
  if (minutes <= 0) return fail(new StaffEditInvalidCommandError('minutes'));
  const end = EndMinute.of(minutes);
  return end.ok
    ? ok(end.value)
    : fail(new StaffEditInvalidCommandError('atIso'));
}

/** The wire command → the ECS command, its instants on the running day's wall clock. */
function toCommandData(
  command: StaffEditCommand,
  clock: SeatsOnTheClock,
): Result<EditCommandRequest, StaffEditError> {
  const scope = (ids: readonly string[] | undefined) =>
    ids === undefined ? null : ids.map((id) => SeatIdData.of(id));
  switch (command.kind) {
    case 'move': {
      const wall = wallOfIso(command.startIso, clock.zone, false);
      if (wall === null)
        return fail(new StaffEditInvalidCommandError('startIso'));
      return ok({
        editCommand: EditCommand.Move,
        localDate: wall.localDate,
        startMinutes: wall.minute,
        seatIds: scope(command.seatIds),
      });
    }
    case 'resize': {
      // The legacy fold measured a resize in WHOLE minutes, rounded once.
      const wall = wallOfIso(command.atIso, clock.zone, true);
      if (wall === null) return fail(new StaffEditInvalidCommandError('atIso'));
      if (command.edge === 'end') {
        const end = endMinuteOf(wall, clock.localDate);
        if (end.isFailure()) return fail(end.error);
        return ok({
          editCommand: EditCommand.Resize,
          resizeEdge: LEGACY_RESIZE_EDGE.end,
          atMinutes: end.value,
          seatIds: scope(command.seatIds),
        });
      }
      if (wall.localDate !== clock.localDate) {
        return fail(new StaffEditInvalidCommandError('atIso'));
      }
      return ok({
        editCommand: EditCommand.Resize,
        resizeEdge: LEGACY_RESIZE_EDGE.start,
        atMinutes: wall.minute,
        seatIds: scope(command.seatIds),
      });
    }
    case 'redurate': {
      const duration = DurationMinutes.of(command.minutes);
      if (!duration.ok)
        return fail(new StaffEditInvalidCommandError('minutes'));
      return ok({
        editCommand: EditCommand.Redurate,
        seatId: SeatIdData.of(command.seatId),
        durationMinutes: duration.value,
      });
    }
    case 'reprice': {
      const price = PriceCents.of(command.priceMinorUnits);
      if (!price.ok) {
        return fail(new StaffEditInvalidCommandError('priceMinorUnits'));
      }
      return ok({
        editCommand: EditCommand.Reprice,
        seatId: SeatIdData.of(command.seatId),
        priceCents: price.value,
      });
    }
    case 'restaff':
      return ok({
        editCommand: EditCommand.Restaff,
        seatId: SeatIdData.of(command.seatId),
        barberId: BarberIdData.of(command.barberId),
      });
    case 'addSeat': {
      const wall = wallOfIso(command.startIso, clock.zone, false);
      if (wall === null || wall.localDate !== clock.localDate) {
        return fail(new StaffEditInvalidCommandError('startIso'));
      }
      const duration = DurationMinutes.of(command.minutes);
      if (!duration.ok)
        return fail(new StaffEditInvalidCommandError('minutes'));
      // The instant the seat ends — the wire's own start instant plus its
      // minutes, on the absolute timeline (the legacy stamp), so a finished
      // visit's new seat is worked at the true instant whatever day the
      // batch moved it to and whatever transition lies between.
      const workedAt = instantOf(
        Date.parse(command.startIso) + duration.value * MINUTE_MS,
      );
      if (workedAt === null)
        return fail(new StaffEditInvalidCommandError('startIso'));
      return ok({
        editCommand: EditCommand.AddSeat,
        seatId: SeatIdData.of(command.seatId),
        serviceId: ServiceIdData.of(command.serviceId),
        variantId:
          command.variantId === undefined || command.variantId === null
            ? null
            : ServiceVariantIdData.of(command.variantId),
        barberId: BarberIdData.of(command.barberId),
        startMinutes: wall.minute,
        durationMinutes: duration.value,
        workedAtUtcMs: workedAt,
        ...SeatOccupant.anonymous(SeatLabelData.of(command.seatId)),
      });
    }
    case 'removeSeat':
      return ok({
        editCommand: EditCommand.RemoveSeat,
        seatId: SeatIdData.of(command.seatId),
      });
    case 'relocate':
      return ok({
        editCommand: EditCommand.Relocate,
        locationId: LocationIdData.of(command.locationId),
      });
    case 'discounts':
      return ok({ editCommand: EditCommand.Discounts });
    case 'vouchers':
      return ok({ editCommand: EditCommand.Vouchers });
  }
}

/**
 * Where a seat starts on the absolute timeline after the fold: the instant
 * it already held when the fold left it where it was, else its new wall
 * clock placed by the zone (`null` in a DST gap — no shop is open then).
 */
function startMsOf(
  seat: SeatData,
  localDate: LocalDate,
  clock: SeatsOnTheClock,
  original: StoredSeat | undefined,
): number | null {
  if (original !== undefined && localDate === clock.localDate) {
    const before = clock.seats.find((entry) => entry.seatId === seat.seatId);
    if (before !== undefined && before.startMinutes === seat.startMinutes) {
      return original.startMs;
    }
  }
  const instant = ZonedTimeSystem.toUtc(
    localDate,
    seat.startMinutes,
    clock.zone,
  );
  return instant.ok ? instant.value : null;
}

/**
 * The ECS seat the fold returned → the stored seat: the original by id with
 * the fold's geometry, price and chair on it, or — for a seat the command
 * ADDED — a fresh one on the visit's zone and currency, not yet priced.
 */
function fromSeatData(
  seat: SeatData,
  localDate: LocalDate,
  clock: SeatsOnTheClock,
  originals: readonly StoredSeat[],
  command: StaffEditCommand,
): Result<StoredSeat, StaffEditError> {
  const original = originals.find((entry) => entry.id === seat.seatId);
  const startMs = startMsOf(seat, localDate, clock, original);
  if (startMs === null)
    return fail(new StaffEditInvalidCommandError('startIso'));
  if (original !== undefined) {
    return ok({
      ...original,
      barberId: seat.barberId,
      startMs,
      durationMinutes: seat.durationMinutes,
      priceMinorUnits: seat.priceCents,
    });
  }
  const template = originals[0] as StoredSeat;
  return ok({
    id: seat.seatId,
    serviceId: seat.serviceId,
    variantId: seat.variantId,
    barberId: seat.barberId,
    zone: template.zone,
    startMs,
    durationMinutes: seat.durationMinutes,
    priceMinorUnits: 0,
    currencyCode: template.currencyCode,
    setupMinutes: 0,
    cleanupMinutes: 0,
    outcome:
      seat.attendanceState === AttendanceState.Worked
        ? { kind: 'worked', atMs: seat.workedAtUtcMs }
        : SEAT_SCHEDULED,
    tipMinorUnits: null,
    subject: command.kind === 'addSeat' ? command.subject : { kind: 'self' },
    fresh: true,
  });
}

/** The command, applied to the running seats — `AppointmentEditSystem.applyCommand`. */
function applyCommand(
  stored: readonly StoredSeat[],
  command: StaffEditCommand,
  fold: FoldContext,
): Result<readonly StoredSeat[], StaffEditError> {
  const clock = seatsOnTheClock(stored);
  if (clock === null) return fail(new StaffEditInvalidCommandError('seats'));
  const request = toCommandData(command, clock);
  if (request.isFailure()) return fail(request.error);
  const applied = AppointmentEditSystem.applyCommand(
    { localDate: clock.localDate, seats: clock.seats },
    request.value,
    {
      finished: fold.finished,
      held: [...fold.held].map((id) => SeatIdData.of(id)),
    },
  );
  if (!applied.ok) {
    return fail(new StaffEditInvalidCommandError(applied.error.field));
  }
  const next: StoredSeat[] = [];
  for (const seat of applied.value.seats) {
    const back = fromSeatData(
      seat,
      applied.value.localDate,
      clock,
      stored,
      command,
    );
    if (back.isFailure()) return fail(back.error);
    next.push(back.value);
  }
  return ok(next);
}

function idsOf(seats: readonly StoredSeat[]): ReadonlySet<string> {
  return new Set(seats.map((seat) => seat.id));
}

/**
 * A decision's refusal → what the sheet can act on.
 *
 * Only one is rewritten, and it is the only one that is an OFFER: with the
 * window check switched off for staff, a `slot_unavailable` can mean nothing
 * but a collision — so it becomes the acknowledgeable overlap, carrying the
 * edge that a resize can name and a move cannot. Everything else keeps the
 * commit path's code, because the sheet has nothing different to say about a
 * service that vanished or a store that would not write.
 */
function translateRefusal(
  error: CommitBookingError,
  commands: readonly StaffEditCommand[],
): StaffEditError {
  if (error.code !== 'booking.commit.slot_unavailable') return error;
  /*
   * The edge names WHICH HANDLE the barber was dragging, so the sheet can
   * say "this end will not fit" rather than "it will not fit". A batch has
   * no single handle: only a lone resize can name one, and a save that
   * happens to contain a resize was not dragged at all.
   */
  const only = commands.length === 1 ? commands[0] : undefined;
  return new StaffEditOverlapError(
    only?.kind === 'resize' ? only.edge : null,
    String(error.params['barberId'] ?? ''),
    String(error.params['startIso'] ?? ''),
  );
}
