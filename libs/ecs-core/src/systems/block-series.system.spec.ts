import { describe, expect, it } from 'vitest';
import {
  BlockSeriesScope,
  MinuteRange,
  RecurrenceEnd,
  RecurrenceEndRule,
  RecurrencePattern,
  RecurrenceRule,
} from '@core/components';
import type { BlockSeries } from '@core/entities';
import {
  BarberId,
  BlockSeriesId,
  EndMinute,
  LocalDate,
  LocationId,
  MinuteOfDay,
  Weekday,
} from '@core/primitives';
import { deepFreeze, unwrapOk } from '@core/testing';
import { BlockSeriesSystem } from './block-series.system';

const day = (raw: string) => unwrapOk(LocalDate.parse(raw));
const lunch = MinuteRange.of(
  MinuteOfDay.ofProven(780),
  EndMinute.ofProven(840),
);
const later = MinuteRange.of(
  MinuteOfDay.ofProven(810),
  EndMinute.ofProven(870),
);
const ivan = BarberId.of('ivan');
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

/** Lunch 13:00–14:00 every weekday of 2026-11-09 … 2026-11-20 (Mon–Fri ×2). */
const series = (
  end: RecurrenceEndRule = RecurrenceEndRule.until(day('2026-11-20')),
): BlockSeries =>
  unwrapOk(
    BlockSeriesSystem.create({
      id: BlockSeriesId.of('s-1'),
      barberId: ivan,
      locationId: LocationId.of('shop'),
      range: lunch,
      startLocalDate: day('2026-11-09'),
      rule: weekdays(end),
    }),
  );

let minted = 0;
const nextId = () => BlockSeriesId.of(`s-new-${++minted}`);

describe('BlockSeriesSystem — a chair’s repeating block', () => {
  it('binds the rule to its first day and lists the days it writes', () => {
    expect(series().localDates).toHaveLength(10);
    expect(series().localDates[0]).toBe('2026-11-09');
    expect(series().localDates.at(-1)).toBe('2026-11-20');
  });

  it('writes a series that never ends to the 26-week horizon, never refusing it', () => {
    const never = series(RecurrenceEndRule.never());
    expect(never.recurrenceEnd).toBe(RecurrenceEnd.Never);
    // 26 weeks of weekdays from a Monday, the 183rd day a Monday again.
    expect(never.localDates).toHaveLength(26 * 5 + 1);
  });

  it('knows a day’s range for the series’ only while the day is listed and the minutes are its own', () => {
    const all = [series()];
    expect(
      BlockSeriesSystem.memberOf(all, ivan, day('2026-11-10'), lunch)?.id,
    ).toBe('s-1');
    expect(
      BlockSeriesSystem.memberOf(all, ivan, day('2026-11-10'), later),
    ).toBeNull();
    expect(
      BlockSeriesSystem.memberOf(all, ivan, day('2026-11-14'), lunch),
    ).toBeNull();
    expect(
      BlockSeriesSystem.memberOf(
        all,
        BarberId.of('niko'),
        day('2026-11-10'),
        lunch,
      ),
    ).toBeNull();
  });

  it('«Само този ден»: the day moves alone and leaves the series', () => {
    const edit = BlockSeriesSystem.edit(
      series(),
      day('2026-11-11'),
      BlockSeriesScope.ThisDay,
      later,
      nextId,
    );
    expect(edit.days).toEqual(['2026-11-11']);
    expect(edit.range).toEqual(later);
    expect(edit.series[0]?.localDates).toHaveLength(9);
    expect(edit.series[0]?.localDates).not.toContain('2026-11-11');
    expect(edit.dropped).toEqual([]);
  });

  it('«Този и следващите»: cuts the series — the old one ends the day before, the new minutes go on', () => {
    const edit = BlockSeriesSystem.edit(
      series(),
      day('2026-11-12'),
      BlockSeriesScope.Following,
      later,
      nextId,
    );
    expect(edit.days).toEqual([
      '2026-11-12',
      '2026-11-13',
      '2026-11-16',
      '2026-11-17',
      '2026-11-18',
      '2026-11-19',
      '2026-11-20',
    ]);
    const [old, fresh] = edit.series;
    expect(old?.id).toBe('s-1');
    expect(old?.localDates).toEqual(['2026-11-09', '2026-11-10', '2026-11-11']);
    expect(old).toMatchObject({
      recurrenceEnd: RecurrenceEnd.Until,
      untilLocalDate: '2026-11-11',
    });
    expect(fresh).toMatchObject({
      startMinutes: 810,
      endMinutes: 870,
      startLocalDate: '2026-11-12',
      recurrenceEnd: RecurrenceEnd.Until,
      untilLocalDate: '2026-11-20',
    });
    expect(fresh?.localDates).toEqual(edit.days);
  });

  it('a cut at the first day leaves nothing of the old series; a removal starts nothing new', () => {
    const removal = BlockSeriesSystem.edit(
      series(),
      day('2026-11-09'),
      BlockSeriesScope.Following,
      null,
      nextId,
    );
    expect(removal.days).toHaveLength(10);
    expect(removal.range).toBeNull();
    expect(removal.series).toEqual([]);
    expect(removal.dropped).toEqual(['s-1']);
  });

  it('keeps «Без край» on the new series of a cut', () => {
    const edit = BlockSeriesSystem.edit(
      series(RecurrenceEndRule.never()),
      day('2026-11-12'),
      BlockSeriesScope.Following,
      later,
      nextId,
    );
    expect(edit.series[1]?.recurrenceEnd).toBe(RecurrenceEnd.Never);
    expect(edit.series[0]?.recurrenceEnd).toBe(RecurrenceEnd.Until);
  });

  it('writes a series that never ends ahead day by day, in its own rhythm, forgetting the past', () => {
    const never = series(RecurrenceEndRule.never());
    // A week on: the horizon moved five weekdays.
    const top = BlockSeriesSystem.topUp(never, day('2026-11-16'));
    expect(top?.days).toHaveLength(5);
    expect(top?.series.localDates[0]).toBe('2026-11-16');
    expect(top?.series.localDates.at(-1)).toBe(top?.days.at(-1));
    // Nothing to do the same day again; nothing ever for a series that ends.
    expect(
      BlockSeriesSystem.topUp(top?.series ?? never, day('2026-11-16')),
    ).toBeNull();
    expect(BlockSeriesSystem.topUp(series(), day('2026-11-16'))).toBeNull();
  });

  it('keeps every second week every second week when it writes ahead', () => {
    const fortnightly = unwrapOk(
      BlockSeriesSystem.create({
        id: BlockSeriesId.of('s-2'),
        barberId: ivan,
        locationId: LocationId.of('shop'),
        range: lunch,
        startLocalDate: day('2026-11-09'),
        rule: unwrapOk(
          RecurrenceRule.create(
            RecurrencePattern.weekly([Weekday.Mon]),
            2,
            RecurrenceEndRule.never(),
          ),
        ),
      }),
    );
    const top = BlockSeriesSystem.topUp(fortnightly, day('2027-05-20'));
    for (const written of top?.days ?? []) {
      const weeks =
        (LocalDate.toEpochDay(written) -
          LocalDate.toEpochDay(day('2026-11-09'))) /
        7;
      expect(weeks % 2).toBe(0);
    }
    expect(top?.days.length).toBeGreaterThan(0);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const frozen = deepFreeze(series());
    const ids = () => BlockSeriesId.of('fixed');
    const once = BlockSeriesSystem.edit(
      frozen,
      day('2026-11-12'),
      BlockSeriesScope.Following,
      later,
      ids,
    );
    const twice = BlockSeriesSystem.edit(
      frozen,
      day('2026-11-12'),
      BlockSeriesScope.Following,
      later,
      ids,
    );
    expect(twice).toEqual(once);
    expect(BlockSeriesSystem.topUp(frozen, day('2026-11-16'))).toEqual(
      BlockSeriesSystem.topUp(frozen, day('2026-11-16')),
    );
  });
});
