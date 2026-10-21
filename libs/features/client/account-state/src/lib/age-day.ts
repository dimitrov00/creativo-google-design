import type { ClockPort } from '@creativo/application/shared';
import { UTC_ZONE } from '@core/pipelines';
import { type LocalDate, UtcEpochMs } from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';

/**
 * The day an owner's birth date is judged on — the 16–120 age window of
 * `ProfileEditSystem` and `AgeSystem` (identity flip (2), F2-7).
 *
 * It is the UTC civil date, as every writer judges it today (the server's
 * `completeRegistration` and `updateProfile`, the profile page, the
 * onboarding birthday step), derived ONCE at this boundary from the store's
 * one `CLOCK` reading: the instant, then `ZonedTimeSystem.toLocal` on the
 * `UTC_ZONE` of `@core/pipelines`. No system takes an instant for it.
 * `null` only if the clock could not answer (the hardcoded `'UTC'` always
 * resolves) — the caller then refuses honestly instead of guessing a day.
 */
export function ageDayOf(clock: ClockPort): LocalDate | null {
  const now = clock.now('UTC');
  if (now.isFailure()) return null;
  const instant = UtcEpochMs.of(now.value.toMillis());
  return instant.ok
    ? ZonedTimeSystem.toLocal(instant.value, UTC_ZONE).localDate
    : null;
}
