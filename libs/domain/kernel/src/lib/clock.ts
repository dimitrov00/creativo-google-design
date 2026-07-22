import { ZonedDateTime } from './zoned-date-time';

/**
 * Makes "the current instant" injectable/fakeable — the only sanctioned way
 * a domain factory or entity method may learn what time it is. No domain
 * code may call `Date.now()`/`new Date()` directly (blueprint §7.1); a real
 * adapter (system clock, fixed-for-testing clock) is supplied by whichever
 * layer composes the domain (use-case, test).
 */
export interface Clock {
  now(): ZonedDateTime;
}
