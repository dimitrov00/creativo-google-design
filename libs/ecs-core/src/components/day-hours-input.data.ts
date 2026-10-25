import type { DayHours, OpeningState } from './opening-hours.data';

/**
 * A week day in minutes as authored or stored, before its edge guard
 * (`DayHours.parseWeek` reads it; split out of `opening-hours.data.ts`,
 * pass D D-7: the landing's locations component reads it too).
 */
export type DayHoursInput =
  | DayHours.Closed
  | {
      readonly openingState: typeof OpeningState.Open;
      readonly openMinutes: number;
      readonly closeMinutes: number;
    };
