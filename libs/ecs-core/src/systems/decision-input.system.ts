import type { MinuteBlock } from '@core/components';
import type { BarberBusyDay } from '@core/entities';
import {
  type BarberId,
  BusyKey,
  type EndMinute,
  type LocalDate,
  type MinuteOfDay,
} from '@core/primitives';

/**
 * What a refused booking decision read (audit-hardening WS-4.2, RU-25) —
 * logged beside the refusal's `errorCode` by the booking, move and
 * staff-edit pipelines, never carried in the error (OR-12: an error is
 * never a data channel). Flat scalars and keys from the PUBLIC busy
 * geometry (no client, no service, no price): the busy days the decision
 * read, the block it ran into, and the stored visit's revision.
 */
export type SlotFacts = {
  /** The busy days the decision read, as their keys — sorted, so the line is stable. */
  readonly readBusyKeys: readonly BusyKey[];
  /** The colliding block's start on the refused barber's day, or `null`. */
  readonly collidingStartMinutes: MinuteOfDay | null;
  /** The colliding block's exclusive end, or `null`. */
  readonly collidingEndMinutes: EndMinute | null;
  /** The stored appointment's revision (move / edit); `null` for a new booking. */
  readonly readRevision: number | null;
};

/** The refused seat's place, as the slot refusal names it. */
export type SlotRefusal = {
  readonly barberId: BarberId;
  readonly localDate: LocalDate;
  readonly startMinutes: MinuteOfDay;
};

/**
 * The block of `day` the refused start runs into first: of the blocks that
 * do not end at or before `startMinutes` (half-open spans), the one that
 * starts earliest — a block holding the start, else the next one after it.
 * One linear scan; the stored order is not trusted.
 */
function collidingBlock(
  day: BarberBusyDay,
  startMinutes: MinuteOfDay,
): MinuteBlock | null {
  let found: MinuteBlock | null = null;
  for (let i = 0; i < day.blocks.length; i++) {
    const block = day.blocks[i] as MinuteBlock;
    if (block.endMinutes <= startMinutes) continue;
    if (found === null || block.startMinutes < found.startMinutes) {
      found = block;
    }
  }
  return found;
}

export const DecisionInputSystem = {
  /**
   * The {@link SlotFacts} of one decision: every read busy day's key
   * (sorted); for a slot refusal, the refused barber's day's colliding block
   * (`null` / `null` when that day was not read, holds no block at or after
   * the start, or there is no refusal); and the revision as given. Pure
   * (Law 3): local wall-clock minutes only (Law 7), inputs never written.
   */
  slotFacts(
    busyDays: readonly BarberBusyDay[],
    refusal: SlotRefusal | null,
    revision: number | null,
  ): SlotFacts {
    const readBusyKeys: BusyKey[] = [];
    let block: MinuteBlock | null = null;
    for (let i = 0; i < busyDays.length; i++) {
      const day = busyDays[i] as BarberBusyDay;
      readBusyKeys.push(BusyKey.of(day.barberId, day.localDate));
      if (
        block === null &&
        refusal !== null &&
        day.barberId === refusal.barberId &&
        day.localDate === refusal.localDate
      ) {
        block = collidingBlock(day, refusal.startMinutes);
      }
    }
    readBusyKeys.sort();
    return {
      readBusyKeys,
      collidingStartMinutes: block === null ? null : block.startMinutes,
      collidingEndMinutes: block === null ? null : block.endMinutes,
      readRevision: revision,
    };
  },
} as const;
