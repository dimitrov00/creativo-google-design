import { DomainError } from './domain-error';

export class InvalidDateTimeError extends DomainError {
  readonly code = 'invalid_date_time' as const;
  constructor(
    public readonly rawValue: string,
    public readonly reason: string,
  ) {
    super(`Invalid date/time "${rawValue}": ${reason}`, { rawValue, reason });
  }
}

export class InvalidTimeZoneError extends DomainError {
  readonly code = 'invalid_time_zone' as const;
  constructor(public readonly rawZone: string) {
    super(`Invalid IANA time zone: "${rawZone}"`, { rawZone });
  }
}
