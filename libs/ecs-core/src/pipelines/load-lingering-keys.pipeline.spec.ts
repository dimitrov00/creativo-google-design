import { describe, expect, it } from 'vitest';
import { BarberLifecycle, BarberStatus } from '@core/components';
import { BarberId, BusyKey, type LocalDate, Result } from '@core/primitives';
import { RepositoryError, RepositoryErrorCode } from '@core/errors';
import type { BarberBusyDay } from '@core/entities';
import {
  barberBusyDayFixture,
  barberFixture,
  FIXTURE_NOW_UTC_MS,
  localDate,
  unwrapErr,
  unwrapOk,
} from '@core/testing';
import { loadLingeringKeys } from './load-lingering-keys.pipeline';

/*
 * `loadLingeringKeys` (team onboarding D10, the leftover lane): one read
 * per leaver, from the day after their last working day, and the keys of
 * the days that still hold a block.
 */

const left = (id: string, last: string | null) =>
  barberFixture(
    {
      id: BarberId.of(id),
      barberLastWorkingLocalDate: last === null ? null : localDate(last),
    },
    BarberLifecycle.depart(FIXTURE_NOW_UTC_MS, null, BarberStatus.Public),
  );
const busy = (
  id: string,
  day: string,
  over: Partial<BarberBusyDay> = {},
): BarberBusyDay =>
  barberBusyDayFixture({
    barberId: BarberId.of(id),
    localDate: localDate(day),
    ...over,
  });

function rig(options: {
  readonly busyDays?: readonly BarberBusyDay[];
  /** The barber whose days cannot be read. */
  readonly failing?: string;
}) {
  const asked: { barberId: BarberId; from: LocalDate }[] = [];
  return {
    asked,
    run: loadLingeringKeys({
      loadBusyDaysFrom: async (barberId, from) => {
        asked.push({ barberId, from });
        return barberId === options.failing
          ? Result.err(RepositoryError.readFailed('barberBusy', 'unavailable'))
          : Result.ok(
              (options.busyDays ?? []).filter(
                (day) => day.barberId === barberId && day.localDate >= from,
              ),
            );
      },
    }),
  };
}

describe('loadLingeringKeys', () => {
  it('reads each leaver from the day after their last day, and keeps the keys of the days that hold a block', async () => {
    const { asked, run } = rig({
      busyDays: [
        busy('stefan', '2026-11-10'),
        busy('stefan', '2026-11-18'),
        busy('stefan', '2026-11-19', { blocks: [] }),
        busy('georgi', '2026-12-02'),
      ],
    });

    const held = unwrapOk(
      await run([left('stefan', '2026-11-10'), left('georgi', '2026-11-12')]),
    );

    expect([...held].sort()).toEqual(
      [
        BusyKey.of(BarberId.of('georgi'), localDate('2026-12-02')),
        BusyKey.of(BarberId.of('stefan'), localDate('2026-11-18')),
      ].sort(),
    );
    expect(asked).toEqual([
      { barberId: 'stefan', from: '2026-11-11' },
      { barberId: 'georgi', from: '2026-11-13' },
    ]);
  });

  it('reads nothing for nobody, and nothing for a leaver with no last working day', async () => {
    const { asked, run } = rig({});
    expect(unwrapOk(await run([])).size).toBe(0);
    expect(unwrapOk(await run([left('no-day', null)])).size).toBe(0);
    expect(asked).toEqual([]);
  });

  it('a read that fails is the answer’s refusal — never a guessed column', async () => {
    const { run } = rig({
      busyDays: [busy('stefan', '2026-11-18')],
      failing: 'georgi',
    });
    expect(
      unwrapErr(
        await run([left('stefan', '2026-11-10'), left('georgi', '2026-11-12')]),
      ).errorCode,
    ).toBe(RepositoryErrorCode.ReadFailed);
  });
});
