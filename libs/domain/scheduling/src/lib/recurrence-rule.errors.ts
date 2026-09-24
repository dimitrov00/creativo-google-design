import { DomainError } from '@creativo/domain/kernel';

export class InvalidRecurrenceIntervalError extends DomainError {
  override readonly code = 'scheduling.recurrence.invalid_interval' as const;
  constructor(
    public readonly interval: number,
    public readonly max: number,
  ) {
    super(
      `A recurrence repeats every 1…${max} periods — ${interval} is not one of them`,
      { interval, max },
    );
  }
}

export class EmptyRecurrenceWeekdaysError extends DomainError {
  override readonly code = 'scheduling.recurrence.no_weekdays' as const;
  constructor() {
    super(
      'A weekly recurrence must fall on at least one weekday — with none it would never occur',
    );
  }
}

export class InvalidRecurrenceDayError extends DomainError {
  override readonly code = 'scheduling.recurrence.invalid_day' as const;
  constructor(
    public readonly month: number | null,
    public readonly date: number,
  ) {
    super(
      month === null
        ? `Day ${date} of a month does not exist (expected 1…31)`
        : `${month}/${date} never occurs in any year`,
      { month, date },
    );
  }
}

export class InvalidRecurrenceCountError extends DomainError {
  override readonly code = 'scheduling.recurrence.invalid_count' as const;
  constructor(
    public readonly count: number,
    public readonly max: number,
  ) {
    super(
      `A recurrence ends after 1…${max} occurrences — ${count} is not one of them`,
      { count, max },
    );
  }
}

export type RecurrenceRuleError =
  | InvalidRecurrenceIntervalError
  | EmptyRecurrenceWeekdaysError
  | InvalidRecurrenceDayError
  | InvalidRecurrenceCountError;

export class RecurrenceEndsBeforeStartError extends DomainError {
  override readonly code = 'scheduling.recurrence.ends_before_start' as const;
  constructor(
    public readonly start: string,
    public readonly until: string,
  ) {
    super(`A series starting ${start} cannot end on ${until}`, {
      start,
      until,
    });
  }
}

export class RecurrenceNeverOccursError extends DomainError {
  override readonly code = 'scheduling.recurrence.never_occurs' as const;
  constructor(public readonly start: string) {
    super(
      `The rule has no occurrence between ${start} and its end — the series would write nothing`,
      { start },
    );
  }
}

export class RecurrenceTooLongError extends DomainError {
  override readonly code = 'scheduling.recurrence.too_long' as const;
  constructor(public readonly max: number) {
    super(`A series may hold at most ${max} occurrences`, { max });
  }
}

export type RecurrenceSeriesError =
  | RecurrenceEndsBeforeStartError
  | RecurrenceNeverOccursError
  | RecurrenceTooLongError;
