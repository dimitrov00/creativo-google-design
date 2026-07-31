import { describe, expect, it } from 'vitest';
import { BarberId, LocationId } from '@creativo/domain/catalog';
import {
  type AvailabilityLine,
  type BarberDayAvailability,
  availableOptions,
  distinctStarts,
} from './availability';
import { BarberPref } from './barber-pref';
import { BookingPolicy } from './booking-policy';
import { CalendarDay } from './calendar-day';
import { Interval } from './interval';
import { LocalTimeRange } from './local-time-of-day';
import { buildDayWindows } from './roster-window';
import { ScheduleException, ScheduleExceptionId } from './schedule-exception';
import { StaffScheduleHistory } from './staff-schedule';
import { WeeklyPattern } from './weekly-pattern';

/*
 * The whole Phase-3 stack composed, against the real seeded shop:
 *   Ivan   — classic cut 35m (short) / 50m (long)
 *   Niko   — classic cut 30m (short) / 45m (long)
 *   Stefan — flat 45m, Center only
 * Shop opens 09:00–20:00 Mon–Fri. 2026-07-29 is a Wednesday.
 *
 * This is the test that proves the pieces fit together — the individual specs
 * prove each piece is right on its own.
 */

const zone = 'Europe/Sofia';
const DAY = '2026-07-29';

function day(key = DAY): CalendarDay {
  const result = CalendarDay.create(key, zone);
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

function locationId(raw = 'loc-center'): LocationId {
  const result = LocationId.create(raw);
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

function barberId(raw: string): BarberId {
  const result = BarberId.create(raw);
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

function weekdayPattern(
  ranges: readonly (readonly [string, string])[],
  at = 'loc-center',
): WeeklyPattern {
  const segments = ranges.map(([start, end]) => ({
    start,
    end,
    locationId: at,
  }));
  const result = WeeklyPattern.create({
    byWeekday: {
      monday: segments,
      tuesday: segments,
      wednesday: segments,
      thursday: segments,
      friday: segments,
      saturday: segments,
    },
  });
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

function shopHours(ranges: readonly (readonly [string, string])[]) {
  return new Map([
    [
      locationId().value,
      {
        locationId: locationId(),
        intervals: ranges.map(([from, to]) => {
          const range = LocalTimeRange.create(from, to);
          if (range.isFailure()) throw new Error('bad fixture');
          const start = range.value.start.onDay(day());
          const end = range.value.end.onDay(day());
          if (start.isFailure() || end.isFailure())
            throw new Error('bad fixture');
          return Interval.of(start.value.toMillis(), end.value.toMillis());
        }),
      },
    ],
  ]);
}

/** Materialise one barber's day through the real roster pipeline. */
function barberDay(options: {
  readonly id: string;
  readonly roster: readonly (readonly [string, string])[];
  readonly busy?: readonly Interval[];
  readonly exceptions?: readonly ScheduleException[];
}): BarberDayAvailability {
  const windows = buildDayWindows({
    day: day(),
    schedule: StaffScheduleHistory.startingWith(
      weekdayPattern(options.roster),
      day('2026-01-01'),
    ),
    exceptions: options.exceptions ?? [],
    shopHours: shopHours([['09:00', '20:00']]),
  });
  return {
    barberId: barberId(options.id),
    windows,
    busy: options.busy ?? [],
  };
}

/** A local wall-clock time on the test day, as epoch millis. */
function at(hhmm: string): number {
  const range = LocalTimeRange.create(hhmm, '23:59');
  if (range.isFailure()) throw new Error('bad fixture');
  const instant = range.value.start.onDay(day());
  if (instant.isFailure()) throw new Error('bad fixture');
  return instant.value.toMillis();
}

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
  });
}

function line(
  lineId: string,
  durationMinutes: number,
  pref: BarberPref = BarberPref.any(),
): AvailabilityLine {
  return {
    lineId,
    barberPref: pref,
    durationMinutes,
    padBeforeMinutes: 0,
    padAfterMinutes: 0,
  };
}

const POLICY = BookingPolicy.default();

function solve(
  lines: readonly AvailabilityLine[],
  barbers: readonly BarberDayAvailability[],
  maxOptions = 400,
) {
  return availableOptions({
    lines,
    barbers,
    policy: POLICY,
    // Well before the day, so lead time never interferes with the fixtures.
    notBeforeMs: at('09:00') - 7 * 24 * 60 * 60_000,
    maxOptions,
  });
}

describe('Phase 3 composed — buildDayWindows → availableOptions', () => {
  it('a solo booking is offered from the shop’s opening, not the barber’s', () => {
    // Ivan is rostered 08:00–19:00 but the shop opens at 09:00. The public
    // surface starts at 09:00 (ruling R1).
    const ivan = barberDay({ id: 'ivan', roster: [['08:00', '19:00']] });
    const options = solve([line('l1', 35)], [ivan]);
    expect(clock(distinctStarts(options)[0] as number)).toBe('09:00');
  });

  it('respects a lunch break carved out of the roster', () => {
    const ivan = barberDay({
      id: 'ivan',
      roster: [['09:00', '18:00']],
      exceptions: [
        (() => {
          const range = LocalTimeRange.create('13:00', '14:00');
          if (range.isFailure()) throw new Error('bad fixture');
          const result = ScheduleException.create({
            id: ScheduleExceptionId.of('exc-lunch'),
            day: day(),
            barberId: barberId('ivan'),
            locationId: locationId(),
            detail: { kind: 'break', ranges: [range.value], paid: false },
          });
          if (result.isFailure()) throw new Error('bad fixture');
          return result.value;
        })(),
      ],
    });

    const starts = solve([line('l1', 35)], [ivan]).map((option) =>
      clock(option.envelope.startMs),
    );
    // 12:45 + 35m would run into the break.
    expect(starts).toContain('12:15');
    expect(starts).not.toContain('12:45');
    expect(starts).toContain('14:00');
  });

  it('a father-and-son party gets BOTH arrangements on a quiet day', () => {
    const ivan = barberDay({ id: 'ivan', roster: [['09:00', '18:00']] });
    const niko = barberDay({ id: 'niko', roster: [['09:00', '18:00']] });

    // Ivan's cut is 35m, Niko's 30m — the party wants "anyone" twice.
    const options = solve([line('dad', 35), line('son', 30)], [ivan, niko]);

    const parallel = options.filter(
      (option) =>
        new Set(option.assignments.map((a) => a.slot.startMs)).size === 1,
    );
    const sequential = options.filter(
      (option) =>
        new Set(option.assignments.map((a) => a.barberId.value)).size === 1,
    );

    expect(parallel.length).toBeGreaterThan(0);
    expect(sequential.length).toBeGreaterThan(0);

    // Parallel is the shorter visit and therefore ranks first at a given start.
    const earliest = options[0];
    expect(clock((earliest as { envelope: Interval }).envelope.startMs)).toBe(
      '09:00',
    );
    expect(
      Interval.durationMinutes((earliest as { envelope: Interval }).envelope),
    ).toBe(35);
  });

  it('a party who both want IVAN can only go sequentially', () => {
    const ivan = barberDay({ id: 'ivan', roster: [['09:00', '18:00']] });
    const niko = barberDay({ id: 'niko', roster: [['09:00', '18:00']] });
    const pref = BarberPref.specific(barberId('ivan'));

    const options = solve(
      [line('dad', 35, pref), line('son', 35, pref)],
      [ivan, niko],
    );
    expect(options.length).toBeGreaterThan(0);

    for (const option of options) {
      // Only Ivan, and never at the same moment.
      expect(option.assignments.every((a) => a.barberId.value === 'ivan')).toBe(
        true,
      );
      expect(new Set(option.assignments.map((a) => a.slot.startMs)).size).toBe(
        2,
      );
    }
    // 09:00 + 09:35, back to back with no gap.
    const first = options[0] as { assignments: readonly { slot: Interval }[] };
    const sorted = first.assignments
      .slice()
      .sort((a, b) => a.slot.startMs - b.slot.startMs);
    expect(sorted[0]?.slot.endMs).toBe(sorted[1]?.slot.startMs);
  });

  it('a fully-booked day yields nothing rather than a wrong slot', () => {
    const ivan = barberDay({
      id: 'ivan',
      roster: [['09:00', '18:00']],
      busy: [Interval.of(at('09:00'), at('18:00'))],
    });
    expect(solve([line('l1', 35)], [ivan])).toEqual([]);
  });

  it('a closed shop day yields nothing for anyone', () => {
    const closure = ScheduleException.create({
      id: ScheduleExceptionId.of('exc-holiday'),
      day: day(),
      barberId: null,
      locationId: locationId(),
      detail: { kind: 'closed' },
    });
    if (closure.isFailure()) throw new Error('bad fixture');

    const ivan = barberDay({
      id: 'ivan',
      roster: [['09:00', '18:00']],
      exceptions: [closure.value],
    });
    expect(ivan.windows).toEqual([]);
    expect(solve([line('l1', 35)], [ivan])).toEqual([]);
  });

  it('Stefan’s 15-minute turnaround shows up as a gap after an existing booking', () => {
    // Stefan is booked 10:00–10:45 and needs 15 minutes to reset. The caller
    // has already padded the busy interval, which is where the gap comes from.
    const stefan = barberDay({
      id: 'stefan',
      roster: [['09:00', '12:00']],
      busy: [Interval.pad(Interval.of(at('10:00'), at('10:45')), 15, 15)],
    });

    const starts = solve([line('l1', 45)], [stefan]).map((option) =>
      clock(option.envelope.startMs),
    );
    // The padded block runs 09:45–11:00, so free time is 09:00–09:45 and
    // 11:00–12:00. A 45-minute service fits each exactly once — the
    // turnaround is charged once, on the busy side, not twice.
    expect(starts).toContain('09:00');
    expect(starts).not.toContain('09:15');
    expect(starts).not.toContain('10:00');
    expect(starts).toContain('11:00');
  });
});
