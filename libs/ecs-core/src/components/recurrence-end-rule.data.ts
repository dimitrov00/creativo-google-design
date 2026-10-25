import type { LocalDate } from '@core/primitives';

/**
 * How a series stops — iCalendar's `UNTIL` (inclusive) or `COUNT`; named
 * after the field it types (`recurrenceEnd`).
 */
export const RecurrenceEnd = {
  Until: 'UNTIL',
  Count: 'COUNT',
} as const;
export type RecurrenceEnd = (typeof RecurrenceEnd)[keyof typeof RecurrenceEnd];

/**
 * How a series stops — a flat variant slice of {@link RecurrenceRule}:
 * inclusively on a shop day (`untilLocalDate`), or after `occurrenceCount`
 * days. Split out of `recurrence-rule.data.ts` (pass D, D-7), with the
 * dictionary of its own field.
 */
export type RecurrenceEndRule =
  RecurrenceEndRule.Until | RecurrenceEndRule.Count;

export const RecurrenceEndRule = {
  until(untilLocalDate: LocalDate): RecurrenceEndRule.Until {
    return { recurrenceEnd: RecurrenceEnd.Until, untilLocalDate };
  },
  count(occurrenceCount: number): RecurrenceEndRule.Count {
    return { recurrenceEnd: RecurrenceEnd.Count, occurrenceCount };
  },

  /** The end slice of anything that carries one (a whole rule), as a fresh struct. */
  of(end: RecurrenceEndRule): RecurrenceEndRule {
    return end.recurrenceEnd === RecurrenceEnd.Until
      ? RecurrenceEndRule.until(end.untilLocalDate)
      : RecurrenceEndRule.count(end.occurrenceCount);
  },

  equals(a: RecurrenceEndRule, b: RecurrenceEndRule): boolean {
    if (a.recurrenceEnd === RecurrenceEnd.Until) {
      return (
        b.recurrenceEnd === RecurrenceEnd.Until &&
        a.untilLocalDate === b.untilLocalDate
      );
    }
    return (
      b.recurrenceEnd === RecurrenceEnd.Count &&
      a.occurrenceCount === b.occurrenceCount
    );
  },
} as const;

export namespace RecurrenceEndRule {
  export type Until = {
    readonly recurrenceEnd: typeof RecurrenceEnd.Until;
    readonly untilLocalDate: LocalDate;
  };
  export type Count = {
    readonly recurrenceEnd: typeof RecurrenceEnd.Count;
    readonly occurrenceCount: number;
  };
}
