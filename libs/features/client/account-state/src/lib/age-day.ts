import { UTC_ZONE } from '@core/pipelines';
import type { ClockPorts } from '@core/ports';
import type { LocalDate } from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';

/**
 * The day an owner's birth date is judged on — the 16–120 age window of
 * `ProfileEditSystem` and `AgeSystem` (identity flip (2), F2-7).
 *
 * It is the UTC civil date, as every writer judges it (the server's
 * `completeRegistration` and `updateProfile`, the profile page, the
 * onboarding birthday step), derived ONCE at this boundary from the one
 * `CLOCK_PORTS` reading: the instant, then `ZonedTimeSystem.toLocal` on the
 * `UTC_ZONE` of `@core/pipelines`. Total (Phase 4a): the browser clock
 * always answers an instant (`browserClockPorts` treats an unreadable host
 * clock as a defect), so there is no "no day" to refuse.
 */
export function ageDayOf(clock: ClockPorts): LocalDate {
  return ZonedTimeSystem.toLocal(clock.nowUtcMs(), UTC_ZONE).localDate;
}
