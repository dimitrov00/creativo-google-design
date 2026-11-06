import type { LocalDate } from '@core/primitives';

/**
 * How a series stops — iCalendar's `UNTIL` (inclusive) or `COUNT`, or never
 * (an RRULE with neither, Monzo's «Never»: a stored series written ahead a
 * rolling horizon, `RecurrenceRule.WRITE_AHEAD_DAYS`); named after the field
 * it types (`recurrenceEnd`).
 */
export const RecurrenceEnd = {
  Until: 'UNTIL',
  Count: 'COUNT',
  Never: 'NEVER',
} as const;
export type RecurrenceEnd = (typeof RecurrenceEnd)[keyof typeof RecurrenceEnd];

/**
 * How a series stops — a flat variant slice of {@link RecurrenceRule}:
 * inclusively on a shop day (`untilLocalDate`), or after `occurrenceCount`
 * days. Split out of `recurrence-rule.data.ts` (pass D, D-7), with the
 * dictionary of its own field.
 */
export type RecurrenceEndRule =
  RecurrenceEndRule.Until | RecurrenceEndRule.Count | RecurrenceEndRule.Never;

export const RecurrenceEndRule = {
  until(untilLocalDate: LocalDate): RecurrenceEndRule.Until {
    return { recurrenceEnd: RecurrenceEnd.Until, untilLocalDate };
  },
  count(occurrenceCount: number): RecurrenceEndRule.Count {
    return { recurrenceEnd: RecurrenceEnd.Count, occurrenceCount };
  },
  never(): RecurrenceEndRule.Never {
    return { recurrenceEnd: RecurrenceEnd.Never };
  },

  /** The end slice of anything that carries one (a whole rule), as a fresh struct. */
  sliceOf<T extends RecurrenceEndRule>(end: T): RecurrenceEndRule {
    switch (end.recurrenceEnd) {
      case RecurrenceEnd.Until:
        return RecurrenceEndRule.until(end.untilLocalDate);
      case RecurrenceEnd.Count:
        return RecurrenceEndRule.count(end.occurrenceCount);
      case RecurrenceEnd.Never:
        return RecurrenceEndRule.never();
    }
  },

  equals(a: RecurrenceEndRule, b: RecurrenceEndRule): boolean {
    if (a.recurrenceEnd === RecurrenceEnd.Never) {
      return b.recurrenceEnd === RecurrenceEnd.Never;
    }
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
  export type Never = {
    readonly recurrenceEnd: typeof RecurrenceEnd.Never;
  };
}
