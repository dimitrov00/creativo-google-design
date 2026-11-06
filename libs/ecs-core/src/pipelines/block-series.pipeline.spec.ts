import { describe, expect, it } from 'vitest';
import {
  BlockSeriesScope,
  ExceptionEffectRule,
  MinuteRange,
  RecurrenceEnd,
  RecurrenceEndRule,
  RecurrencePattern,
  RecurrenceRule,
} from '@core/components';
import type { BlockSeries, ScheduleException } from '@core/entities';
import { SchedulingErrorCode } from '@core/errors';
import {
  BarberId,
  type LocalDate,
  LocationId,
  Result,
  UtcEpochMs,
  Weekday,
} from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import {
  FIXTURE_TIME_ZONE,
  endMinute,
  localDate,
  locationFixture,
  memoryBlockSeriesPorts,
  minute,
  unwrapOk,
} from '@core/testing';
import {
  createBlockSeries,
  editBlockSeries,
  topUpBlockSeries,
} from './block-series.pipeline';

/*
 * A chair's repeating block (owner, 2026-11-06): the days and the series
 * land together, an edit reaches as far as asked, a series somebody changed
 * is refused, and a series that never ends is written ahead each day.
 */
const IVAN = BarberId.of('ivan');
const SHOP = LocationId.of('loc-center');
const span = (from: number, to: number): MinuteRange =>
  MinuteRange.of(minute(from), endMinute(to));
const LUNCH = span(13 * 60, 14 * 60);
const LATER = span(13 * 60 + 30, 14 * 60 + 30);
const MONDAY = localDate('2026-11-09');

const weekdays = (end: RecurrenceEndRule) =>
  unwrapOk(
    RecurrenceRule.create(
      RecurrencePattern.weekly([
        Weekday.Mon,
        Weekday.Tue,
        Weekday.Wed,
        Weekday.Thu,
        Weekday.Fri,
      ]),
      1,
      end,
    ),
  );

function rig(): {
  exceptions: ScheduleException[];
  series: BlockSeries[];
  ports: ReturnType<typeof memoryBlockSeriesPorts> & {
    readonly nextId: () => string;
  };
} {
  const exceptions: ScheduleException[] = [];
  const series: BlockSeries[] = [];
  let n = 0;
  return {
    exceptions,
    series,
    ports: {
      ...memoryBlockSeriesPorts(exceptions, series),
      nextId: () => `series-${++n}`,
    },
  };
}

const rangesOn = (exceptions: readonly ScheduleException[], day: LocalDate) => {
  const found = exceptions.find((entry) => entry.localDate === day);
  return found && 'exceptionRanges' in found ? found.exceptionRanges : [];
};

const create = (
  ports: ReturnType<typeof rig>['ports'],
  end: RecurrenceEndRule = RecurrenceEndRule.until(localDate('2026-11-20')),
) =>
  createBlockSeries(ports)({
    barberId: IVAN,
    locationId: SHOP,
    timeZone: FIXTURE_TIME_ZONE,
    range: LUNCH,
    startLocalDate: MONDAY,
    rule: weekdays(end),
  });

describe('createBlockSeries', () => {
  it('blocks every day of the rule and stores the series beside them', async () => {
    const { ports, exceptions, series } = rig();
    const made = unwrapOk(await create(ports));
    expect(series).toEqual([made]);
    expect(exceptions).toHaveLength(10);
    expect(rangesOn(exceptions, MONDAY)).toEqual([LUNCH]);
    // The public effect stays sanitised: no series id, no reason.
    expect(exceptions[0]).not.toHaveProperty('seriesId');
  });

  it('refuses a rule that never lands before anything is written', async () => {
    const { ports, exceptions, series } = rig();
    const refused = await create(
      ports,
      RecurrenceEndRule.until(localDate('2026-11-01')),
    );
    expect(refused.ok).toBe(false);
    expect(exceptions).toEqual([]);
    expect(series).toEqual([]);
  });
});

describe('editBlockSeries', () => {
  it('«Само този ден»: moves the one day and lets it go from the series', async () => {
    const { ports, exceptions, series } = rig();
    const made = unwrapOk(await create(ports));
    const wednesday = localDate('2026-11-11');
    unwrapOk(
      await editBlockSeries(ports)({
        series: made,
        localDate: wednesday,
        scope: BlockSeriesScope.ThisDay,
        range: LATER,
        timeZone: FIXTURE_TIME_ZONE,
      }),
    );
    expect(rangesOn(exceptions, wednesday)).toEqual([LATER]);
    expect(rangesOn(exceptions, localDate('2026-11-12'))).toEqual([LUNCH]);
    expect(series[0]?.localDates).not.toContain(wednesday);
  });

  it('«Този и следващите»: rewrites that day on and cuts the series in two', async () => {
    const { ports, exceptions, series } = rig();
    const made = unwrapOk(await create(ports));
    unwrapOk(
      await editBlockSeries(ports)({
        series: made,
        localDate: localDate('2026-11-12'),
        scope: BlockSeriesScope.Following,
        range: LATER,
        timeZone: FIXTURE_TIME_ZONE,
      }),
    );
    expect(rangesOn(exceptions, localDate('2026-11-11'))).toEqual([LUNCH]);
    expect(rangesOn(exceptions, localDate('2026-11-12'))).toEqual([LATER]);
    expect(rangesOn(exceptions, localDate('2026-11-20'))).toEqual([LATER]);
    expect(series.map((entry) => entry.localDates.length)).toEqual([3, 7]);
    expect(series[1]?.startLocalDate).toBe('2026-11-12');
  });

  it('lifts that day on, deleting the series when nothing is left of it', async () => {
    const { ports, exceptions, series } = rig();
    const made = unwrapOk(await create(ports));
    unwrapOk(
      await editBlockSeries(ports)({
        series: made,
        localDate: MONDAY,
        scope: BlockSeriesScope.Following,
        range: null,
        timeZone: FIXTURE_TIME_ZONE,
      }),
    );
    expect(exceptions).toEqual([]);
    expect(series).toEqual([]);
  });

  it('keeps the rest of a day’s blocked time when it lifts the series’ range', async () => {
    const { ports, exceptions } = rig();
    const made = unwrapOk(await create(ports));
    const morning = span(9 * 60, 10 * 60);
    exceptions.splice(0, 1, {
      ...exceptions[0],
      ...unwrapOk(ExceptionEffectRule.blocked([morning, LUNCH])),
    } as ScheduleException);
    unwrapOk(
      await editBlockSeries(ports)({
        series: made,
        localDate: MONDAY,
        scope: BlockSeriesScope.ThisDay,
        range: null,
        timeZone: FIXTURE_TIME_ZONE,
      }),
    );
    expect(rangesOn(exceptions, MONDAY)).toEqual([morning]);
  });

  it('refuses an edit of a series somebody changed since it was read, writing nothing', async () => {
    const { ports, exceptions, series } = rig();
    const made = unwrapOk(await create(ports));
    unwrapOk(
      await editBlockSeries(ports)({
        series: made,
        localDate: localDate('2026-11-11'),
        scope: BlockSeriesScope.ThisDay,
        range: LATER,
        timeZone: FIXTURE_TIME_ZONE,
      }),
    );
    const before = structuredClone(exceptions);
    const stale = await editBlockSeries(ports)({
      series: made,
      localDate: localDate('2026-11-13'),
      scope: BlockSeriesScope.Following,
      range: LATER,
      timeZone: FIXTURE_TIME_ZONE,
    });
    expect(stale.ok ? null : stale.error.errorCode).toBe(
      SchedulingErrorCode.BlockSeriesMoved,
    );
    expect(exceptions).toEqual(before);
    expect(series).toHaveLength(1);
  });
});

describe('topUpBlockSeries', () => {
  it('writes a series that never ends ahead in its shop’s day, and leaves the others alone', async () => {
    const { ports, exceptions, series } = rig();
    unwrapOk(await create(ports, RecurrenceEndRule.never()));
    unwrapOk(await create(ports));
    const written = exceptions.length;
    // A week after the start, in the shop's zone.
    const now = ZonedTimeSystem.startOfLocalDay(
      localDate('2026-11-16'),
      FIXTURE_TIME_ZONE,
    );
    const report = unwrapOk(
      await topUpBlockSeries({
        ...ports,
        nowUtcMs: () => UtcEpochMs.plusMs(now, 60_000),
        loadLocation: async () =>
          Result.ok(locationFixture({ id: SHOP, timeZone: FIXTURE_TIME_ZONE })),
      })(),
    );
    expect(report).toEqual({ written: 1, failed: [] });
    expect(exceptions.length).toBe(written + 5);
    const endless = series.find(
      (entry) => entry.recurrenceEnd === RecurrenceEnd.Never,
    );
    expect(endless?.localDates[0]).toBe('2026-11-16');
  });
});
