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

/**
 * The working periods a barber finished BEFORE the current one (account
 * first, A8 — `docs/architecture/decisions/2026-11-16-account-first-team.md`):
 * one entry per return to the team, oldest first. «Върни в екипа» moves
 * the period that ended into it; nothing else writes it. A true 1-to-N
 * relation (Law 5): a short array of flat structs, never queried. The
 * audit log keeps every leave and return beside it.
 */
export type BarberHistory = {
  readonly barberPastPeriods: readonly BarberHistory.PastPeriod[];
};

export const BarberHistory = {
  /** A record that has never left. */
  NONE: [] as readonly BarberHistory.PastPeriod[],

  /** `history` with the period that just ended kept last. */
  withEnded(
    history: BarberHistory,
    period: BarberHistory.PastPeriod,
  ): readonly BarberHistory.PastPeriod[] {
    return [...history.barberPastPeriods, period];
  },
} as const;

export namespace BarberHistory {
  /** One working period that ended: its first and its last day, both inclusive. */
  export type PastPeriod = {
    readonly pastStartsLocalDate: LocalDate;
    readonly pastLastWorkingLocalDate: LocalDate;
  };
}
