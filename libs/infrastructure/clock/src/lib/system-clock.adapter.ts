import { Injectable } from '@angular/core';
import {
  InvalidTimeZoneError,
  Result,
  ZonedDateTime,
} from '@creativo/domain/kernel';
import { ClockPort } from '@creativo/application/shared';

/**
 * `ClockPort` backed by the wall clock — the browser counterpart to
 * `apps/functions/src/adapters/system-clock.ts` (same shape, separate
 * copy: functions and web are different deployables and neither may
 * depend on the other). The only sanctioned way a component/store learns
 * "now" (blueprint §7.1) — never `new Date()`/`Date.now()` directly.
 */
@Injectable()
export class SystemClock implements ClockPort {
  now(zone: string): Result<ZonedDateTime, InvalidTimeZoneError> {
    return ZonedDateTime.now(zone);
  }
}
