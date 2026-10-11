import {
  AppliedOperation,
  type MinuteRange,
  SeatOutcome,
  Seat,
  type SeatOccupant,
  type WallTime,
} from '@core/components';
import {
  BookingStatus,
  BookingError,
  Result,
  AttendanceState,
  DurationMinutes,
  MinuteCount,
  type BarberId,
  type LocationId,
  type OperationId,
  type SeatId,
  type ServiceId,
  type ServiceVariantId,
  type LocalDate,
  EndMinute,
  MinuteOfDay,
  PriceCents,
  type UtcEpochMs,
} from '@core/primitives';
import type { Appointment } from '@core/entities';

/** The digest basis version — the server's fingerprint of one intent's batch. */
const DIGEST_TAG = 'staff-operation/v1';

/**
 * The staff edit's refusal codes (`staff-edit-appointment.errors.ts`) — the
 * ONLY source of these strings. `INVALID_COMMAND` names the field.
 */
export const StaffEditErrorCode = {
  Unauthenticated: 'BOOKING_STAFF_EDIT_UNAUTHENTICATED',
  Forbidden: 'BOOKING_STAFF_EDIT_FORBIDDEN',
  InvalidCommand: 'BOOKING_STAFF_EDIT_INVALID_COMMAND',
  BeforeArrival: 'BOOKING_STAFF_EDIT_BEFORE_ARRIVAL',
  Overlaps: 'BOOKING_STAFF_EDIT_OVERLAPS',
  Stale: 'BOOKING_STAFF_EDIT_STALE',
  InvariantViolated: 'BOOKING_STAFF_EDIT_INVARIANT_VIOLATED',
} as const;
export type StaffEditErrorCode =
  (typeof StaffEditErrorCode)[keyof typeof StaffEditErrorCode];

export type StaffEditInvalidCommand = {
  readonly errorCode: typeof StaffEditErrorCode.InvalidCommand;
  /** `kind`, `startIso`, `edge`, `seatId`, `seatIds`, `minutes`, `seats`, `discounts`, `vouchers`, `operationId`… — the wire's field. */
  readonly field: string;
};
export type StaffEditForbidden = {
  readonly errorCode: typeof StaffEditErrorCode.Forbidden;
};
export type StaffEditStale = {
  readonly errorCode: typeof StaffEditErrorCode.Stale;
  readonly expected: number;
  readonly actual: number;
};

/**
 * The folded visit would END at or before its arrival stamp — a
 * DATA-INTEGRITY refusal, not a scheduling one: the stamp is the fact that
 * cannot move. Both points on the shop's wall clock — the visit's last end
 * on its day, the arrival as the boundary read it (T6); the edge renders the
 * legacy `endIso` / `arrivedAtIso` params from them with the location's zone.
 */
export type StaffEditBeforeArrival = {
  readonly errorCode: typeof StaffEditErrorCode.BeforeArrival;
  readonly localDate: LocalDate;
  readonly finishMinutes: EndMinute;
  readonly arrivalLocalDate: LocalDate;
  readonly arrivalMinutes: MinuteOfDay;
};

/** The refusals the edit's pure half can return. */
export type StaffEditError =
  | StaffEditInvalidCommand
  | StaffEditForbidden
  | StaffEditStale
  | StaffEditBeforeArrival;

/** What {@link AppointmentEditSystem.guard} refuses: a visit that never happened, or one ending before its arrival. */
export type StaffEditGuardRefusal =
  BookingError.InvalidInput | StaffEditBeforeArrival;

export const StaffEditError = {
  invalidCommand(field: string): StaffEditInvalidCommand {
    return { errorCode: StaffEditErrorCode.InvalidCommand, field };
  },
  forbidden(): StaffEditForbidden {
    return { errorCode: StaffEditErrorCode.Forbidden };
  },
  stale(expected: number, actual: number): StaffEditStale {
    return { errorCode: StaffEditErrorCode.Stale, expected, actual };
  },
  beforeArrival(
    localDate: LocalDate,
    finishMinutes: EndMinute,
    arrival: WallTime,
  ): StaffEditBeforeArrival {
    return {
      errorCode: StaffEditErrorCode.BeforeArrival,
      localDate,
      finishMinutes,
      arrivalLocalDate: arrival.localDate,
      arrivalMinutes: arrival.minute,
    };
  },
} as const;

/** The staff edit commands — the field `editCommand`, the ONLY source of these strings. */
export const EditCommand = {
  Move: 'MOVE',
  Resize: 'RESIZE',
  Reprice: 'REPRICE',
  Redurate: 'REDURATE',
  Restaff: 'RESTAFF',
  AddSeat: 'ADD_SEAT',
  RemoveSeat: 'REMOVE_SEAT',
  Relocate: 'RELOCATE',
  Discounts: 'DISCOUNTS',
  Vouchers: 'VOUCHERS',
} as const;
export type EditCommand = (typeof EditCommand)[keyof typeof EditCommand];

/** Which handle of the block a resize drags — the field `resizeEdge`. */
export const ResizeEdge = {
  Start: 'START',
  End: 'END',
} as const;
export type ResizeEdge = (typeof ResizeEdge)[keyof typeof ResizeEdge];

/**
 * One staff edit, as the fold applies it — the port's `StaffEditCommand`
 * with its times on the shop's wall clock (the boundary converted the wire's
 * ISO instants with the location's zone) and every field present
 * (`seatIds: null` is the whole party). A `MOVE` names the day it moves to
 * (`localDate`, the same day for a same-day drag); a `RESIZE` names the
 * minute its edge lands on (an exclusive end for `END`). `ADD_SEAT` carries
 * the new seat's occupant slice flat. `DISCOUNTS` / `VOUCHERS` / `RELOCATE`
 * are facts about the BILL and the PLACE: the fold carries them past the
 * seats (BillingSystem and the pipeline settle them).
 */
export type EditCommandRequest =
  | {
      readonly editCommand: typeof EditCommand.Move;
      readonly localDate: LocalDate;
      readonly startMinutes: MinuteOfDay;
      readonly seatIds: readonly SeatId[] | null;
    }
  | {
      readonly editCommand: typeof EditCommand.Resize;
      readonly resizeEdge: typeof ResizeEdge.Start;
      readonly atMinutes: MinuteOfDay;
      readonly seatIds: readonly SeatId[] | null;
    }
  | {
      readonly editCommand: typeof EditCommand.Resize;
      readonly resizeEdge: typeof ResizeEdge.End;
      readonly atMinutes: EndMinute;
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
  | ({
      readonly editCommand: typeof EditCommand.AddSeat;
      readonly seatId: SeatId;
      readonly serviceId: ServiceId;
      readonly variantId: ServiceVariantId | null;
      readonly barberId: BarberId;
      readonly startMinutes: MinuteOfDay;
      readonly durationMinutes: DurationMinutes;
      /**
       * The instant the new seat ENDS on the absolute timeline — computed at
       * the boundary from the wire's start instant and the duration (Law
       * 7.3: the fold never converts, nor measures instants by wall-clock
       * distance across days). Stamped as the seat's `workedAtUtcMs` when the
       * visit is finished; unread otherwise.
       */
      readonly workedAtUtcMs: UtcEpochMs;
    } & SeatOccupant)
  | {
      readonly editCommand: typeof EditCommand.RemoveSeat;
      readonly seatId: SeatId;
    }
  | {
      readonly editCommand: typeof EditCommand.Relocate;
      readonly locationId: LocationId;
    }
  | { readonly editCommand: typeof EditCommand.Discounts }
  | { readonly editCommand: typeof EditCommand.Vouchers };

/**
 * What one batch's fold reads besides the running seats
 * (`staff-edit-appointment.use-case.ts:1481-1497`) — derived from the
 * STORED visit by {@link AppointmentEditSystem.foldContextOf}.
 */
export type FoldContext = {
  /** The visit is finished: a seat it gains was worked, not scheduled. */
  readonly finished: boolean;
  /**
   * Every seat id the STORED visit held — never the running list: an id the
   * visit held is never minted again by the batch that dropped it.
   */
  readonly held: readonly SeatId[];
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

/** What a ledger says about a named intent — the field `ledgerVerdict`. */
export const LedgerVerdict = {
  /** No name, or a name the ledger has not seen: apply it. */
  New: 'NEW',
  /** The ledger applied this name with this digest: answer it, write nothing. */
  Replay: 'REPLAY',
  /** The name is known but the batch differs: a client bug, refused by name. */
  Mismatch: 'MISMATCH',
} as const;
export type LedgerVerdict = (typeof LedgerVerdict)[keyof typeof LedgerVerdict];

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
 * past midnight as `minutes`.
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
  if (!duration.ok) return invalid('minutes');
  if (!EndMinute.after(start.value, duration.value).ok) {
    return invalid(
      durationMinutes === seat.durationMinutes ? startField : 'minutes',
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
  /** The ledger's cap — at most this many applied operations are remembered. */
  LEDGER_CAP: AppliedOperation.CAP,

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

  /** The fold's reading of the stored visit: finished or not, and the ids it held. */
  foldContextOf(appointment: Appointment): FoldContext {
    const held: SeatId[] = [];
    for (let i = 0; i < appointment.seats.length; i++) {
      held.push((appointment.seats[i] as Seat).seatId);
    }
    return {
      finished: appointment.bookingStatus === BookingStatus.Completed,
      held,
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
          return invalid('startIso');
        }
        const delta = command.startMinutes - startOf(scope);
        const moved = reshape(seats, (seat) =>
          scope.includes(seat)
            ? placed(
                seat,
                seat.startMinutes + delta,
                seat.durationMinutes,
                'startIso',
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
                  'atIso',
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
            ? placed(seat, at, seat.durationMinutes - delta, 'atIso')
            : null,
        );
        return resized.ok
          ? Result.ok({ localDate: draft.localDate, seats: resized.value })
          : resized;
      }
      case EditCommand.Redurate: {
        const redurated = reshapeSeat(seats, command.seatId, (seat) =>
          placed(seat, seat.startMinutes, command.durationMinutes, 'minutes'),
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
        if (!end.ok) return invalid('minutes');
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
          command,
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
   * The batch FOLDED over the stored seats, in the caller's order, so a save
   * that moves the day and then stretches the block resizes the MOVED seats.
   * An empty batch is refused as `command` (it would write nothing quietly),
   * an empty visit as `seats` (a cancellation has its own path).
   */
  fold(
    appointment: Appointment,
    commands: readonly EditCommandRequest[],
  ): Result<EditOutcome, StaffEditInvalidCommand> {
    if (commands.length === 0) return invalid('command');
    if (appointment.seats.length === 0) return invalid('seats');
    const context = AppointmentEditSystem.foldContextOf(appointment);
    let draft: EditDraft = {
      localDate: appointment.localDate,
      seats: appointment.seats,
    };
    let locationId = appointment.locationId;
    for (let i = 0; i < commands.length; i++) {
      const command = commands[i] as EditCommandRequest;
      if (command.editCommand === EditCommand.Relocate) {
        locationId = command.locationId;
        continue;
      }
      const applied = AppointmentEditSystem.applyCommand(
        draft,
        command,
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
      locationId,
    });
  },

  /**
   * May the folded visit be written at all
   * (`staff-edit-appointment.use-case.ts` `decide`)? A visit that NEVER
   * HAPPENED — cancelled, or a no-show — is history with nothing to correct
   * (`BOOKING_INVALID_INPUT`, field `status`); a FINISHED one is not (owner,
   * 2026-09-09: the sheet is filled in after the cut). A visit with an
   * arrival stamp may not end at or before it (`BEFORE_ARRIVAL`) — compared
   * on the shop's wall clock: the folded visit's last end on its
   * `localDate` against the arrival the boundary read (T6). `sold` is each
   * folded seat's sold span on that day; `null` when the write may go ahead.
   */
  guard(
    state: BookingStatus,
    localDate: LocalDate,
    sold: readonly MinuteRange[],
    arrival: WallTime | null,
  ): StaffEditGuardRefusal | null {
    if (state === BookingStatus.Cancelled || state === BookingStatus.NoShow) {
      return BookingError.invalidInput('status');
    }
    if (arrival === null || sold.length === 0) return null;
    let finish = (sold[0] as MinuteRange).endMinutes;
    for (let i = 1; i < sold.length; i++) {
      const end = (sold[i] as MinuteRange).endMinutes;
      if (end > finish) finish = end;
    }
    const finishMinutes = EndMinute.of(finish);
    if (!finishMinutes.ok) return null;
    const endsBefore =
      localDate < arrival.localDate ||
      (localDate === arrival.localDate && finish <= arrival.minute);
    return endsBefore
      ? StaffEditError.beforeArrival(localDate, finishMinutes.value, arrival)
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

  /** The ledger with this intent recorded last — at most {@link LEDGER_CAP}, the newest, never one name twice. */
  record(
    ledger: readonly AppliedOperation[],
    operationId: OperationId,
    revision: number,
    digest: string,
  ): readonly AppliedOperation[] {
    return AppliedOperation.append(ledger, { operationId, revision, digest });
  },
} as const;
