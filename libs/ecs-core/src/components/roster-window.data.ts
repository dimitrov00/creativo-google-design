import { MinuteCount } from '../primitives/duration-minutes.primitive';
import type { BarberId, LocationId } from '../primitives/ids.primitive';
import type {
  EndMinute,
  MinuteOfDay,
} from '../primitives/minute-of-day.primitive';

/**
 * A stretch of a barber's rostered day at one shop, on that shop day's wall
 * clock — the **in-memory** output of `RosterSystem.buildDayWindows`
 * (`roster-window.ts:19`), never a stored shape. `locationId` rides on the
 * window, not the day, because a barber may work two shops in one day.
 * Half-open `[startMinutes, endMinutes)`, structurally a `MinuteRange`; it
 * becomes an instant only at an ingestion boundary, with the location's zone.
 */
export type RosterWindow = {
  readonly barberId: BarberId;
  readonly locationId: LocationId;
  readonly startMinutes: MinuteOfDay;
  readonly endMinutes: EndMinute;
};

export const RosterWindow = {
  of(
    barberId: BarberId,
    locationId: LocationId,
    startMinutes: MinuteOfDay,
    endMinutes: EndMinute,
  ): RosterWindow {
    return { barberId, locationId, startMinutes, endMinutes };
  },

  durationMinutes(window: RosterWindow): MinuteCount {
    return MinuteCount.span(window.startMinutes, window.endMinutes);
  },
} as const;

/**
 * The shop's own opening hours for one day, on its wall clock — the
 * in-memory envelope a roster window is clamped to (`roster-window.ts:39`).
 * A shop that publishes no hours, or is closed that day, is the caller's
 * `null` / empty list, never a zero-length struct.
 */
export type ShopDayHours = {
  readonly openMinutes: MinuteOfDay;
  readonly closeMinutes: EndMinute;
};

export const ShopDayHours = {
  of(openMinutes: MinuteOfDay, closeMinutes: EndMinute): ShopDayHours {
    return { openMinutes, closeMinutes };
  },
} as const;
