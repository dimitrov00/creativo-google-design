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

/**
 * A wall-clock time that does not exist, because a DST spring-forward
 * skipped it — `2026-03-29 03:30` in `Europe/Sofia` is never on the clock.
 *
 * This error exists because Luxon does NOT report it: it silently relocates
 * the instant an hour later and leaves `isValid` true (verified —
 * `03:30` becomes `04:30+03:00`). A scheduler that accepts that quietly
 * books a barber at a time the roster never claimed, once a year, and the
 * only symptom is a client arriving an hour late.
 */
export class NonexistentLocalTimeError extends DomainError {
  readonly code = 'nonexistent_local_time' as const;
  constructor(
    public readonly rawValue: string,
    public readonly zone: string,
  ) {
    super(
      `Local time "${rawValue}" does not exist in ${zone} — a DST transition skips it`,
      { rawValue, zone },
    );
  }
}

/**
 * A wall-clock time that happens TWICE, because a DST fall-back repeated it
 * — `2026-10-25 03:30` in `Europe/Sofia` occurs at both `+03:00` and
 * `+02:00`. Luxon silently picks the first. Which one a booking means is a
 * decision, not a default, so scheduling rejects it unless the caller says.
 */
export class AmbiguousLocalTimeError extends DomainError {
  readonly code = 'ambiguous_local_time' as const;
  constructor(
    public readonly rawValue: string,
    public readonly zone: string,
  ) {
    super(
      `Local time "${rawValue}" is ambiguous in ${zone} — a DST transition repeats it`,
      { rawValue, zone },
    );
  }
}

/** Everything wall-clock construction can reject. */
export type DateTimeResolutionError =
  | InvalidDateTimeError
  | InvalidTimeZoneError
  | NonexistentLocalTimeError
  | AmbiguousLocalTimeError;
