import { ClockPort } from '@creativo/application/shared';
import {
  InvalidTimeZoneError,
  Result,
  ZonedDateTime,
} from '@creativo/domain/kernel';

export class SystemClock implements ClockPort {
  now(zone: string): Result<ZonedDateTime, InvalidTimeZoneError> {
    return ZonedDateTime.now(zone);
  }
}
