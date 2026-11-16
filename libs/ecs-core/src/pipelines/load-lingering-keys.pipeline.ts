import { type BusyKey, LocalDate, Result } from '@core/primitives';
import type { RepositoryError } from '@core/errors';
import type { Barber } from '@core/entities';
import type { BusyDaysAheadPorts } from '@core/ports';
import { EmploymentSystem } from '@core/systems';

/**
 * `loadLingeringKeys` — the days the barbers who have left are still
 * booked on (team onboarding D10, the leftover lane), as the keys a day's
 * visits are read by. The schedule asks once when it opens, then keeps a
 * column for a leaver only on a day whose key is here.
 *
 * One query per leaver, on the busy projection's own index, from the day
 * after their last working day; `EmploymentSystem.keysAfter` keeps the
 * days that hold a block. The leavers are the handful
 * `EmploymentSystem.lingerCandidates` names, so this is a handful of
 * reads, side by side — never one per day shown.
 *
 * A read that fails is the answer's `RepositoryError`: the schedule then
 * draws no leaver's column rather than guess at one. A leaver with no
 * last working day is skipped: they worked no period to leave visits
 * after.
 */
export const loadLingeringKeys =
  (ports: BusyDaysAheadPorts) =>
  async (
    leavers: readonly Barber[],
  ): Promise<Result<ReadonlySet<BusyKey>, RepositoryError>> => {
    const read = await Promise.all(
      leavers.map(async (leaver) => {
        const last = leaver.barberLastWorkingLocalDate;
        if (last === null) return Result.ok<readonly BusyKey[]>([]);
        const days = await ports.loadBusyDaysFrom(
          leaver.id,
          LocalDate.addDays(last, 1),
        );
        return Result.map(days, (value) =>
          EmploymentSystem.keysAfter(value, last),
        );
      }),
    );
    const held = new Set<BusyKey>();
    for (const keys of read) {
      if (!keys.ok) return keys;
      for (const key of keys.value) held.add(key);
    }
    return Result.ok(held);
  };
