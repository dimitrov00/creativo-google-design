import type { SeatKeyText, EndMinute, MinuteOfDay } from '@core/primitives';

/**
 * A SOLD span and the person who sits in it — the unit of "one person, one
 * chair at a time" (owner decision 2026-09-25; `person-slot.ts:85`, the
 * legacy `PersonSlot`). **In-memory** only: the input of
 * `SeatingRuleSystem.sitsTwiceAt`, which the availability engine and the
 * booking decision both ask, so a grid can never offer an arrangement the
 * server refuses for this reason.
 *
 * `personKey` is opaque — whatever the caller counts people by (`self`,
 * `account:<uid>`, `guest:<label>`); the rule only compares two keys for
 * equality. The span is the SERVICE, never the chair time around it: a cut
 * that ends at 10:45 frees its person at 10:45, whatever the barber still has
 * to sweep up. Half-open `[startMinutes, endMinutes)` on the visit's ONE shop
 * day (T7), so back to back is one person walking across the room. Scanned
 * sorted by `startMinutes`.
 */
export type StandingSeatPair = {
  readonly personKey: SeatKeyText;
  readonly startMinutes: MinuteOfDay;
  readonly endMinutes: EndMinute;
};

export const StandingSeatPair = {
  of(
    personKey: SeatKeyText,
    startMinutes: MinuteOfDay,
    endMinutes: EndMinute,
  ): StandingSeatPair {
    return { personKey, startMinutes, endMinutes };
  },

  /** The same person in overlapping spans — THE rule, for one pair. */
  sitsTwice(a: StandingSeatPair, b: StandingSeatPair): boolean {
    return (
      a.personKey === b.personKey &&
      a.startMinutes < b.endMinutes &&
      b.startMinutes < a.endMinutes
    );
  },

  /** Scan order: by start, then end, then person. */
  compare(a: StandingSeatPair, b: StandingSeatPair): number {
    if (a.startMinutes !== b.startMinutes) {
      return a.startMinutes - b.startMinutes;
    }
    if (a.endMinutes !== b.endMinutes) return a.endMinutes - b.endMinutes;
    return a.personKey < b.personKey ? -1 : a.personKey > b.personKey ? 1 : 0;
  },
} as const;
