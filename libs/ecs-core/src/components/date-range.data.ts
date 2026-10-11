import type { LocalDate } from '../primitives/local-date.primitive';

/**
 * An inclusive span of shop days, `fromLocalDate … toLocalDate` — the shape a
 * month view and a materialisation horizon are both expressed in. Valid when
 * `fromLocalDate ≤ toLocalDate`; its days are `LocalDate.range(from, to)`.
 */
export type DateRange = {
  readonly fromLocalDate: LocalDate;
  readonly toLocalDate: LocalDate;
};

export const DateRange = {
  of(fromLocalDate: LocalDate, toLocalDate: LocalDate): DateRange {
    return { fromLocalDate, toLocalDate };
  },

  /** The end does not precede the start. */
  isValid(range: DateRange): boolean {
    return range.fromLocalDate <= range.toLocalDate;
  },

  /** Both ends included. */
  contains(range: DateRange, localDate: LocalDate): boolean {
    return range.fromLocalDate <= localDate && localDate <= range.toLocalDate;
  },
} as const;
