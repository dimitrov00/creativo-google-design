import { DomainError } from '@creativo/domain/kernel';

export class InvalidTimeOfDayError extends DomainError {
  override readonly code = 'scheduling.time_of_day.invalid' as const;
  constructor(public readonly rawValue: string) {
    super(
      `"${rawValue}" is not a usable time of day — expected HH:mm, and it must exist on the day in question`,
      { rawValue },
    );
  }
}

export class InvalidLocalTimeRangeError extends DomainError {
  override readonly code = 'scheduling.time_range.invalid' as const;
  constructor(
    public readonly start: string,
    public readonly end: string,
  ) {
    super(
      `Time range ${start}–${end} is invalid — the end must be strictly after the start, and a range may not cross midnight`,
      { start, end },
    );
  }
}

export type LocalTimeError = InvalidTimeOfDayError | InvalidLocalTimeRangeError;
