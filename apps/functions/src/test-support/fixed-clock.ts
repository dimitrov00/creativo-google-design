import type { ClockPort } from '@creativo/application/shared';
import {
  InvalidTimeZoneError,
  Result,
  ZonedDateTime,
  fail,
  ok,
} from '@creativo/domain/kernel';

/**
 * A frozen, steppable `ClockPort` for use-case specs, so no spec ever reads
 * the real time. It keeps the port's own contract: an unknown zone answers
 * the port's `InvalidTimeZoneError`, while an unparsable instant is a broken
 * fixture and throws rather than posing as a clock failure.
 */
export class FixedClock implements ClockPort {
  constructor(private iso: string) {}

  now(zone: string): Result<ZonedDateTime, InvalidTimeZoneError> {
    if (!ZonedDateTime.isValidZone(zone)) {
      return fail(new InvalidTimeZoneError(zone));
    }
    const at = ZonedDateTime.fromISO(this.iso, zone);
    if (at.isFailure()) {
      throw new Error(`FixedClock fixture: ${at.error.message}`);
    }
    return ok(at.value);
  }

  /** Moves the frozen instant, for the "later" step of a TTL or rate-limit spec. */
  advance(iso: string): void {
    this.iso = iso;
  }
}
