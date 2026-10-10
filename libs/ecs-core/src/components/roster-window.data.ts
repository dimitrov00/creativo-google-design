import type { BarberId } from '../entities/barber.entity';
import type { LocationId } from '../entities/location.entity';

/**
 * A stretch of a barber's rostered day at one shop, in wall-clock minutes of
 * that day — the **in-memory** output of `RosterSystem.buildDayWindows`
 * (`roster-window.ts:19`), never a stored shape. `locationId` rides on the
 * window, not the day, because a barber may work two shops in one day.
 * Half-open `[startMinutes, endMinutes)`; it becomes instants only against a
 * day row of the zone table.
 */
export type RosterWindow = {
  readonly barberId: BarberId;
  readonly locationId: LocationId;
  readonly startMinutes: number;
  readonly endMinutes: number;
};

export const RosterWindow = {
  of(
    barberId: BarberId,
    locationId: LocationId,
    startMinutes: number,
    endMinutes: number,
  ): RosterWindow {
    return { barberId, locationId, startMinutes, endMinutes };
  },

  durationMinutes(window: RosterWindow): number {
    return window.endMinutes - window.startMinutes;
  },
} as const;

/**
 * The shop's own opening hours for one day, in wall-clock minutes — the
 * in-memory envelope a roster window is clamped to (`roster-window.ts:39`).
 * A shop that publishes no hours, or is closed that day, is the caller's
 * `null` / empty list, never a zero-length struct.
 */
export type ShopDayHours = {
  readonly openMinutes: number;
  readonly closeMinutes: number;
};

export const ShopDayHours = {
  of(openMinutes: number, closeMinutes: number): ShopDayHours {
    return { openMinutes, closeMinutes };
  },
} as const;
