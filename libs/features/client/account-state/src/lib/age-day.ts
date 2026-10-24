import type { ClockPorts } from '@core/ports';
import type { LocalDate } from '@core/primitives';
import { AgeSystem } from '@core/systems';

/**
 * The day an owner's birth date is judged on — the 16–120 age window of
 * `ProfileEditSystem` and `AgeSystem` (identity flip (2), F2-7).
 *
 * It is the UTC civil date, as every writer judges it (the server's
 * `completeRegistration` and `updateProfile`, the profile page, the
 * onboarding birthday step), derived ONCE at this boundary from the one
 * `CLOCK_PORTS` reading: the instant, then `AgeSystem.judgedOn` (the UTC
 * civil date, `TimeZone.UTC`). Total (Phase 4a): the browser clock always
 * answers an instant (`browserClockPorts` treats an unreadable host clock as
 * a defect), so there is no "no day" to refuse.
 */
export function ageDayOf(clock: ClockPorts): LocalDate {
  return AgeSystem.judgedOn(clock.nowUtcMs());
}
