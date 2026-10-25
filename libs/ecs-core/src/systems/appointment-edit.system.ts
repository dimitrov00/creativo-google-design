import {
  type AccountOccupant,
  AppliedOperation,
  AuditAction,
  BillPending,
  type BookingCall,
  BookingLifecycle,
  EditCommand,
  LedgerVerdict,
  RequestedSubjectRole,
  ResizeEdge,
  SeatLabel,
  SeatOutcome,
  Seat,
  SeatOccupant,
  SeatSubject,
  type StaffEditAction,
  StaffTermsOverride,
  SubjectRelationship,
  type VoucherCode,
  type WallTime,
} from '@core/components';
import {
  BookingStatus,
  Result,
  AttendanceState,
  DurationMinutes,
  MinuteCount,
  type BarberId,
  type CustomerId,
  defect,
  type LocationId,
  type OperationId,
  type SeatId,
  SeatKeyText,
  type UserId,
  LocalDate,
  EndMinute,
  MinuteOfDay,
  PriceCents,
} from '@core/primitives';
import {
  BookingError,
  StaffEditError,
  type StaffEditGuardRefusal,
  type StaffEditInvalidCommand,
  type StaffEditOverlaps,
  type StaffEditStale,
} from '@core/errors';
import type { Appointment } from '@core/entities';
import type { PendingVouchers } from './billing.system';
import { SeatingRuleSystem } from './seating-rule.system';

/** The digest basis version — the server's fingerprint of one intent's batch. */
const DIGEST_TAG = 'staff-operation/v1';

/** The hex digits of the batch's hash a ledger keeps — {@link AppointmentEditSystem.digestOf}. */
const DIGEST_LENGTH = 16;

/** The staff verb each lone command is audited under ({@link AppointmentEditSystem.auditVerb}). */
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

/**
 * One staff edit, as the fold applies it — the call's `BookingCall.EditCommand`
 * with its times on the shop's wall clock (the call sends `localDate` +
 * minutes; the boundary computes the instants it needs once, with the
 * location's zone) and every field present
 * (`seatIds: null` is the whole party). A `MOVE` names the day it moves to
 * (`localDate`, the same day for a same-day drag); a `RESIZE` names the
 * minute its edge lands on (an exclusive end for `END`, measured from the
 * running day). `ADD_SEAT` carries the new seat's occupant slice flat.
 * `DISCOUNTS` / `VOUCHERS` / `RELOCATE` are facts about the BILL and the
 * PLACE: the fold carries them past the seats (BillingSystem and the
 * pipeline settle them).
 *
 * Where an arm IS the call's, it is the call's type (P-1: never declared
 * twice); the arms that genuinely differ — the resizes, the added seat, the
 * payload-less bill arms — are declared once in `edit-command.data.ts`.
 */
export type EditCommandRequest =
  | BookingCall.EditCommand.Move
  | EditCommand.ResizeStartRequest
  | EditCommand.ResizeEndRequest
  | BookingCall.EditCommand.Reprice
  | BookingCall.EditCommand.Redurate
  | BookingCall.EditCommand.Restaff
  | EditCommand.AddSeatRequest
  | BookingCall.EditCommand.RemoveSeat
  | BookingCall.EditCommand.Relocate
  | EditCommand.DiscountsRequest
  | EditCommand.VouchersRequest;

/**
 * A batch as {@link AppointmentEditSystem.foldCommands} leaves it: the
 * outcome of the fold, and every command as the boundary resolved it, in
 * the caller's order (what the audit planner reads).
 */
export type FoldedBatch = EditOutcome & {
  readonly requests: readonly EditCommandRequest[];
};

/**
 * The boundary's reading of ONE call command on the running draft's clock
 * (Law 7.3) — the only zone-dependent step of a fold: it refuses a wall
 * clock the target shop's zone never shows and computes the instants the
 * request carries (an added seat's `workedAtUtcMs`), handing back the
 * request the fold applies. `runningDay` is the day the commands before it
 * left the visit on.
 */
export type EditCommandResolver<C, E> = (
  command: C,
  runningDay: LocalDate,
) => Result<EditCommandRequest, E>;

/** The command slice the batch-wide readers below need — any arm of the call or of the fold's input. */
type AnyEditCommand = BookingCall.EditCommand | EditCommandRequest;

/**
 * What one batch's fold reads besides the running seats
 * (`staff-edit-appointment.use-case.ts:1481-1497`) — derived from the
 * STORED visit by {@link AppointmentEditSystem.foldContextOf}, with the
 * client records the pipeline resolved.
 */
export type FoldContext = {
  /** The visit is finished: a seat it gains was worked, not scheduled. */
  readonly finished: boolean;
  /**
   * Every seat id the STORED visit held — never the running list: an id the
   * visit held is never minted again by the batch that dropped it.
   */
  readonly held: readonly SeatId[];
  /**
   * The client record of every account an added seat names (D29) —
   * resolved by the pipeline (`CustomerId.forUser(uid, hash)` for each of
   * {@link AppointmentEditSystem.addedAccounts}); never a hash here.
   */
  readonly customerIds: ReadonlyMap<UserId, CustomerId>;
};

/** The running visit a batch folds over: its shop day and its seats on it. */
export type EditDraft = {
  readonly localDate: LocalDate;
  readonly seats: readonly Seat[];
};

/** What a fold leaves: the seats as the batch drafted them, the day, and where. */
export type EditOutcome = {
  readonly localDate: LocalDate;
  readonly seats: readonly Seat[];
  /** Seats added in THIS batch and not yet priced — the decision prices them from the catalogue. */
  readonly freshSeatIds: readonly SeatId[];
  /** The shop the batch moves the visit to (the last `RELOCATE`), else the one it is at. */
  readonly locationId: LocationId;
};

/**
 * {@link AppointmentEditSystem.ledgerVerdict}'s answer — the ledger's verdict
 * (`LedgerVerdict`, a component) and, on a replay, the entry it applied.
 */
export type LedgerVerdictResult =
  | { readonly ledgerVerdict: typeof LedgerVerdict.New }
  | {
      readonly ledgerVerdict: typeof LedgerVerdict.Replay;
      readonly applied: AppliedOperation;
    }
  | { readonly ledgerVerdict: typeof LedgerVerdict.Mismatch };

function invalid(field: string): Result.Err<StaffEditInvalidCommand> {
  return Result.err(StaffEditError.invalidCommand(field));
}

function includesId(ids: readonly SeatId[], id: SeatId): boolean {
  for (let i = 0; i < ids.length; i++) {
    if (ids[i] === id) return true;
  }
  return false;
}

function hasSeat(seats: readonly Seat[], id: SeatId): boolean {
  for (let i = 0; i < seats.length; i++) {
    if ((seats[i] as Seat).seatId === id) return true;
  }
  return false;
}

/**
 * The seats a scoped edge acts on — every seat when unscoped. An unknown id,
 * or an empty list, is refused rather than silently widened to the party.
 */
function scopeOf(
  seats: readonly Seat[],
  seatIds: readonly SeatId[] | null,
): Result<readonly Seat[], StaffEditInvalidCommand> {
  if (seatIds === null) return Result.ok(seats);
  // A caller that named seats meant to name some: an empty list is never
  // widened back to the whole party.
  if (seatIds.length === 0) return invalid('seatIds');
  const wanted: SeatId[] = [];
  for (let i = 0; i < seatIds.length; i++) {
    const id = seatIds[i] as SeatId;
    if (!includesId(wanted, id)) wanted.push(id);
  }
  const scope: Seat[] = [];
  for (let i = 0; i < seats.length; i++) {
    const seat = seats[i] as Seat;
    if (includesId(wanted, seat.seatId)) scope.push(seat);
  }
  return scope.length === wanted.length ? Result.ok(scope) : invalid('seatIds');
}

/**
 * The seat an `ADD_SEAT` names, its occupant resolved: an account carries
 * its client record beside it (D29) — the map names every account of
 * {@link AppointmentEditSystem.addedAccounts}, so a miss is the caller's
 * defect, never a refusal.
 */
function addedOccupant(
  occupant: AccountOccupant,
  customerIds: ReadonlyMap<UserId, CustomerId>,
): SeatOccupant {
  if (occupant.seatSubject === SeatSubject.Anonymous) {
    return SeatOccupant.anonymous(occupant.guestLabel);
  }
  return SeatOccupant.account(
    occupant.subjectUserId,
    customerIds.get(occupant.subjectUserId) ??
      defect('an added account seat without its resolved client record (D29)'),
    occupant.subjectRelationship,
  );
}

/**
 * A FINISHED visit — the one root status under which a seat it gains is
 * worked the moment it is written, so its removal is refused (the
 * after-the-cut flow, owner 2026-09-09). Read by the fold's context and by
 * {@link AppointmentEditSystem.undoable}: one rule.
 */
function isFinished(status: BookingStatus): boolean {
  return status === BookingStatus.Completed;
}

/** The last arm of `commands` that `pick` answers, or `null` when none does. */
function lastOf<C, T>(
  commands: readonly C[],
  pick: (command: C) => T | null,
): T | null {
  let last: T | null = null;
  for (let i = 0; i < commands.length; i++) {
    const picked = pick(commands[i] as C);
    if (picked !== null) last = picked;
  }
  return last;
}

/** The earliest start of a non-empty scope. */
function startOf(seats: readonly Seat[]): number {
  let start = Number.POSITIVE_INFINITY;
  for (let i = 0; i < seats.length; i++) {
    const seat = seats[i] as Seat;
    if (seat.startMinutes < start) start = seat.startMinutes;
  }
  return start;
}

/** The latest end of a non-empty scope. */
function endOf(seats: readonly Seat[]): number {
  let end = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < seats.length; i++) {
    const seatEnd = Seat.endMinutes(seats[i] as Seat);
    if (seatEnd > end) end = seatEnd;
  }
  return end;
}

/**
 * A seat re-placed on its day: a new start and duration that must stay
 * whole minutes on ONE shop day (F-6) — a start outside `[0, 1440)` is
 * refused as `startField`, a duration that is not positive or that would end
 * past midnight as `durationMinutes`.
 */
function placed(
  seat: Seat,
  startMinutes: number,
  durationMinutes: number,
  startField: string,
): Result<Seat, StaffEditInvalidCommand> {
  const start = MinuteOfDay.of(startMinutes);
  if (!start.ok) return invalid(startField);
  const duration = DurationMinutes.of(durationMinutes);
  if (!duration.ok) return invalid('durationMinutes');
  if (!EndMinute.after(start.value, duration.value).ok) {
    return invalid(
      durationMinutes === seat.durationMinutes ? startField : 'durationMinutes',
    );
  }
  return Result.ok({
    ...seat,
    startMinutes: start.value,
    durationMinutes: duration.value,
  });
}

/** Every seat mapped through `map`, each re-placed seat checked by {@link placed}. */
function reshape(
  seats: readonly Seat[],
  map: (seat: Seat) => Result<Seat, StaffEditInvalidCommand> | null,
): Result<readonly Seat[], StaffEditInvalidCommand> {
  const next: Seat[] = [];
  for (let i = 0; i < seats.length; i++) {
    const seat = seats[i] as Seat;
    const mapped = map(seat);
    if (mapped === null) {
      next.push(seat);
      continue;
    }
    if (!mapped.ok) return mapped;
    next.push(mapped.value);
  }
  return Result.ok(next);
}

/** {@link reshape} for a command naming one seat — an unknown seat is refused as `seatId`. */
function reshapeSeat(
  seats: readonly Seat[],
  seatId: SeatId,
  map: (seat: Seat) => Result<Seat, StaffEditInvalidCommand>,
): Result<readonly Seat[], StaffEditInvalidCommand> {
  if (!hasSeat(seats, seatId)) return invalid('seatId');
  return reshape(seats, (seat) => (seat.seatId === seatId ? map(seat) : null));
}

/**
 * A staff edit's pure half (`staff-edit-appointment.use-case.ts:724-746`,
 * `applyCommand` `:1513-1655`, `.operations.ts`): the batch FOLDED over the
 * stored seats in the caller's order, so each command sees the one before
 * it — on the shop's wall clock, one shop day per visit (F-6); the
 * fingerprint of the batch; the ledger's verdict on a named intent. No
 * `crypto` — the pipeline calls `hash(digestBasis(commands))`.
 */
export const AppointmentEditSystem = {
  /**
   * The canonical basis of one intent's fingerprint:
   * `JSON.stringify(['staff-operation/v1', commands])` — the validated
   * commands, IN ORDER (a move then a resize is not a resize then a move).
   * The pipeline hashes it (`sha256`, sixteen hex digits — a sanity check
   * between one client's sends, not a security boundary).
   */
  digestBasis(commands: readonly unknown[]): string {
    return JSON.stringify([DIGEST_TAG, commands]);
  },

  /** How many hex digits of the batch's hash the ledger keeps (`digestOf`). */
  DIGEST_LENGTH,

  /**
   * The ledger's fingerprint of one intent: the first {@link DIGEST_LENGTH}
   * hex digits of `hash(digestBasis(commands))` — the pipeline hashes, this
   * trims. The staff edit and the client's reschedule keep the same length.
   */
  digestOf(hex: string): string {
    return hex.slice(0, DIGEST_LENGTH);
  },

  /**
   * The staff verb a batch is audited under: its lone command's, or a save
   * (`BOOKING_STAFF_SAVE`) for none or several.
   */
  auditVerb(commands: readonly AnyEditCommand[]): StaffEditAction {
    const only = commands.length === 1 ? commands[0] : undefined;
    return only === undefined
      ? AuditAction.BookingStaffSave
      : STAFF_VERB[only.editCommand];
  },

  /** The batch's LAST word on the discounts, or `null` when it said nothing (keep the stored set). */
  lastDiscounts(
    commands: readonly BookingCall.EditCommand[],
  ): readonly BookingCall.StaffDiscount[] | null {
    return lastOf(commands, (command) =>
      command.editCommand === EditCommand.Discounts ? command.discounts : null,
    );
  },

  /** The batch's LAST word on the vouchers — the codes it names, else keep the stored lines. */
  pendingVouchers(
    commands: readonly BookingCall.EditCommand[],
  ): PendingVouchers {
    const codes = lastOf<BookingCall.EditCommand, readonly VoucherCode[]>(
      commands,
      (command) =>
        command.editCommand === EditCommand.Vouchers ? command.codes : null,
    );
    return codes === null
      ? { billPending: BillPending.Keep }
      : { billPending: BillPending.Set, codes };
  },

  /** The shop the batch moves the visit to — its LAST `RELOCATE` — or `null` (it stays). */
  relocatedTo(commands: readonly AnyEditCommand[]): LocationId | null {
    return lastOf(commands, (command) =>
      command.editCommand === EditCommand.Relocate ? command.locationId : null,
    );
  },

  /**
   * The exclusive end a `RESIZE` of the bottom handle lands on, measured
   * from the RUNNING day's midnight: the call names the day its handle
   * landed on (`localDate`) and the minute on it, so an end at the next
   * day's `00:00` is the running day's closing `1440`. An end at or before
   * the running day's start drives the duration to nothing (`minutes`); one
   * past its closing midnight leaves the day (`atMinutes`).
   */
  resizeEndOf(
    runningDay: LocalDate,
    localDate: LocalDate,
    atMinutes: EndMinute,
  ): Result<EndMinute, StaffEditInvalidCommand> {
    const minutes =
      LocalDate.daysBetween(runningDay, localDate) * 1440 + atMinutes;
    if (minutes <= 0) return invalid('minutes');
    const end = EndMinute.of(minutes);
    return end.ok ? Result.ok(end.value) : invalid('atMinutes');
  },

  /**
   * Who an added seat is for, flat: the visit's owner by their uid when
   * the call asks for the owner (`SELF`) and the visit has one — nobody
   * else can join through an edit — else an anonymous guest: by the label
   * the call names, or (a `SELF` seat on an ownerless visit) by the seat's
   * own id.
   */
  addedOccupantOf(
    addedSubject: BookingCall.AddedSubject,
    owner: UserId | null,
    seatId: SeatId,
  ): AccountOccupant {
    if (
      addedSubject.requestedSubjectRole === RequestedSubjectRole.Self &&
      owner !== null
    ) {
      return {
        seatSubject: SeatSubject.Account,
        subjectUserId: owner,
        subjectRelationship: SubjectRelationship.Self,
      };
    }
    return SeatOccupant.anonymous(
      addedSubject.requestedSubjectRole === RequestedSubjectRole.Guest
        ? addedSubject.label
        : SeatLabel.of(seatId),
    );
  },

  /**
   * The accounts a call's batch adds — each `ADD_SEAT` whose occupant
   * ({@link addedOccupantOf}) is an account, distinct, in batch order:
   * what the pipeline resolves to client records (and the FIRST_BOOKING
   * `customers` read) BEFORE it folds. Only the owner can be one.
   */
  addedAccounts(
    commands: readonly BookingCall.EditCommand[],
    owner: UserId | null,
  ): readonly UserId[] {
    const out: UserId[] = [];
    for (let i = 0; i < commands.length; i++) {
      const command = commands[i] as BookingCall.EditCommand;
      if (command.editCommand !== EditCommand.AddSeat) continue;
      const occupant = AppointmentEditSystem.addedOccupantOf(
        command.addedSubject,
        owner,
        command.seatId,
      );
      if (
        occupant.seatSubject === SeatSubject.Account &&
        !out.includes(occupant.subjectUserId)
      ) {
        out.push(occupant.subjectUserId);
      }
    }
    return out;
  },

  /**
   * The fold's reading of the stored visit — finished or not, and the ids it
   * held — beside the client records the pipeline resolved for the batch.
   */
  foldContextOf(
    appointment: Appointment,
    customerIds: ReadonlyMap<UserId, CustomerId>,
  ): FoldContext {
    const held: SeatId[] = [];
    for (let i = 0; i < appointment.seats.length; i++) {
      held.push((appointment.seats[i] as Seat).seatId);
    }
    return {
      finished: isFinished(appointment.bookingStatus),
      held,
      customerIds,
    };
  },

  /**
   * ONE command applied to the running draft.
   *
   * An UNSCOPED `MOVE` is the whole party — every seat shifts by one delta
   * on the wall clock, so the arrangement (parallel or back to back) is kept,
   * onto the day the move names; a scoped one measures the delta from the
   * SCOPE's own start and stays on the visit's day (part of a party cannot
   * go to another day: one shop day per appointment). A `RESIZE` acts on the
   * seats that OWN the dragged edge — those starting at the scope's start,
   * or ending at its end; the top handle holds the end (the start moves and
   * the duration absorbs it). An added seat is NEW (an id the stored visit
   * held is never minted again) and on a finished visit is worked, stamped
   * at its own end; a removed seat must still be open and never the last.
   * Every re-placed seat must stay on its shop day.
   */
  applyCommand(
    draft: EditDraft,
    command: EditCommandRequest,
    context: FoldContext,
  ): Result<EditDraft, StaffEditInvalidCommand> {
    const seats = draft.seats;
    switch (command.editCommand) {
      case EditCommand.Move: {
        const scoped = scopeOf(seats, command.seatIds);
        if (!scoped.ok) return scoped;
        const scope = scoped.value;
        if (
          command.localDate !== draft.localDate &&
          scope.length !== seats.length
        ) {
          return invalid('startMinutes');
        }
        const delta = command.startMinutes - startOf(scope);
        const moved = reshape(seats, (seat) =>
          scope.includes(seat)
            ? placed(
                seat,
                seat.startMinutes + delta,
                seat.durationMinutes,
                'startMinutes',
              )
            : null,
        );
        if (!moved.ok) return moved;
        return Result.ok({ localDate: command.localDate, seats: moved.value });
      }
      case EditCommand.Resize: {
        const scoped = scopeOf(seats, command.seatIds);
        if (!scoped.ok) return scoped;
        const scope = scoped.value;
        if (command.resizeEdge === ResizeEdge.End) {
          const scopeEnd = endOf(scope);
          const delta = command.atMinutes - scopeEnd;
          const resized = reshape(seats, (seat) =>
            scope.includes(seat) && Seat.endMinutes(seat) === scopeEnd
              ? placed(
                  seat,
                  seat.startMinutes,
                  seat.durationMinutes + delta,
                  'atMinutes',
                )
              : null,
          );
          return resized.ok
            ? Result.ok({ localDate: draft.localDate, seats: resized.value })
            : resized;
        }
        const scopeStart = startOf(scope);
        const at = command.atMinutes;
        const delta = at - scopeStart;
        const resized = reshape(seats, (seat) =>
          scope.includes(seat) && seat.startMinutes === scopeStart
            ? placed(seat, at, seat.durationMinutes - delta, 'atMinutes')
            : null,
        );
        return resized.ok
          ? Result.ok({ localDate: draft.localDate, seats: resized.value })
          : resized;
      }
      case EditCommand.Redurate: {
        const redurated = reshapeSeat(seats, command.seatId, (seat) =>
          placed(
            seat,
            seat.startMinutes,
            command.durationMinutes,
            'durationMinutes',
          ),
        );
        return redurated.ok
          ? Result.ok({ localDate: draft.localDate, seats: redurated.value })
          : redurated;
      }
      case EditCommand.Reprice: {
        const repriced = reshapeSeat(seats, command.seatId, (seat) =>
          Result.ok({ ...seat, priceCents: command.priceCents }),
        );
        return repriced.ok
          ? Result.ok({ localDate: draft.localDate, seats: repriced.value })
          : repriced;
      }
      case EditCommand.Restaff: {
        const restaffed = reshapeSeat(seats, command.seatId, (seat) =>
          Result.ok({ ...seat, barberId: command.barberId }),
        );
        return restaffed.ok
          ? Result.ok({ localDate: draft.localDate, seats: restaffed.value })
          : restaffed;
      }
      case EditCommand.AddSeat: {
        if (
          includesId(context.held, command.seatId) ||
          hasSeat(seats, command.seatId)
        ) {
          return invalid('seatId');
        }
        const template = seats[0];
        if (template === undefined) return invalid('seats');
        const end = EndMinute.after(
          command.startMinutes,
          command.durationMinutes,
        );
        if (!end.ok) return invalid('durationMinutes');
        const added = Seat.compose(
          {
            seatId: command.seatId,
            serviceId: command.serviceId,
            variantId: command.variantId,
            barberId: command.barberId,
            barberPreference: null,
            startMinutes: command.startMinutes,
            tipCents: null,
          },
          {
            priceCents: PriceCents.ZERO,
            currency: template.currency,
            durationMinutes: command.durationMinutes,
            setupMinutes: MinuteCount.ZERO,
            cleanupMinutes: MinuteCount.ZERO,
            catalogPriceCents: null,
            catalogDurationMinutes: null,
          },
          addedOccupant(command, context.customerIds),
          context.finished
            ? SeatOutcome.worked(command.workedAtUtcMs)
            : SeatOutcome.scheduled(),
        );
        return Result.ok({
          localDate: draft.localDate,
          seats: [...seats, added],
        });
      }
      case EditCommand.RemoveSeat: {
        let target: Seat | null = null;
        for (let i = 0; i < seats.length && target === null; i++) {
          if ((seats[i] as Seat).seatId === command.seatId) {
            target = seats[i] as Seat;
          }
        }
        if (target === null) return invalid('seatId');
        if (
          target.attendanceState !== AttendanceState.Scheduled ||
          seats.length === 1
        ) {
          return invalid('seatId');
        }
        const next: Seat[] = [];
        for (let i = 0; i < seats.length; i++) {
          if (seats[i] !== target) next.push(seats[i] as Seat);
        }
        return Result.ok({ localDate: draft.localDate, seats: next });
      }
      default:
        // Relocate, discounts, vouchers: the place's and the bill's, settled
        // outside the fold — the seats do not change under them.
        return Result.ok(draft);
    }
  },

  /**
   * The batch FOLDED over the stored seats, in the caller's order, each
   * command first RESOLVED on the clock of the draft the one before it left
   * (`resolve`, the boundary's zone-dependent step — Law 7.3) and then
   * applied ({@link applyCommand}): a save that moves the day and then
   * stretches the block resizes the MOVED seats. An empty batch is refused
   * as `commands` (it would write nothing quietly), an empty visit as
   * `seats` (a cancellation has its own path). A `RELOCATE` changes the
   * place, not the seats — the visit lands at the batch's last one
   * ({@link relocatedTo}). An added account seat takes its client record
   * from `customerIds` (D29). Every seat the stored visit did not hold is
   * fresh.
   */
  foldCommands<C, E>(
    appointment: Appointment,
    commands: readonly C[],
    customerIds: ReadonlyMap<UserId, CustomerId>,
    resolve: EditCommandResolver<C, E>,
  ): Result<FoldedBatch, StaffEditInvalidCommand | E> {
    if (commands.length === 0) return invalid('commands');
    if (appointment.seats.length === 0) return invalid('seats');
    const context = AppointmentEditSystem.foldContextOf(
      appointment,
      customerIds,
    );
    let draft: EditDraft = {
      localDate: appointment.localDate,
      seats: appointment.seats,
    };
    const requests: EditCommandRequest[] = [];
    for (let i = 0; i < commands.length; i++) {
      const request = resolve(commands[i] as C, draft.localDate);
      if (!request.ok) return request;
      requests.push(request.value);
      // The place is settled outside the fold — the seats do not change under it.
      if (request.value.editCommand === EditCommand.Relocate) continue;
      const applied = AppointmentEditSystem.applyCommand(
        draft,
        request.value,
        context,
      );
      if (!applied.ok) return applied;
      draft = applied.value;
    }
    const fresh: SeatId[] = [];
    for (let i = 0; i < draft.seats.length; i++) {
      const id = (draft.seats[i] as Seat).seatId;
      if (!includesId(context.held, id)) fresh.push(id);
    }
    return Result.ok({
      localDate: draft.localDate,
      seats: draft.seats,
      freshSeatIds: fresh,
      locationId:
        AppointmentEditSystem.relocatedTo(requests) ?? appointment.locationId,
      requests,
    });
  },

  /**
   * An already-resolved batch FOLDED over the stored seats —
   * {@link foldCommands} with every request taken as it is.
   */
  fold(
    appointment: Appointment,
    commands: readonly EditCommandRequest[],
    customerIds: ReadonlyMap<UserId, CustomerId>,
  ): Result<EditOutcome, StaffEditInvalidCommand> {
    const folded = AppointmentEditSystem.foldCommands<
      EditCommandRequest,
      never
    >(appointment, commands, customerIds, (command) => Result.ok(command));
    if (!folded.ok) return folded;
    const { localDate, seats, freshSeatIds, locationId } = folded.value;
    return Result.ok({ localDate, seats, freshSeatIds, locationId });
  },

  /**
   * Does every seat this batch added (`freshSeatIds`) name a chair the
   * shop rosters (`schedules`, by barber id)? A stored seat is never asked:
   * the visit already holds its chair.
   */
  freshSeatsRostered(
    seats: readonly Pick<Seat, 'seatId' | 'barberId'>[],
    freshSeatIds: readonly SeatId[],
    schedules: readonly { readonly id: BarberId }[],
  ): boolean {
    for (let i = 0; i < seats.length; i++) {
      const seat = seats[i] as Pick<Seat, 'seatId' | 'barberId'>;
      if (!includesId(freshSeatIds, seat.seatId)) continue;
      let rostered = false;
      for (let k = 0; k < schedules.length && !rostered; k++) {
        if ((schedules[k] as { readonly id: BarberId }).id === seat.barberId)
          rostered = true;
      }
      if (!rostered) return false;
    }
    return true;
  },

  /**
   * The terms every STORED seat of the folded visit carries into the
   * decision — a move is not a re-sale: its snapshot rides forward, keyed by
   * the seat's id; a fresh seat gets none and is priced by the catalogue.
   */
  termsOverridesOf(
    seats: readonly Seat[],
    freshSeatIds: readonly SeatId[],
  ): readonly StaffTermsOverride[] {
    const overrides: StaffTermsOverride[] = [];
    for (let i = 0; i < seats.length; i++) {
      const seat = seats[i] as Seat;
      if (includesId(freshSeatIds, seat.seatId)) continue;
      overrides.push(StaffTermsOverride.of(SeatKeyText.of(seat.seatId), seat));
    }
    return overrides;
  },

  /**
   * The decided seats with the folded seats' outcomes and tips carried
   * back, by position: the decision rebuilt each seat from the catalogue,
   * which knows nothing of the guest who was served or of what was left on
   * the counter. A decided seat with no folded twin is kept as decided.
   */
  carryBack(
    decided: readonly Seat[],
    folded: readonly Seat[],
  ): readonly Seat[] {
    const seats: Seat[] = [];
    for (let i = 0; i < decided.length; i++) {
      const seat = decided[i] as Seat;
      const twin = folded[i];
      seats.push(
        twin === undefined
          ? seat
          : Seat.withTip(Seat.withOutcome(seat, twin), twin.tipCents),
      );
    }
    return seats;
  },

  /**
   * A collision the decision answered (`BOOKING_SLOT_UNAVAILABLE` — with the
   * window off for staff it can mean nothing else) as the acknowledgeable
   * overlap, naming the dragged handle when the batch is ONE resize.
   */
  overlapOf(
    error: BookingError.SlotUnavailable,
    commands: readonly AnyEditCommand[],
  ): StaffEditOverlaps {
    const only = commands.length === 1 ? commands[0] : undefined;
    return StaffEditError.overlaps(
      error.barberId,
      error.localDate,
      error.startMinutes,
      only?.editCommand === EditCommand.Resize ? only.resizeEdge : null,
    );
  },

  /**
   * Does a save have a way back through the same callable? A seat added
   * to a FINISHED visit (`rootStatus` — the appointment's own status, never
   * a chair's summary) is worked the moment it is written and the server
   * keeps history: its `REMOVE_SEAT` would be refused every time, so that
   * save has no undo. Every other save has one; so does a save whose root
   * is unknown (`null`).
   */
  undoable(
    rootStatus: BookingStatus | null,
    commands: readonly { readonly editCommand: EditCommand }[],
  ): boolean {
    if (rootStatus === null || !isFinished(rootStatus)) return true;
    for (let i = 0; i < commands.length; i++) {
      if (
        (commands[i] as { readonly editCommand: EditCommand }).editCommand ===
        EditCommand.AddSeat
      ) {
        return false;
      }
    }
    return true;
  },

  /**
   * Is the visit history with nothing to correct? A visit that NEVER
   * HAPPENED — cancelled, or a no-show ({@link BookingLifecycle.didNotHappen})
   * — locks every edit; a FINISHED one does not (owner, 2026-09-09: the
   * sheet is filled in after the cut).
   */
  locksEdits(status: BookingStatus): boolean {
    return BookingLifecycle.didNotHappen({ bookingStatus: status });
  },

  /**
   * May the folded visit be written at all
   * (`staff-edit-appointment.use-case.ts` `decide`)? A visit whose edits
   * are locked ({@link locksEdits}: it never happened) is history with
   * nothing to correct (`BOOKING_INVALID_INPUT`, field `bookingStatus`); a
   * FINISHED one is not. A visit with an arrival stamp may not end at or
   * before it (`BEFORE_ARRIVAL`) — compared on the shop's wall clock: the
   * folded visit's last end on its `localDate` against the arrival the
   * boundary read (T6). `seats` are the folded seats as they are, each
   * ending with its sold span (`SeatingRuleSystem.soldEnd`, clamped at the
   * closing midnight); `null` when the write may go ahead.
   */
  guard(
    state: BookingStatus,
    localDate: LocalDate,
    seats: readonly Pick<Seat, 'startMinutes' | 'durationMinutes'>[],
    arrival: WallTime | null,
  ): StaffEditGuardRefusal | null {
    if (AppointmentEditSystem.locksEdits(state)) {
      return BookingError.invalidInput('bookingStatus');
    }
    if (arrival === null || seats.length === 0) return null;
    let finish = SeatingRuleSystem.soldEnd(
      seats[0] as Pick<Seat, 'startMinutes' | 'durationMinutes'>,
    );
    for (let i = 1; i < seats.length; i++) {
      const end = SeatingRuleSystem.soldEnd(
        seats[i] as Pick<Seat, 'startMinutes' | 'durationMinutes'>,
      );
      if (end > finish) finish = end;
    }
    const endsBefore =
      localDate < arrival.localDate ||
      (localDate === arrival.localDate && finish <= arrival.minute);
    return endsBefore
      ? StaffEditError.beforeArrival(
          localDate,
          finish,
          arrival.localDate,
          arrival.minute,
        )
      : null;
  },

  /**
   * The optimistic-concurrency guard: a claim (`expected`) that is not the
   * stored revision is refused as STALE; `null` claims nothing and is never
   * refused.
   */
  checkRevision(
    appointment: Pick<Appointment, 'revision'>,
    expected: number | null,
  ): Result<number, StaffEditStale> {
    if (expected !== null && expected !== appointment.revision) {
      return Result.err(StaffEditError.stale(expected, appointment.revision));
    }
    return Result.ok(appointment.revision);
  },

  /**
   * Has the visit already applied this named intent (`replayOf`)? A name
   * the ledger holds with the same digest is a REPLAY (answer it, write
   * nothing); with another digest it is a client bug (`MISMATCH`).
   */
  ledgerVerdict(
    ledger: readonly AppliedOperation[],
    operationId: OperationId,
    digest: string,
  ): LedgerVerdictResult {
    const applied = AppliedOperation.find(ledger, operationId);
    if (applied === null) return { ledgerVerdict: LedgerVerdict.New };
    if (applied.digest !== digest) {
      return { ledgerVerdict: LedgerVerdict.Mismatch };
    }
    return { ledgerVerdict: LedgerVerdict.Replay, applied };
  },

  /** The ledger with this intent recorded last — at most `AppliedOperation.CAP`, the newest, never one name twice. */
  record(
    ledger: readonly AppliedOperation[],
    operationId: OperationId,
    revision: number,
    digest: string,
  ): readonly AppliedOperation[] {
    return AppliedOperation.append(ledger, { operationId, revision, digest });
  },
} as const;
