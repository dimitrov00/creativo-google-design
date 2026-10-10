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
 * to sweep up. Half-open `[startMs, endMs)`, so back to back is one person
 * walking across the room. Scanned sorted by `startMs`.
 */
export type StandingSeatPair = {
  readonly personKey: string;
  readonly startMs: number;
  readonly endMs: number;
};

export const StandingSeatPair = {
  of(personKey: string, startMs: number, endMs: number): StandingSeatPair {
    return { personKey, startMs, endMs };
  },

  /** The same person in overlapping spans — THE rule, for one pair. */
  sitsTwice(a: StandingSeatPair, b: StandingSeatPair): boolean {
    return (
      a.personKey === b.personKey && a.startMs < b.endMs && b.startMs < a.endMs
    );
  },

  /** Scan order: by start, then end, then person. */
  compare(a: StandingSeatPair, b: StandingSeatPair): number {
    if (a.startMs !== b.startMs) return a.startMs - b.startMs;
    if (a.endMs !== b.endMs) return a.endMs - b.endMs;
    return a.personKey < b.personKey ? -1 : a.personKey > b.personKey ? 1 : 0;
  },
} as const;
