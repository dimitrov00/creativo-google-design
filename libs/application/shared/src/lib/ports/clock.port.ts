import {
  InvalidTimeZoneError,
  Result,
  ZonedDateTime,
} from '@creativo/domain/kernel';

/** Makes "current time" injectable/fakeable in tests — also the seam if `ZonedDateTime`'s backing library ever changes. */
export interface ClockPort {
  now(zone: string): Result<ZonedDateTime, InvalidTimeZoneError>;
}
