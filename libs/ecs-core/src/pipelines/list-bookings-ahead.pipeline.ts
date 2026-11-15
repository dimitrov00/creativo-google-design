import { type BarberId, LocalDate, Result } from '@core/primitives';
import type { RepositoryError } from '@core/errors';
import type { Appointment } from '@core/entities';
import type { BarberAheadPorts } from '@core/ports';
import { EmploymentSystem } from '@core/systems';

/**
 * `listBookingsAhead` — the visits a barber has after a day (team
 * onboarding D10): what a last working day would leave behind, read in the
 * browser for the period sheet and a leaver's page. Nothing is written and
 * nothing is cancelled: the owner is shown the visits that stand after the
 * day, and moves or cancels them.
 *
 * 1. **The busy days** after the last day, one query on the projection's
 *    own index — only the days that exist are read, never one document per
 *    day of the horizon.
 * 2. **Each of those days' visits**, one single-field query per day that
 *    holds a block (`EmploymentSystem.keysAfter`), side by side. No new
 *    composite index: these are the reads the day sheet already makes.
 * 3. **The answer** is `EmploymentSystem.leftoverVisitsOf`: the live visits
 *    that seat this barber after the day, each once, oldest first — the
 *    entities as they were read, so a screen lists them, dots their days
 *    and counts them (`leftoverOf`) with no second read.
 *
 * A read that fails is the answer's `RepositoryError`: the sheet says it
 * could not tell, never that nothing is left.
 */
export const listBookingsAhead =
  (ports: BarberAheadPorts) =>
  async (
    barberId: BarberId,
    lastLocalDate: LocalDate,
  ): Promise<Result<readonly Appointment[], RepositoryError>> => {
    const busyDays = await ports.loadBusyDaysFrom(
      barberId,
      LocalDate.addDays(lastLocalDate, 1),
    );
    if (!busyDays.ok) return busyDays;
    const days = await Promise.all(
      EmploymentSystem.keysAfter(busyDays.value, lastLocalDate).map((key) =>
        ports.loadBarberDay(key),
      ),
    );
    const visits: Appointment[] = [];
    for (const day of days) {
      if (!day.ok) return day;
      visits.push(...day.value);
    }
    return Result.ok(
      EmploymentSystem.leftoverVisitsOf(visits, barberId, lastLocalDate),
    );
  };
