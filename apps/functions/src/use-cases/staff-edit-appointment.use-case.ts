import {
  Money,
  Result,
  ZonedDateTime,
  fail,
  ok,
} from '@creativo/domain/kernel';
import type { Transaction } from 'firebase-admin/firestore';
import { handlesMoney, worksTheBook } from '@creativo/domain/accounts';
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
  type SeatOutcome,
  VoucherRedemption,
} from '@creativo/domain/scheduling';
import type { ClockPort } from '@creativo/application/shared';
import type {
  StaffDiscountRequest,
  StaffEditCommand,
} from '@creativo/application/booking';
import {
  arrivedAtFromDocument,
  bookedAtFromDocument,
  contactFromDocument,
  discountsFromDocument,
  type PersistedDocument,
  preservedAppointmentFields,
  revisionOf,
  seatOutcomeFromDocument,
  seatTipFromDocument,
  voucherRedemptionsFromDocument,
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
} from './decide-booking';
import {
  type StaffEditError,
  StaffEditBeforeArrivalError,
  StaffEditForbiddenError,
  StaffEditInvalidCommandError,
  StaffEditOverlapError,
  StaffEditStaleError,
  StaffEditUnauthenticatedError,
} from './staff-edit-appointment.errors';

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
   * The revision the sheet was drawn from, when it has one.
   *
   * Absent means the caller makes no claim about what it read and is not
   * refused for it — a chip that pushes a running-late visit by ten minutes
   * has no draft to be stale.
   */
  readonly expectedVersion?: number | null;
}

export interface StaffEditResult {
  readonly appointmentId: string;
  /** What the sheet should send as `expectedVersion` on its next save. */
  readonly revision: number;
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
    if (subject['relationship'] !== 'self') return null;
    requested = { kind: 'self' };
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

    /**
     * What `plan` worked out, read back by `decide`.
     *
     * Local to the call and reassigned on every attempt, which is what makes
     * it safe: a Firestore transaction can retry, and `plan` runs first on
     * each attempt, so `decide` can never see a previous attempt's numbers.
     */
    let planned: PlannedEdit | null = null;
    let nextRevision = 0;
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
        const result = this.plan(
          input.appointmentId,
          current,
          commands,
          input.expectedVersion,
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
          return fail(new CommitBookingInvalidInputError('command'));
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
      (current) => ({
        ...preservedAppointmentFields(current),
        revision: revisionOf(current) + 1,
      }),
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
    return ok({ appointmentId: input.appointmentId, revision: nextRevision });
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
    // A seat added to a FINISHED visit was worked, not scheduled: the sheet
    // is being filled in after the cut (owner, 2026-09-09).
    const finished = rootStatus?.kind === 'completed';
    for (const command of commands) {
      // Discounts and vouchers are facts about the BILL, settled elsewhere;
      // the seats do not change under them.
      if (command.kind === 'discounts' || command.kind === 'vouchers') continue;
      const applied = applyCommand(next, command, finished);
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
        locationId: String(current['locationId'] ?? ''),
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

    const settled: AppliedDiscount[] = [];
    let manualCount = 0;
    for (const item of pending.items) {
      const request = item.request;
      switch (request.source) {
        case 'grant': {
          const kept = existing.find(
            (discount) =>
              discount.source === 'grant' &&
              discount.grantId === request.grantId,
          );
          if (kept) {
            settled.push(kept);
            break;
          }
          const grant = item.grant ?? null;
          const owner = current['ownerUserId'];
          if (
            grant === null ||
            !grant.usable ||
            typeof owner !== 'string' ||
            owner !== grant.userId
          ) {
            return fail(new StaffEditInvalidCommandError('discounts'));
          }
          settled.push(
            AppliedDiscount.of({
              id: `grant:${grant.grantId}`,
              source: 'grant',
              label: grant.label,
              value: grant.value,
              grantId: grant.grantId,
              appliedAt: now.value,
              combinability: grant.exclusive
                ? CouponCombinability.exclusive()
                : CouponCombinability.stackable(),
            }),
          );
          break;
        }
        case 'code': {
          const code = Coupon.normalizeCode(request.code);
          const kept = existing.find(
            (discount) => discount.source === 'code' && discount.code === code,
          );
          if (kept) {
            settled.push(kept);
            break;
          }
          const coupon = item.coupon ?? null;
          if (coupon === null) {
            return fail(new StaffEditInvalidCommandError('discounts'));
          }
          settled.push(
            AppliedDiscount.of({
              id: `code:${coupon.couponId}`,
              source: 'code',
              label: coupon.label,
              value: coupon.value,
              code: coupon.code,
              appliedAt: now.value,
              combinability: coupon.exclusive
                ? CouponCombinability.exclusive()
                : CouponCombinability.stackable(),
            }),
          );
          break;
        }
        case 'manual': {
          manualCount += 1;
          const value = manualValue(request.value, template.currencyCode);
          if (value === null) {
            return fail(new StaffEditInvalidCommandError('discounts'));
          }
          const kept = existing.find(
            (discount) =>
              discount.source === 'manual' &&
              discount.value.kind === value.kind &&
              CouponValue.magnitude(discount.value) ===
                CouponValue.magnitude(value),
          );
          if (kept) {
            settled.push(kept);
            break;
          }
          // A barber may stretch his own time; he may not discount the shop's
          // money. Refused as FORBIDDEN, not as a bad command — the shape was
          // fine, the caller was not.
          if (!handlesMoney(actorRoles)) {
            return fail(new StaffEditForbiddenError());
          }
          settled.push(
            AppliedDiscount.of({
              id: 'manual',
              source: 'manual',
              // No name to give: the receipt renders a manual discount by its
              // value, and the source already says what it is.
              label: 'manual',
              value,
              appliedAt: now.value,
            }),
          );
          break;
        }
      }
    }

    if (manualCount > 1 || !AppliedDiscount.isLegalSet(settled)) {
      return fail(new StaffEditInvalidCommandError('discounts'));
    }
    return ok(settled);
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
    const stored = voucherRedemptionsFromDocument(current);
    const live = stored.filter((redemption) => redemption.live);
    const codes =
      pending.kind === 'set'
        ? pending.codes.map((code) => Coupon.normalizeCode(code))
        : live.map((redemption) => redemption.code);
    if (live.length === 0 && codes.length === 0) {
      return ok({ appointment, touched: [] });
    }

    const currency = appointment.subtotal().currencyCode();
    const zero = Money.fromMinorUnitsAndCode(0, currency);
    if (zero.isFailure())
      return fail(new CommitBookingInvalidInputError('seats'));
    const money = (minor: number): Money => {
      const result = Money.fromMinorUnitsAndCode(minor, currency);
      return result.isSuccess() ? result.value : zero.value;
    };
    const byId = new Map(
      vouchers.map((voucher) => [voucher.id.value, voucher]),
    );
    const byCode = new Map(vouchers.map((voucher) => [voucher.code, voucher]));
    const touched = new Map<string, GiftVoucher>();
    const history = stored.filter((redemption) => !redemption.live);

    // 1. Give back what is no longer named — or what a bill no longer needs.
    for (const prior of live) {
      if (codes.includes(prior.code)) continue;
      const voucher = byId.get(prior.voucherId) ?? byCode.get(prior.code);
      if (voucher !== undefined) {
        const settled = voucher.settle(prior.amount, zero.value);
        if (settled.isFailure()) {
          return fail(new StaffEditInvalidCommandError('vouchers'));
        }
        touched.set(voucher.id.value, settled.value);
      }
      history.push(prior.reversed(now));
    }

    // 2. Cover the bill in order.
    let due = appointment.total().toMinorUnits();
    const next: VoucherRedemption[] = [];
    for (const code of codes) {
      const voucher = byCode.get(code);
      if (voucher === undefined) {
        return fail(new StaffEditInvalidCommandError('vouchers'));
      }
      const prior = live.find(
        (redemption) => redemption.voucherId === voucher.id.value,
      );
      if (prior === undefined && voucher.refusal(now) !== null) {
        return fail(new StaffEditInvalidCommandError('vouchers'));
      }
      const previous = prior?.amount ?? zero.value;
      const available =
        voucher.balance.toMinorUnits() + previous.toMinorUnits();
      const cover = Math.max(0, Math.min(available, due));
      const settled = voucher.settle(previous, money(cover));
      if (settled.isFailure()) {
        return fail(new StaffEditInvalidCommandError('vouchers'));
      }
      touched.set(voucher.id.value, settled.value);
      if (cover === 0) {
        // Nothing left for it to cover: it is not on the bill, and if it
        // was, its line closes as history.
        if (prior !== undefined) history.push(prior.reversed(now));
        continue;
      }
      next.push(
        VoucherRedemption.of({
          voucherId: voucher.id.value,
          code: voucher.code,
          amount: money(cover),
          balanceAfter: settled.value.balance,
          appliedAt: prior?.appliedAt ?? now,
        }),
      );
      due -= cover;
    }

    return ok({
      appointment: appointment.withVoucherRedemptions([...history, ...next]),
      touched: [...touched.values()],
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

    const status = (current['status'] ?? {}) as AppointmentStatus;
    // A visit that NEVER HAPPENED — cancelled, or a no-show — is history and
    // has nothing to correct. A FINISHED one is not (owner, 2026-09-09): the
    // barber who had no time for the sheet mid-cut updates the services, the
    // length, the price after the fact, and the book must take it. It used
    // to refuse everything `canTransition(_, 'cancelled')` refused, which
    // lumped the two together.
    if (status.kind === 'cancelled' || status.kind === 'no_show') {
      return fail(new CommitBookingInvalidInputError('status'));
    }

    const arrivedAt = arrivedAtFromDocument(current);
    if (arrivedAt !== null) {
      const finish = Math.max(...planned.next.map(endMs));
      if (finish <= arrivedAt.toMillis()) {
        // A DATA-INTEGRITY refusal, not a scheduling one: nothing is wrong
        // with the chair, but the visit would claim to have ended before the
        // client walked in. The stamp is the fact that cannot move.
        const finishIso = ZonedDateTime.fromMillis(finish, snapshot.zone);
        return fail(
          new StaffEditBeforeArrivalError(
            finishIso.isSuccess() ? finishIso.value.toISO() : String(finish),
            arrivedAt.toISO(),
          ),
        );
      }
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
      // Acknowledged, and only acknowledged.
      allowOverlap: input.acknowledgedOverlap === true,
      termsOverrides: planned.overrides,
    });
    if (decided.isFailure()) {
      return fail(translateRefusal(decided.error, planned.commands));
    }

    // Per-seat outcomes are restored by INDEX, which is exact: the decision
    // consumed `request.seats` in order and `request.seats` was built from
    // `planned.next` in order.
    const seats = decided.value.appointment.seats.map((seat, index) =>
      Seat.of({
        id: seat.id,
        subject: seat.subject,
        serviceId: seat.serviceId,
        variantId: seat.variantId,
        barberId: seat.barberId,
        terms: seat.terms,
        catalogTerms: seat.catalogTerms,
        startsAt: seat.startsAt,
        pref: seat.pref,
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

/**
 * The command, applied to the stored seats.
 *
 * ### Which seats an edge belongs to
 * An UNSCOPED `move` is the whole party: every seat shifts by one delta, so
 * the arrangement the shop offered — two guests in parallel, or one barber
 * back to back — is preserved exactly. A move carrying `seatIds` shifts only
 * those, which is how one barber leaves a party without taking the rest of it
 * with them; the delta is then measured from the SCOPE's own start, so the
 * seat lands where it was dropped rather than where the party begins.
 *
 * A `resize` acts on the seats that OWN the edge being dragged: the ones
 * starting at the scope's start, or ending at its end. Two guests
 * finishing together both extend when the bottom handle is pulled down; the
 * last leg of a sequential chain extends alone. Anything else would either
 * silently stretch a leg nobody touched or refuse a gesture the frame draws.
 */
function applyCommand(
  stored: readonly StoredSeat[],
  command: StaffEditCommand,
  finished = false,
): Result<readonly StoredSeat[], StaffEditError> {
  switch (command.kind) {
    case 'move': {
      const scoped = scopeOf(stored, command.seatIds);
      if (scoped.isFailure()) return scoped;
      const scope = scoped.value;
      // The delta is measured from the SCOPE's start, so a seat dragged to
      // 17:00 lands at 17:00 whether or not a sibling in another chair starts
      // earlier. Measuring from the party envelope is what made a scoped move
      // land in the wrong place the moment the seats were not aligned.
      const delta = Date.parse(command.startIso) - startOf(scope);
      const inScope = idsOf(scope);
      return ok(
        stored.map((seat) =>
          inScope.has(seat.id)
            ? { ...seat, startMs: seat.startMs + delta }
            : seat,
        ),
      );
    }
    case 'resize': {
      const scoped = scopeOf(stored, command.seatIds);
      if (scoped.isFailure()) return scoped;
      const scope = scoped.value;
      const inScope = idsOf(scope);

      if (command.edge === 'end') {
        const scopeEnd = endOf(scope);
        const deltaMinutes = Math.round(
          (Date.parse(command.atIso) - scopeEnd) / MINUTE_MS,
        );
        return reshape(stored, (seat) =>
          inScope.has(seat.id) && endMs(seat) === scopeEnd
            ? { ...seat, durationMinutes: seat.durationMinutes + deltaMinutes }
            : seat,
        );
      }
      // The top handle HOLDS THE END: the start moves and the duration
      // absorbs it. "I'll start ten minutes later but still finish at eleven"
      // is one gesture and two written values, which is exactly why a resize
      // cannot be a patch of one timestamp.
      const scopeStart = startOf(scope);
      const at = Date.parse(command.atIso);
      const deltaMinutes = Math.round((at - scopeStart) / MINUTE_MS);
      return reshape(stored, (seat) =>
        inScope.has(seat.id) && seat.startMs === scopeStart
          ? {
              ...seat,
              startMs: at,
              durationMinutes: seat.durationMinutes - deltaMinutes,
            }
          : seat,
      );
    }
    case 'redurate':
      return reshapeSeat(stored, command.seatId, (seat) => ({
        ...seat,
        durationMinutes: command.minutes,
      }));
    case 'reprice':
      return reshapeSeat(stored, command.seatId, (seat) => ({
        ...seat,
        priceMinorUnits: command.priceMinorUnits,
      }));
    case 'restaff':
      return reshapeSeat(stored, command.seatId, (seat) => ({
        ...seat,
        barberId: command.barberId,
      }));
    case 'addSeat': {
      if (stored.some((seat) => seat.id === command.seatId)) {
        return fail(new StaffEditInvalidCommandError('seatId'));
      }
      // The zone and currency are the appointment's, read off any seat it
      // already holds; a batch cannot add to an empty visit (`plan` refuses
      // one before it gets here).
      const template = stored[0];
      if (!template) return fail(new StaffEditInvalidCommandError('seats'));
      return ok([
        ...stored,
        {
          id: command.seatId,
          serviceId: command.serviceId,
          variantId: command.variantId ?? null,
          barberId: command.barberId,
          zone: template.zone,
          startMs: Date.parse(command.startIso),
          durationMinutes: command.minutes,
          priceMinorUnits: 0,
          currencyCode: template.currencyCode,
          setupMinutes: 0,
          cleanupMinutes: 0,
          // On a finished visit the new seat is history the moment it is
          // written — worked, stamped at its own end.
          outcome: finished
            ? {
                kind: 'worked',
                atMs: Date.parse(command.startIso) + command.minutes * 60_000,
              }
            : SEAT_SCHEDULED,
          tipMinorUnits: null,
          subject: command.subject,
          fresh: true,
        },
      ]);
    }
    case 'removeSeat': {
      const target = stored.find((seat) => seat.id === command.seatId);
      if (!target) return fail(new StaffEditInvalidCommandError('seatId'));
      // A seat somebody already sat in (or was charged for, or cancelled out
      // of) is history, not a line to delete; and a visit with no seats is
      // not a visit — that is a cancellation, which has its own path.
      if (target.outcome.kind !== 'scheduled' || stored.length === 1) {
        return fail(new StaffEditInvalidCommandError('seatId'));
      }
      return ok(stored.filter((seat) => seat !== target));
    }
    case 'discounts':
    case 'vouchers':
      // Not seat edits — the bill's, settled outside the fold, which skips
      // them. Listed so the switch stays exhaustive.
      return ok(stored);
  }
}

/**
 * The seats a scoped edge acts on — every stored seat when unscoped.
 *
 * An unknown or empty id list is refused rather than silently widened to the
 * whole party: a caller that named seats meant to name them, and quietly
 * moving everyone because one id was stale is the failure mode this arm
 * exists to prevent.
 */
function scopeOf(
  stored: readonly StoredSeat[],
  seatIds: readonly string[] | undefined,
): Result<readonly StoredSeat[], StaffEditError> {
  // Shape is `validateCommand`'s job and has already been settled; what is
  // left is whether these ids are seats of THIS appointment.
  if (seatIds === undefined) return ok(stored);
  const wanted = new Set(seatIds);
  const scope = stored.filter((seat) => wanted.has(seat.id));
  return scope.length === wanted.size
    ? ok(scope)
    : fail(new StaffEditInvalidCommandError('seatIds'));
}

function idsOf(seats: readonly StoredSeat[]): ReadonlySet<string> {
  return new Set(seats.map((seat) => seat.id));
}

function startOf(seats: readonly StoredSeat[]): number {
  return Math.min(...seats.map((seat) => seat.startMs));
}

function endOf(seats: readonly StoredSeat[]): number {
  return Math.max(...seats.map(endMs));
}

/** Map every seat, refusing a duration the edit drove to zero or below. */
function reshape(
  stored: readonly StoredSeat[],
  map: (seat: StoredSeat) => StoredSeat,
): Result<readonly StoredSeat[], StaffEditError> {
  const next = stored.map(map);
  // Not `invalid_range` — there is no range. The end is DERIVED, so the only
  // thing that can be wrong is the duration, and that is what is named.
  return next.every(
    (seat) =>
      Number.isInteger(seat.durationMinutes) && seat.durationMinutes > 0,
  )
    ? ok(next)
    : fail(new StaffEditInvalidCommandError('minutes'));
}

/** The same, for the commands that name one seat. */
function reshapeSeat(
  stored: readonly StoredSeat[],
  seatId: string,
  map: (seat: StoredSeat) => StoredSeat,
): Result<readonly StoredSeat[], StaffEditError> {
  if (!stored.some((seat) => seat.id === seatId)) {
    return fail(new StaffEditInvalidCommandError('seatId'));
  }
  return reshape(stored, (seat) => (seat.id === seatId ? map(seat) : seat));
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
