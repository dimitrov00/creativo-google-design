import { AppliedOperation } from '../components/applied-operation.data';
import { BookingCommitError } from '../components/booking-commit-errors.data';
import { BookingState } from '../components/booking-status.data';
import { Result } from '../components/result.data';
import { SeatOutcome, SeatOutcomeKind } from '../components/seat-outcome.data';
import { Seat, type SeatId, type SeatSubject } from '../components/seat.data';
import type { ServiceVariantId } from '../components/service-terms.data';
import type { TimeInterval } from '../components/time-interval.data';
import type { AppointmentEntity } from '../entities/appointment.entity';
import type { BarberId } from '../entities/barber.entity';
import type { LocationId } from '../entities/location.entity';
import type { ServiceId } from '../entities/service.entity';

const MS_PER_MINUTE = 60_000;

/** The digest basis version — the server's fingerprint of one intent's batch. */
const DIGEST_TAG = 'staff-operation/v1';

/**
 * The staff edit's refusal codes (`staff-edit-appointment.errors.ts`) — the
 * ONLY source of these strings. `invalid_command` names the field.
 */
export const StaffEditErrorCode = {
  Unauthenticated: 'booking.staffEdit.unauthenticated',
  Forbidden: 'booking.staffEdit.forbidden',
  InvalidCommand: 'booking.staffEdit.invalid_command',
  BeforeArrival: 'booking.staffEdit.before_arrival',
  Overlaps: 'booking.staffEdit.overlaps',
  Stale: 'booking.staffEdit.stale',
  InvariantViolated: 'booking.staffEdit.invariant_violated',
} as const;
export type StaffEditErrorCode =
  (typeof StaffEditErrorCode)[keyof typeof StaffEditErrorCode];

export type StaffEditInvalidCommand = {
  readonly code: typeof StaffEditErrorCode.InvalidCommand;
  /** `kind`, `startIso`, `edge`, `seatId`, `seatIds`, `minutes`, `seats`, `discounts`, `vouchers`, `operationId`… */
  readonly field: string;
};
export type StaffEditForbidden = {
  readonly code: typeof StaffEditErrorCode.Forbidden;
};
export type StaffEditStale = {
  readonly code: typeof StaffEditErrorCode.Stale;
  readonly expected: number;
  readonly actual: number;
};

/**
 * The folded visit would END at or before its arrival stamp — a
 * DATA-INTEGRITY refusal, not a scheduling one: the stamp is the fact that
 * cannot move. Both instants in epoch ms.
 */
export type StaffEditBeforeArrival = {
  readonly code: typeof StaffEditErrorCode.BeforeArrival;
  readonly finishMs: number;
  readonly arrivedAtMs: number;
};

/** The refusals the edit's pure half can return. */
export type StaffEditError =
  | StaffEditInvalidCommand
  | StaffEditForbidden
  | StaffEditStale
  | StaffEditBeforeArrival;

/** What {@link AppointmentEditSystem.guard} refuses: a visit that never happened, or one ending before its arrival. */
export type StaffEditGuardRefusal =
  BookingCommitError.InvalidInput | StaffEditBeforeArrival;

export const StaffEditError = {
  invalidCommand(field: string): StaffEditInvalidCommand {
    return { code: StaffEditErrorCode.InvalidCommand, field };
  },
  forbidden(): StaffEditForbidden {
    return { code: StaffEditErrorCode.Forbidden };
  },
  stale(expected: number, actual: number): StaffEditStale {
    return { code: StaffEditErrorCode.Stale, expected, actual };
  },
  beforeArrival(finishMs: number, arrivedAtMs: number): StaffEditBeforeArrival {
    return { code: StaffEditErrorCode.BeforeArrival, finishMs, arrivedAtMs };
  },
} as const;

/** The staff edit command kinds — the wire's `kind` tags, unchanged. */
export const EditCommandKind = {
  Move: 'move',
  Resize: 'resize',
  Reprice: 'reprice',
  Redurate: 'redurate',
  Restaff: 'restaff',
  AddSeat: 'addSeat',
  RemoveSeat: 'removeSeat',
  Relocate: 'relocate',
  Discounts: 'discounts',
  Vouchers: 'vouchers',
} as const;
export type EditCommandKind =
  (typeof EditCommandKind)[keyof typeof EditCommandKind];

/** Which handle of the block a resize drags. */
export const ResizeEdge = {
  Start: 'start',
  End: 'end',
} as const;
export type ResizeEdge = (typeof ResizeEdge)[keyof typeof ResizeEdge];

/**
 * One staff edit, as the fold applies it — the port's `StaffEditCommand`
 * with instants as epoch ms and every field present (`seatIds: null` is the
 * whole party). `discounts`/`vouchers`/`relocate` are facts about the BILL
 * and the PLACE: the fold carries them past the seats (BillingSystem and the
 * pipeline settle them), so they carry no payload here.
 */
export type EditCommand =
  | {
      readonly kind: typeof EditCommandKind.Move;
      readonly startMs: number;
      readonly seatIds: readonly SeatId[] | null;
    }
  | {
      readonly kind: typeof EditCommandKind.Resize;
      readonly edge: ResizeEdge;
      readonly atMs: number;
      readonly seatIds: readonly SeatId[] | null;
    }
  | {
      readonly kind: typeof EditCommandKind.Reprice;
      readonly seatId: SeatId;
      readonly priceMinorUnits: number;
    }
  | {
      readonly kind: typeof EditCommandKind.Redurate;
      readonly seatId: SeatId;
      readonly minutes: number;
    }
  | {
      readonly kind: typeof EditCommandKind.Restaff;
      readonly seatId: SeatId;
      readonly barberId: BarberId;
    }
  | {
      readonly kind: typeof EditCommandKind.AddSeat;
      readonly seatId: SeatId;
      readonly serviceId: ServiceId;
      readonly variantId: ServiceVariantId | null;
      readonly barberId: BarberId;
      readonly startMs: number;
      readonly minutes: number;
      readonly subject: SeatSubject;
    }
  | {
      readonly kind: typeof EditCommandKind.RemoveSeat;
      readonly seatId: SeatId;
    }
  | {
      readonly kind: typeof EditCommandKind.Relocate;
      readonly locationId: LocationId;
    }
  | { readonly kind: typeof EditCommandKind.Discounts }
  | { readonly kind: typeof EditCommandKind.Vouchers };

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

/** What a fold leaves: the seats as the batch drafted them, and where. */
export type EditOutcome = {
  readonly seats: readonly Seat[];
  /** Seats added in THIS batch and not yet priced — the decision prices them from the catalogue. */
  readonly freshSeatIds: readonly SeatId[];
  /** The shop the batch moves the visit to (the last `relocate`), else the one it is at. */
  readonly locationId: LocationId;
};

/** What a ledger says about a named intent. */
export const LedgerVerdictKind = {
  /** No name, or a name the ledger has not seen: apply it. */
  New: 'new',
  /** The ledger applied this name with this digest: answer it, write nothing. */
  Replay: 'replay',
  /** The name is known but the batch differs: a client bug, refused by name. */
  Mismatch: 'mismatch',
} as const;
export type LedgerVerdictKind =
  (typeof LedgerVerdictKind)[keyof typeof LedgerVerdictKind];

export type LedgerVerdict =
  | { readonly kind: typeof LedgerVerdictKind.New }
  | {
      readonly kind: typeof LedgerVerdictKind.Replay;
      readonly applied: AppliedOperation;
    }
  | { readonly kind: typeof LedgerVerdictKind.Mismatch };

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
    if ((seats[i] as Seat).id === id) return true;
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
    if (includesId(wanted, seat.id)) scope.push(seat);
  }
  return scope.length === wanted.length ? Result.ok(scope) : invalid('seatIds');
}

function startOf(seats: readonly Seat[]): number {
  let start = Number.POSITIVE_INFINITY;
  for (let i = 0; i < seats.length; i++) {
    const seat = seats[i] as Seat;
    if (seat.startMs < start) start = seat.startMs;
  }
  return start;
}

function endOf(seats: readonly Seat[]): number {
  let end = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < seats.length; i++) {
    const seatEnd = Seat.endMs(seats[i] as Seat);
    if (seatEnd > end) end = seatEnd;
  }
  return end;
}

function withDuration(seat: Seat, durationMinutes: number): Seat {
  return { ...seat, terms: { ...seat.terms, durationMinutes } };
}

/** Every seat mapped; a duration the edit drove to zero or below is refused as `minutes`. */
function reshape(
  seats: readonly Seat[],
  map: (seat: Seat) => Seat,
): Result<readonly Seat[], StaffEditInvalidCommand> {
  const next: Seat[] = [];
  for (let i = 0; i < seats.length; i++) {
    const seat = map(seats[i] as Seat);
    const minutes = seat.terms.durationMinutes;
    if (!Number.isInteger(minutes) || minutes <= 0) return invalid('minutes');
    next.push(seat);
  }
  return Result.ok(next);
}

/** {@link reshape} for a command naming one seat — an unknown seat is refused as `seatId`. */
function reshapeSeat(
  seats: readonly Seat[],
  seatId: SeatId,
  map: (seat: Seat) => Seat,
): Result<readonly Seat[], StaffEditInvalidCommand> {
  if (!hasSeat(seats, seatId)) return invalid('seatId');
  return reshape(seats, (seat) => (seat.id === seatId ? map(seat) : seat));
}

/**
 * A staff edit's pure half (`staff-edit-appointment.use-case.ts:724-746`,
 * `applyCommand` `:1513-1655`, `.operations.ts`): the batch FOLDED over the
 * stored seats in the caller's order, so each command sees the one before
 * it; the fingerprint of the batch; the ledger's verdict on a named intent.
 * No `crypto` — the pipeline calls `hash(digestBasis(commands))`.
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
  foldContextOf(appointment: AppointmentEntity): FoldContext {
    const held: SeatId[] = [];
    for (let i = 0; i < appointment.seats.length; i++) {
      held.push((appointment.seats[i] as Seat).id);
    }
    return {
      finished: appointment.bookingStatus.kind === BookingState.Completed,
      held,
    };
  },

  /**
   * ONE command applied to the running seats.
   *
   * An UNSCOPED `move` is the whole party — every seat shifts by one delta,
   * so the arrangement (parallel or back to back) is kept; a scoped one
   * measures the delta from the SCOPE's own start. A `resize` acts on the
   * seats that OWN the dragged edge — those starting at the scope's start,
   * or ending at its end; the top handle holds the end (the start moves and
   * the duration absorbs it). An added seat is NEW (an id the stored visit
   * held is never minted again) and on a finished visit is worked, stamped
   * at its own end; a removed seat must still be open and never the last.
   */
  applyCommand(
    seats: readonly Seat[],
    command: EditCommand,
    context: FoldContext,
  ): Result<readonly Seat[], StaffEditInvalidCommand> {
    switch (command.kind) {
      case EditCommandKind.Move: {
        const scoped = scopeOf(seats, command.seatIds);
        if (!scoped.ok) return scoped;
        const delta = command.startMs - startOf(scoped.value);
        const scope = scoped.value;
        const next: Seat[] = [];
        for (let i = 0; i < seats.length; i++) {
          const seat = seats[i] as Seat;
          next.push(
            scope.includes(seat)
              ? { ...seat, startMs: seat.startMs + delta }
              : seat,
          );
        }
        return Result.ok(next);
      }
      case EditCommandKind.Resize: {
        const scoped = scopeOf(seats, command.seatIds);
        if (!scoped.ok) return scoped;
        const scope = scoped.value;
        if (command.edge === ResizeEdge.End) {
          const scopeEnd = endOf(scope);
          const deltaMinutes = Math.round(
            (command.atMs - scopeEnd) / MS_PER_MINUTE,
          );
          return reshape(seats, (seat) =>
            scope.includes(seat) && Seat.endMs(seat) === scopeEnd
              ? withDuration(seat, seat.terms.durationMinutes + deltaMinutes)
              : seat,
          );
        }
        const scopeStart = startOf(scope);
        const at = command.atMs;
        const deltaMinutes = Math.round((at - scopeStart) / MS_PER_MINUTE);
        return reshape(seats, (seat) =>
          scope.includes(seat) && seat.startMs === scopeStart
            ? {
                ...withDuration(
                  seat,
                  seat.terms.durationMinutes - deltaMinutes,
                ),
                startMs: at,
              }
            : seat,
        );
      }
      case EditCommandKind.Redurate:
        return reshapeSeat(seats, command.seatId, (seat) =>
          withDuration(seat, command.minutes),
        );
      case EditCommandKind.Reprice:
        return reshapeSeat(seats, command.seatId, (seat) => ({
          ...seat,
          terms: { ...seat.terms, priceMinorUnits: command.priceMinorUnits },
        }));
      case EditCommandKind.Restaff:
        return reshapeSeat(seats, command.seatId, (seat) => ({
          ...seat,
          barberId: command.barberId,
        }));
      case EditCommandKind.AddSeat: {
        if (
          includesId(context.held, command.seatId) ||
          hasSeat(seats, command.seatId)
        ) {
          return invalid('seatId');
        }
        const template = seats[0];
        if (template === undefined) return invalid('seats');
        const added: Seat = {
          id: command.seatId,
          serviceId: command.serviceId,
          variantId: command.variantId,
          barberId: command.barberId,
          barberPref: null,
          terms: {
            priceMinorUnits: 0,
            currencyCode: template.terms.currencyCode,
            durationMinutes: command.minutes,
            setupMinutes: 0,
            cleanupMinutes: 0,
            catalogPriceMinorUnits: null,
            catalogDurationMinutes: null,
          },
          startMs: command.startMs,
          subject: command.subject,
          outcome: context.finished
            ? SeatOutcome.worked(
                command.startMs + command.minutes * MS_PER_MINUTE,
              )
            : SeatOutcome.scheduled(),
          tip: null,
        };
        return Result.ok([...seats, added]);
      }
      case EditCommandKind.RemoveSeat: {
        let target: Seat | null = null;
        for (let i = 0; i < seats.length && target === null; i++) {
          if ((seats[i] as Seat).id === command.seatId) {
            target = seats[i] as Seat;
          }
        }
        if (target === null) return invalid('seatId');
        if (
          target.outcome.kind !== SeatOutcomeKind.Scheduled ||
          seats.length === 1
        ) {
          return invalid('seatId');
        }
        const next: Seat[] = [];
        for (let i = 0; i < seats.length; i++) {
          if (seats[i] !== target) next.push(seats[i] as Seat);
        }
        return Result.ok(next);
      }
      default:
        // Relocate, discounts, vouchers: the place's and the bill's, settled
        // outside the fold — the seats do not change under them.
        return Result.ok(seats);
    }
  },

  /**
   * The batch FOLDED over the stored seats, in the caller's order, so a save
   * that moves the day and then stretches the block resizes the MOVED seats.
   * An empty batch is refused as `command` (it would write nothing quietly),
   * an empty visit as `seats` (a cancellation has its own path).
   */
  fold(
    appointment: AppointmentEntity,
    commands: readonly EditCommand[],
  ): Result<EditOutcome, StaffEditInvalidCommand> {
    if (commands.length === 0) return invalid('command');
    if (appointment.seats.length === 0) return invalid('seats');
    const context = AppointmentEditSystem.foldContextOf(appointment);
    let seats: readonly Seat[] = appointment.seats;
    let locationId = appointment.locationId;
    for (let i = 0; i < commands.length; i++) {
      const command = commands[i] as EditCommand;
      if (command.kind === EditCommandKind.Relocate) {
        locationId = command.locationId;
        continue;
      }
      const applied = AppointmentEditSystem.applyCommand(
        seats,
        command,
        context,
      );
      if (!applied.ok) return applied;
      seats = applied.value;
    }
    const fresh: SeatId[] = [];
    for (let i = 0; i < seats.length; i++) {
      const id = (seats[i] as Seat).id;
      if (!includesId(context.held, id)) fresh.push(id);
    }
    return Result.ok({ seats, freshSeatIds: fresh, locationId });
  },

  /**
   * May the folded visit be written at all
   * (`staff-edit-appointment.use-case.ts` `decide`)? A visit that NEVER
   * HAPPENED — cancelled, or a no-show — is history with nothing to correct
   * (`booking.commit.invalid_input`, field `status`); a FINISHED one is not
   * (owner, 2026-09-09: the sheet is filled in after the cut). A visit with
   * an arrival stamp may not end at or before it (`before_arrival`). `sold`
   * is each folded seat's sold span; `null` when the write may go ahead.
   */
  guard(
    state: BookingState,
    sold: readonly TimeInterval[],
    arrivedAtMs: number | null,
  ): StaffEditGuardRefusal | null {
    if (state === BookingState.Cancelled || state === BookingState.NoShow) {
      return BookingCommitError.invalidInput('status');
    }
    if (arrivedAtMs === null) return null;
    let finishMs = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < sold.length; i++) {
      const endMs = (sold[i] as TimeInterval).endMs;
      if (endMs > finishMs) finishMs = endMs;
    }
    return finishMs <= arrivedAtMs
      ? StaffEditError.beforeArrival(finishMs, arrivedAtMs)
      : null;
  },

  /**
   * The optimistic-concurrency guard: a claim (`expected`) that is not the
   * stored revision is refused as STALE; `null` claims nothing and is never
   * refused.
   */
  checkRevision(
    appointment: AppointmentEntity,
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
   * nothing); with another digest it is a client bug (`mismatch`).
   */
  ledgerVerdict(
    ledger: readonly AppliedOperation[],
    operationId: string,
    digest: string,
  ): LedgerVerdict {
    const applied = AppliedOperation.find(ledger, operationId);
    if (applied === null) return { kind: LedgerVerdictKind.New };
    if (applied.digest !== digest) return { kind: LedgerVerdictKind.Mismatch };
    return { kind: LedgerVerdictKind.Replay, applied };
  },

  /** The ledger with this intent recorded last — at most {@link LEDGER_CAP}, the newest, never one name twice. */
  record(
    ledger: readonly AppliedOperation[],
    operationId: string,
    revision: number,
    digest: string,
  ): readonly AppliedOperation[] {
    return AppliedOperation.append(ledger, {
      id: operationId,
      revision,
      digest,
    });
  },
} as const;
