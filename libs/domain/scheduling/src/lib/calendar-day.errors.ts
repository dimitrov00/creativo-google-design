import { DomainError } from '@creativo/domain/kernel';

export class InvalidCalendarDayError extends DomainError {
  override readonly code = 'scheduling.calendar_day.invalid' as const;
  constructor(public readonly rawValue: string) {
    super(
      `"${rawValue}" is not a real calendar day in the given zone (expected YYYY-MM-DD)`,
      { rawValue },
    );
  }
}

export class InvalidDateRangeError extends DomainError {
  override readonly code = 'scheduling.date_range.invalid' as const;
  constructor(
    public readonly from: string,
    public readonly to: string,
  ) {
    super(
      `Date range ${from}…${to} is invalid — the end precedes the start, or the two are in different zones`,
      { from, to },
    );
  }
}
