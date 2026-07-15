import { DomainError } from '@creativo/domain/kernel';

export class InvalidTimeOfDayError extends DomainError {
  readonly code = 'invalid_time_of_day' as const;
  constructor(public readonly rawValue: string) {
    super(`Invalid time of day "${rawValue}" — expected HH:mm`, { rawValue });
  }
}

export class InvalidWorkingHoursRangeError extends DomainError {
  readonly code = 'invalid_working_hours_range' as const;
  constructor(public readonly weekday: string) {
    super(`Working hours end must be after start for ${weekday}`, { weekday });
  }
}
