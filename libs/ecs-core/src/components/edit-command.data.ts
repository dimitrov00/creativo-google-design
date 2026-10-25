import type {
  BarberId,
  DurationMinutes,
  EndMinute,
  MinuteOfDay,
  SeatId,
  ServiceId,
  ServiceVariantId,
  UtcEpochMs,
} from '@core/primitives';
import type { AccountOccupant } from './account-occupant.data';

/*
 * The staff edit's two discriminator dictionaries — the call component
 * `BookingCall.EditCommand` types with them, so they live in the components
 * tier (Law 8: a component imports primitives only; moved here from
 * `appointment-edit.system.ts`, Phase 4a 4A-6) — and the arms of the fold's
 * input that are genuinely not the call's (`EditCommand.*Request`, below).
 */

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

/**
 * The arms of the fold's input (`AppointmentEditSystem`'s
 * `EditCommandRequest`) that differ from the call's — each declared ONCE
 * here (pass C, P-1). Every other arm of that input IS the call's own
 * `BookingCall.EditCommand` arm (`MOVE`, `REPRICE`, `REDURATE`, `RESTAFF`,
 * `REMOVE_SEAT`, `RELOCATE`), passed through as decoded.
 */
export namespace EditCommand {
  /** A `RESIZE` of the top handle, on the running day — the minute the start lands on. */
  export type ResizeStartRequest = {
    readonly editCommand: typeof EditCommand.Resize;
    readonly resizeEdge: typeof ResizeEdge.Start;
    readonly atMinutes: MinuteOfDay;
    readonly seatIds: readonly SeatId[] | null;
  };
  /**
   * A `RESIZE` of the bottom handle — its exclusive end measured from the
   * RUNNING day's midnight (`AppointmentEditSystem.resizeEndOf`), never the
   * day the call named.
   */
  export type ResizeEndRequest = {
    readonly editCommand: typeof EditCommand.Resize;
    readonly resizeEdge: typeof ResizeEdge.End;
    readonly atMinutes: EndMinute;
    readonly seatIds: readonly SeatId[] | null;
  };
  /**
   * An `ADD_SEAT` on the running day, its occupant resolved flat
   * (`AppointmentEditSystem.addedOccupantOf`: an account by its uid — the
   * client record is the fold's, D29 — or a guest by label) and the instant
   * the new seat ENDS on the absolute timeline (`workedAtUtcMs`) — computed
   * at the boundary from the wire's start instant and the duration (Law
   * 7.3: the fold never converts, nor measures instants by wall-clock
   * distance across days). Stamped as the seat's `workedAtUtcMs` when the
   * visit is finished; unread otherwise.
   */
  export type AddSeatRequest = {
    readonly editCommand: typeof EditCommand.AddSeat;
    readonly seatId: SeatId;
    readonly serviceId: ServiceId;
    readonly variantId: ServiceVariantId | null;
    readonly barberId: BarberId;
    readonly startMinutes: MinuteOfDay;
    readonly durationMinutes: DurationMinutes;
    readonly workedAtUtcMs: UtcEpochMs;
  } & AccountOccupant;
  /** A `DISCOUNTS` arm as the fold sees it — a fact about the BILL, its payload settled outside the fold. */
  export type DiscountsRequest = {
    readonly editCommand: typeof EditCommand.Discounts;
  };
  /** A `VOUCHERS` arm as the fold sees it — a fact about the BILL, its payload settled outside the fold. */
  export type VouchersRequest = {
    readonly editCommand: typeof EditCommand.Vouchers;
  };
}

/** Which handle of the block a resize drags — the field `resizeEdge`. */
export const ResizeEdge = {
  Start: 'START',
  End: 'END',
} as const;
export type ResizeEdge = (typeof ResizeEdge)[keyof typeof ResizeEdge];
