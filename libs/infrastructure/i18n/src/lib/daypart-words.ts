import { Daypart } from '@core/components';

/*
 * The parts of the shop's day as their catalogue key segment (UI residue
 * cleanup, UR-3; the `visit-list-words.ts` precedent) — the `morning` of
 * `booking.schedule.daypart.morning` (the booking time sheet's run heads)
 * and of `clientCard.visits.daypart.morning` (a waiting request's row). The
 * `Daypart` tags are SCREAMING; the words are not. ONE table, here because
 * two libs print them (the booking flow, the visits lib); each keeps its
 * own key prefix.
 */
export const daypartWords = {
  [Daypart.Morning]: 'morning',
  [Daypart.Afternoon]: 'afternoon',
  [Daypart.Evening]: 'evening',
} as const satisfies Record<Daypart, string>;

/** A part of the day's word — `'morning' | 'afternoon' | 'evening'`. */
export type DaypartWord = (typeof daypartWords)[Daypart];
