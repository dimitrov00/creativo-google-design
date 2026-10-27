import type { ChairTime, MinuteRange } from '@core/components';
import type { BarberBusyDay } from '@core/entities';
import {
  type BarberId,
  BusyKey,
  type EndMinute,
  type LocalDate,
  type MinuteOfDay,
} from '@core/primitives';
import { IntervalSetSystem } from './interval-set.system';

/**
 * What a refused booking decision read (audit-hardening WS-4.2, RU-25) —
 * logged beside the refusal's `errorCode` by the booking, move and
 * staff-edit pipelines, never carried in the error (OR-12: an error is
 * never a data channel). Flat scalars and keys from the PUBLIC busy
 * geometry (no client, no service, no price): the busy days the decision
 * read, the taken span it provably ran into, and the stored visit's
 * revision.
 */
export type SlotFacts = {
  /** The busy days the decision read, as their keys — sorted, so the line is stable. */
  readonly readBusyKeys: readonly BusyKey[];
  /**
   * The start of the taken span holding the refused SOLD start on the
   * refused barber's day (its blocks minus the chairs the decision handed
   * back), or `null` when no taken span holds it — a refusal by a pad or
   * the turnaround alone, by the roster window, or by a sold end past
   * midnight names no block.
   */
  readonly collidingStartMinutes: MinuteOfDay | null;
  /** That span's exclusive end, or `null`. */
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
 * The span of `day` the refused start provably ran into. The decision
 * tests the seat's chair time against the barber's blocks minus the chairs
 * it was handed back (`release`, filtered by barber — the cut
 * `AvailabilitySystem.paddedBusy` makes, touching runs merged), padded by
 * the turnaround. The SOLD start lies inside the chair time, so a taken
 * span that HOLDS it (half-open) overlaps the chair: a real collider. Any
 * other span — a later block, one met only through a setup / cleanup pad
 * or the turnaround, the visit's own released chair — is not provably the
 * one, so it is never named (`null`). One sorted scan over the cut.
 */
function collidingSpan(
  day: BarberBusyDay,
  refusal: SlotRefusal,
  release: readonly ChairTime[],
): MinuteRange | null {
  const released: ChairTime[] = [];
  for (let i = 0; i < release.length; i++) {
    const chair = release[i] as ChairTime;
    if (chair.barberId === refusal.barberId) released.push(chair);
  }
  const taken = IntervalSetSystem.subtract(day.blocks, released);
  for (let i = 0; i < taken.length; i++) {
    const span = taken[i] as MinuteRange;
    if (span.startMinutes > refusal.startMinutes) break;
    if (refusal.startMinutes < span.endMinutes) return span;
  }
  return null;
}

export const DecisionInputSystem = {
  /**
   * The {@link SlotFacts} of one decision: every read busy day's key
   * (sorted); for a slot refusal, the taken span of the refused barber's
   * day that holds the refused sold start, once the chairs the decision
   * was handed back (`release` — exactly what `decide` got: `[]` for a new
   * booking, the moved or edited visit's own chairs otherwise) are cut out
   * (`null` / `null` when that day was not read, no taken span holds the
   * start, or there is no refusal); and the revision as given. Pure
   * (Law 3): local wall-clock minutes only (Law 7), inputs never written.
   */
  slotFacts(
    busyDays: readonly BarberBusyDay[],
    refusal: SlotRefusal | null,
    revision: number | null,
    release: readonly ChairTime[],
  ): SlotFacts {
    const readBusyKeys: BusyKey[] = [];
    let block: MinuteRange | null = null;
    for (let i = 0; i < busyDays.length; i++) {
      const day = busyDays[i] as BarberBusyDay;
      readBusyKeys.push(BusyKey.of(day.barberId, day.localDate));
      if (
        block === null &&
        refusal !== null &&
        day.barberId === refusal.barberId &&
        day.localDate === refusal.localDate
      ) {
        block = collidingSpan(day, refusal, release);
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
