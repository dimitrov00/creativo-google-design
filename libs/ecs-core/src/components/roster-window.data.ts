import {
  MinuteCount,
  type BarberId,
  type LocationId,
  type EndMinute,
  type MinuteOfDay,
} from '@core/primitives';

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
