import type { LocalDate } from '@core/primitives';

/**
 * A barber's working period on the shop wall clock (team onboarding D2):
 * the first shop day they work and, once set, the last. Admin-owned, flat
 * at the root of the `Barber` archetype (Law 6), and deliberately NOT on
 * the roster: every hours save rewrites the roster's versions
 * (`ScheduleVersion.replaceFrom`), which would move a start or erase a last
 * day. Bookability ignores roster days outside this period.
 */
export type BarberEmployment = {
  readonly barberStartsLocalDate: LocalDate;
  /** The last working day, or `null` while no end is set. */
  readonly barberLastWorkingLocalDate: LocalDate | null;
};

export const BarberEmployment = {
  /**
   * Whether `localDate` lies inside the working period, both ends
   * inclusive. Shop days compare as `YYYY-MM-DD` strings.
   */
  covers(employment: BarberEmployment, localDate: LocalDate): boolean {
    if (localDate < employment.barberStartsLocalDate) return false;
    const last = employment.barberLastWorkingLocalDate;
    return last === null || localDate <= last;
  },
} as const;
