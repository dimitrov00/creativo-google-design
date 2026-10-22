import { Injectable } from '@angular/core';
import {
  InvalidTimeZoneError,
  Result,
  ZonedDateTime,
} from '@creativo/domain/kernel';
import { ClockPort } from '@creativo/application/shared';

/**
 * `ClockPort` backed by the wall clock — the browser's own. The functions
 * app has no clock class: its pipelines read the instant through
 * `ClockPorts.nowUtcMs`, which its composition root
 * (`apps/functions/src/main.ts`) binds once (functions and web are
 * different deployables and neither may depend on the other). The only
 * sanctioned way a component/store learns "now" (blueprint §7.1) — never
 * `new Date()`/`Date.now()` directly.
 */
@Injectable()
export class SystemClock implements ClockPort {
  now(zone: string): Result<ZonedDateTime, InvalidTimeZoneError> {
    return ZonedDateTime.now(zone);
  }
}
