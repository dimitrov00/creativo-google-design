import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DateRange, DayKey } from '../components/day-key.data';
import { DayOffset } from '../components/day-offset.data';
import type { Result } from '../components/result.data';
import { TimeErrorCode } from '../components/time-errors.data';
import { Weekday } from '../components/weekday.data';
import { DstResolution, ZonedTimeSystem } from './zoned-time.system';
import { deepFreeze } from '../testing';

/*
 * Every expected instant below is a LITERAL epoch-ms constant (its UTC
 * reading in the comment), never computed with a date library — the
 * successor of the kernel's 32 Luxon-backed DST specs (§9 D5).
 *
 * Europe/Sofia, the product's scheduling zone (EET +02:00 / EEST +03:00):
 *   2026-03-29  03:00 → 04:00   a 23-hour day; 03:00–03:59 never happens
 *   2026-10-25  04:00 → 03:00   a 25-hour day; 03:00–03:59 happens twice
 */
const SOFIA = 'Europe/Sofia';
const KOLKATA = 'Asia/Kolkata';
const UTC = 'UTC';
/** Moves its clocks at MIDNIGHT — the edge cases a 03:00 switch never hits. */
const SAO_PAULO = 'America/Sao_Paulo';

const MIN = 60_000;
const HOUR = 3_600_000;

const SOFIA_0328_START = 1_774_648_800_000; // 2026-03-27T22:00Z
const SOFIA_0329_START = 1_774_735_200_000; // 2026-03-28T22:00Z
const SOFIA_0329_0130 = 1_774_740_600_000; // 2026-03-28T23:30Z
const SOFIA_0329_0200 = 1_774_742_400_000; // 2026-03-29T00:00Z
const SOFIA_0329_0259 = 1_774_745_940_000; // 2026-03-29T00:59Z
const SOFIA_SPRING_SWITCH = 1_774_746_000_000; // 2026-03-29T01:00Z = 04:00 EEST
const SOFIA_0329_0430 = 1_774_747_800_000; // 2026-03-29T01:30Z
const SOFIA_0329_0900 = 1_774_764_000_000; // 2026-03-29T06:00Z
const SOFIA_0329_1800 = 1_774_796_400_000; // 2026-03-29T15:00Z
const SOFIA_0330_START = 1_774_818_000_000; // 2026-03-29T21:00Z
const SOFIA_1025_START = 1_792_875_600_000; // 2026-10-24T21:00Z
const SOFIA_1025_0330_FIRST = 1_792_888_200_000; // 2026-10-25T00:30Z (+03:00)
const SOFIA_FALL_SWITCH = 1_792_890_000_000; // 2026-10-25T01:00Z = 03:00 EET
const SOFIA_1025_0330_SECOND = 1_792_891_800_000; // 2026-10-25T01:30Z (+02:00)
const SOFIA_1025_0900 = 1_792_911_600_000; // 2026-10-25T07:00Z
const SOFIA_1025_1800 = 1_792_944_000_000; // 2026-10-25T16:00Z
const SOFIA_1026_START = 1_792_965_600_000; // 2026-10-25T22:00Z
const SOFIA_0729_START = 1_785_272_400_000; // 2026-07-28T21:00Z
const SOFIA_0729_0930 = 1_785_306_600_000; // 2026-07-29T06:30Z
const SOFIA_0801_0900 = 1_785_564_000_000; // 2026-08-01T06:00Z
const KOLKATA_0730_START = 1_785_349_800_000; // 2026-07-29T18:30Z
const KOLKATA_0730_0915 = 1_785_383_100_000; // 2026-07-30T03:45Z
const UTC_0729_START = 1_785_283_200_000; // 2026-07-29T00:00Z
const SP_1103_START = 1_541_214_000_000; // 2018-11-03T03:00Z (−03:00)
const SP_SPRING_SWITCH = 1_541_300_400_000; // 2018-11-04T03:00Z = 01:00 −02:00
const SP_1105_START = 1_541_383_200_000; // 2018-11-05T02:00Z (−02:00)
const SP_0216_START = 1_550_282_400_000; // 2019-02-16T02:00Z (−02:00)
const SP_FALL_SWITCH = 1_550_368_800_000; // 2019-02-17T02:00Z = 23:00 −03:00 (16th)
const SP_0217_START = 1_550_372_400_000; // 2019-02-17T03:00Z (−03:00)
const SP_0218_START = 1_550_458_800_000; // 2019-02-18T03:00Z
/** Australia/Lord_Howe moves its clocks by HALF an hour (+10:30 / +11:00). */
const LORD_HOWE = 'Australia/Lord_Howe';
const LH_0405_START = 1_775_307_600_000; // 2026-04-04T13:00Z (+11:00)
const LH_0405_0145_FIRST = 1_775_313_900_000; // 2026-04-04T14:45Z (+11:00)
const LH_0405_0145_SECOND = 1_775_315_700_000; // 2026-04-04T15:15Z (+10:30)
const LH_1004_START = 1_791_034_200_000; // 2026-10-03T13:30Z (+10:30)
const LH_1004_0215_SHIFTED = 1_791_042_300_000; // 2026-10-03T15:45Z = 02:45 +11:00
/** Africa/Cairo falls back at MIDNIGHT ITSELF: 24:00 EEST → 23:00 EET. */
const CAIRO = 'Africa/Cairo';
const CAIRO_1029_START = 1_793_221_200_000; // 2026-10-28T21:00Z (+03:00)
const CAIRO_1029_2330_FIRST = 1_793_305_800_000; // 2026-10-29T20:30Z (+03:00)
const CAIRO_FALL_SWITCH = 1_793_307_600_000; // 2026-10-29T21:00Z = 23:00 EET
const CAIRO_1029_2330_SECOND = 1_793_309_400_000; // 2026-10-29T21:30Z (+02:00)
const CAIRO_1030_START = 1_793_311_200_000; // 2026-10-29T22:00Z (+02:00)
/** America/Scoresbysund repeats MIDNIGHT (2018-10-28, +00:00 → −01:00 at 01:00Z). */
const SCORESBYSUND = 'America/Scoresbysund';
const SCORESBY_1028_FIRST_MIDNIGHT = 1_540_684_800_000; // 2018-10-28T00:00Z (+00:00)
const SCORESBY_1028_SECOND_MIDNIGHT = 1_540_688_400_000; // 2018-10-28T01:00Z (−01:00)
const SCORESBY_1029_START = 1_540_774_800_000; // 2018-10-29T01:00Z (−01:00)

const key = (raw: string): DayKey => DayKey.of(raw);

function valueOf<T, E>(result: Result<T, E>): T {
  if (!result.ok)
    throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

function errorOf<T, E>(result: Result<T, E>): E {
  if (result.ok)
    throw new Error(`expected err, got ${JSON.stringify(result.value)}`);
  return result.error;
}

function row(zone: string, raw: string): DayOffset {
  const day = ZonedTimeSystem.dayTable(zone, key(raw), key(raw))[0];
  if (day === undefined) throw new Error(`no row for ${raw} in ${zone}`);
  return day;
}

/** Each row starts exactly where the previous one ends. */
function expectContiguous(days: readonly DayOffset[]): void {
  days.slice(1).forEach((day, i) => {
    expect(day.dayStartMs).toBe(DayOffset.endMs(days.at(i) as DayOffset));
  });
}

describe('ZonedTimeSystem.dayTable — the DST set (Europe/Sofia)', () => {
  it('carries the 23-hour spring day and its erased segment on the row', () => {
    expect(row(SOFIA, '2026-03-29')).toEqual({
      dayKey: '2026-03-29',
      dayStartMs: SOFIA_0329_START,
      offsetMinutes: 120,
      transitionAtMinutes: 180,
      transitionDeltaMinutes: 60,
      weekday: Weekday.Sun,
    });
    const day = row(SOFIA, '2026-03-29');
    expect(DayOffset.lengthMinutes(day)).toBe(23 * 60);
    expect(DayOffset.endMs(day)).toBe(SOFIA_0330_START);
  });

  it('carries the 25-hour autumn day and its repeated segment on the row', () => {
    expect(row(SOFIA, '2026-10-25')).toEqual({
      dayKey: '2026-10-25',
      dayStartMs: SOFIA_1025_START,
      offsetMinutes: 180,
      transitionAtMinutes: 240,
      transitionDeltaMinutes: -60,
      weekday: Weekday.Sun,
    });
    const day = row(SOFIA, '2026-10-25');
    expect(DayOffset.lengthMinutes(day)).toBe(25 * 60);
    expect(DayOffset.endMs(day)).toBe(SOFIA_1026_START);
  });

  it('builds sorted, contiguous rows with the ordinary days unmarked', () => {
    const days = ZonedTimeSystem.dayTable(
      SOFIA,
      key('2026-03-28'),
      key('2026-03-30'),
    );
    expect(days.map((d) => d.dayKey)).toEqual([
      '2026-03-28',
      '2026-03-29',
      '2026-03-30',
    ]);
    expect(days[0]).toEqual({
      dayKey: '2026-03-28',
      dayStartMs: SOFIA_0328_START,
      offsetMinutes: 120,
      transitionAtMinutes: null,
      transitionDeltaMinutes: 0,
      weekday: Weekday.Sat,
    });
    expect(days[2]).toMatchObject({
      dayStartMs: SOFIA_0330_START,
      offsetMinutes: 180,
      transitionAtMinutes: null,
      transitionDeltaMinutes: 0,
      weekday: Weekday.Mon,
    });
    expectContiguous(days);
  });

  it('marks exactly the two switch days of a whole year, and loses no time', () => {
    const year = ZonedTimeSystem.dayTable(
      SOFIA,
      key('2026-01-01'),
      key('2026-12-31'),
    );
    expect(year).toHaveLength(365);
    expect(year.filter(DayOffset.isTransition).map((d) => d.dayKey)).toEqual([
      '2026-03-29',
      '2026-10-25',
    ]);
    const first = year[0] as DayOffset;
    const last = year[year.length - 1] as DayOffset;
    // Spring and autumn cancel out: 365 days of exactly 24 hours each.
    expect(DayOffset.endMs(last) - first.dayStartMs).toBe(365 * 24 * HOUR);
    expectContiguous(year);
    for (const day of year) {
      expect(day.weekday).toBe(ZonedTimeSystem.weekdayOf(day.dayKey));
    }
  });

  it('is empty for an inverted range or an unknown zone — it fails closed', () => {
    expect(
      ZonedTimeSystem.dayTable(SOFIA, key('2026-03-30'), key('2026-03-29')),
    ).toEqual([]);
    expect(
      ZonedTimeSystem.dayTable(
        'Not/AZone',
        key('2026-03-29'),
        key('2026-03-30'),
      ),
    ).toEqual([]);
    expect(
      ZonedTimeSystem.dayTable(SOFIA, key('garbage'), key('2026-03-30')),
    ).toEqual([]);
  });

  it('fails closed outside the years it can read — year 0000 never reaches the formatter', () => {
    // The formatter prints a year-0 instant as year 1 (no era part); a table
    // built there would be a year off. Refused, not wrong.
    expect(
      ZonedTimeSystem.dayTable(UTC, key('0000-12-31'), key('0001-01-02')),
    ).toEqual([]);
    expect(
      ZonedTimeSystem.dayTable(UTC, key('9999-12-30'), key('9999-12-31')),
    ).toEqual([]);
    expect(
      ZonedTimeSystem.dayTable(UTC, key('0001-01-05'), key('0001-01-05')),
    ).toHaveLength(1);
  });

  it('fails closed on local mean time: an offset that is not whole minutes', () => {
    // Sofia kept Istanbul mean time (+01:56:56) until 1894-11-30; Monrovia
    // kept −00:44:30 until 1972-01-07. Every row field is whole minutes.
    expect(
      ZonedTimeSystem.dayTable(SOFIA, key('1894-11-28'), key('1894-11-30')),
    ).toEqual([]);
    expect(
      ZonedTimeSystem.dayTable(SOFIA, key('1894-12-01'), key('1894-12-03')),
    ).toHaveLength(3);
    expect(
      ZonedTimeSystem.dayTable(
        'Africa/Monrovia',
        key('1971-06-01'),
        key('1971-06-02'),
      ),
    ).toEqual([]);
    expect(
      ZonedTimeSystem.dayTable(
        'Africa/Monrovia',
        key('1972-02-01'),
        key('1972-02-01'),
      ),
    ).toHaveLength(1);
  });

  it('caps a table at ten years of days (3660 rows) — a longer span is refused', () => {
    const from = key('2020-01-01');
    expect(
      ZonedTimeSystem.dayTable(UTC, from, ZonedTimeSystem.addDays(from, 3659)),
    ).toHaveLength(3660);
    expect(
      ZonedTimeSystem.dayTable(UTC, from, ZonedTimeSystem.addDays(from, 3660)),
    ).toEqual([]);
  });
});

describe('ZonedTimeSystem.instantOf / minuteOfDay — both sides of transitionAtMinutes', () => {
  const spring = row(SOFIA, '2026-03-29');
  const autumn = row(SOFIA, '2026-10-25');

  it('spring: before the switch is plain subtraction from local midnight', () => {
    expect(ZonedTimeSystem.instantOf(spring, 0)).toBe(SOFIA_0329_START);
    expect(ZonedTimeSystem.instantOf(spring, 179)).toBe(SOFIA_0329_0259);
    expect(ZonedTimeSystem.minuteOfDay(SOFIA_0329_0259, spring)).toBe(179);
  });

  it('spring: at and after the switch the clock is an hour ahead', () => {
    expect(ZonedTimeSystem.instantOf(spring, 240)).toBe(SOFIA_SPRING_SWITCH);
    expect(ZonedTimeSystem.minuteOfDay(SOFIA_SPRING_SWITCH, spring)).toBe(240);
    expect(ZonedTimeSystem.instantOf(spring, 270)).toBe(SOFIA_0329_0430);
    expect(ZonedTimeSystem.minuteOfDay(SOFIA_0329_0430, spring)).toBe(270);
  });

  it('spring: an erased wall minute resolves FORWARD to the first minute that exists', () => {
    expect(ZonedTimeSystem.instantOf(spring, 180)).toBe(SOFIA_SPRING_SWITCH);
    expect(ZonedTimeSystem.instantOf(spring, 210)).toBe(SOFIA_SPRING_SWITCH);
    expect(ZonedTimeSystem.instantOf(spring, 239)).toBe(SOFIA_SPRING_SWITCH);
  });

  it('autumn: the first 03:00–03:59 is before the switch, the second after it', () => {
    expect(ZonedTimeSystem.instantOf(autumn, 210)).toBe(SOFIA_1025_0330_FIRST);
    expect(ZonedTimeSystem.minuteOfDay(SOFIA_1025_0330_FIRST, autumn)).toBe(
      210,
    );
    // The switch instant reads 03:00 again, and the second 03:30 reads 03:30.
    expect(ZonedTimeSystem.minuteOfDay(SOFIA_FALL_SWITCH, autumn)).toBe(180);
    expect(ZonedTimeSystem.minuteOfDay(SOFIA_1025_0330_SECOND, autumn)).toBe(
      210,
    );
    // 04:00 exists once, after the repeat: 5 real hours after midnight.
    expect(ZonedTimeSystem.instantOf(autumn, 240)).toBe(
      SOFIA_1025_START + 5 * HOUR,
    );
    expect(
      ZonedTimeSystem.minuteOfDay(SOFIA_1025_START + 5 * HOUR, autumn),
    ).toBe(240);
    expect(ZonedTimeSystem.instantOf(autumn, 239)).toBe(
      SOFIA_1025_START + 239 * MIN,
    );
  });

  it('1440 is the next local midnight on every kind of day', () => {
    expect(ZonedTimeSystem.instantOf(spring, 1440)).toBe(SOFIA_0330_START);
    expect(ZonedTimeSystem.instantOf(autumn, 1440)).toBe(SOFIA_1026_START);
    const ordinary = row(SOFIA, '2026-07-29');
    expect(ZonedTimeSystem.instantOf(ordinary, 1440)).toBe(
      SOFIA_0729_START + 24 * HOUR,
    );
  });

  it('minuteOfDay floors to the minute and runs past 1440 for a visit crossing midnight', () => {
    const ordinary = row(SOFIA, '2026-07-29');
    expect(
      ZonedTimeSystem.minuteOfDay(SOFIA_0729_0930 + 59_999, ordinary),
    ).toBe(570);
    expect(
      ZonedTimeSystem.minuteOfDay(
        SOFIA_0729_START + 24 * HOUR + 15 * MIN,
        ordinary,
      ),
    ).toBe(1455);
  });

  it('round-trips every existing wall minute of every Sofia day of 2026', () => {
    const year = ZonedTimeSystem.dayTable(
      SOFIA,
      key('2026-01-01'),
      key('2026-12-31'),
    );
    const mismatches: string[] = [];
    for (const day of year) {
      for (let wall = 0; wall < 1440; wall += 5) {
        const at = ZonedTimeSystem.instantOf(day, wall);
        const erased =
          day.transitionAtMinutes !== null &&
          day.transitionDeltaMinutes > 0 &&
          wall >= day.transitionAtMinutes &&
          wall < day.transitionAtMinutes + day.transitionDeltaMinutes;
        const expected = erased
          ? (day.transitionAtMinutes as number) + day.transitionDeltaMinutes
          : wall;
        if (ZonedTimeSystem.minuteOfDay(at, day) !== expected) {
          mismatches.push(`${day.dayKey} ${wall}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('agrees with the zone itself (Intl) for any instant the table covers', () => {
    const tables = [
      ZonedTimeSystem.dayTable(SOFIA, key('2026-03-25'), key('2026-11-01')),
      ZonedTimeSystem.dayTable(KOLKATA, key('2026-07-01'), key('2026-07-31')),
      ZonedTimeSystem.dayTable(SAO_PAULO, key('2018-11-01'), key('2019-02-20')),
    ];
    const zones = [SOFIA, KOLKATA, SAO_PAULO];
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (z, t) => {
          const days = tables.at(z) as readonly DayOffset[];
          const first = (days[0] as DayOffset).dayStartMs;
          const end = DayOffset.endMs(days[days.length - 1] as DayOffset);
          const ms = first + Math.floor(t * (end - first - 1));
          const wall = valueOf(
            ZonedTimeSystem.wallClockOf(ms, zones.at(z) as string),
          );
          const index = DayOffset.indexAt(ms, days);
          expect(ZonedTimeSystem.dayKeyOf(ms, days)).toBe(wall.dayKey);
          expect(
            ZonedTimeSystem.minuteOfDay(ms, days.at(index) as DayOffset),
          ).toBe(wall.minuteOfDay);
        },
      ),
    );
  });
});

describe('a roster window spanning the switch', () => {
  it('places every post-switch shift at the right instant (spring)', () => {
    const day = row(SOFIA, '2026-03-29');
    // 09:00–18:00 lies wholly after the switch: on the +03:00 clock.
    expect(ZonedTimeSystem.instantOf(day, 9 * 60)).toBe(SOFIA_0329_0900);
    expect(ZonedTimeSystem.instantOf(day, 18 * 60)).toBe(SOFIA_0329_1800);
    // 02:00–06:00 spans it: four hours of wall clock, three of real time.
    const start = ZonedTimeSystem.instantOf(day, 2 * 60);
    const end = ZonedTimeSystem.instantOf(day, 6 * 60);
    expect(start).toBe(SOFIA_0329_0200);
    expect(end - start).toBe(3 * HOUR);
  });

  it('places every post-switch shift at the right instant (autumn)', () => {
    const day = row(SOFIA, '2026-10-25');
    expect(ZonedTimeSystem.instantOf(day, 9 * 60)).toBe(SOFIA_1025_0900);
    expect(ZonedTimeSystem.instantOf(day, 18 * 60)).toBe(SOFIA_1025_1800);
    // 02:00–06:00 spans it: four hours of wall clock, five of real time.
    const start = ZonedTimeSystem.instantOf(day, 2 * 60);
    const end = ZonedTimeSystem.instantOf(day, 6 * 60);
    expect(end - start).toBe(5 * HOUR);
  });

  it('keeps a window that starts inside the erased hour monotone, never inverted', () => {
    const day = row(SOFIA, '2026-03-29');
    const start = ZonedTimeSystem.instantOf(day, 3 * 60 + 30);
    const end = ZonedTimeSystem.instantOf(day, 4 * 60 + 15);
    expect(start).toBe(SOFIA_SPRING_SWITCH);
    expect(end - start).toBe(15 * MIN);
  });
});

describe('ZonedTimeSystem.dayTableAround — the once-per-request call', () => {
  it('centres the table on the local day of an instant on the switch day', () => {
    const days = ZonedTimeSystem.dayTableAround(
      SOFIA,
      SOFIA_SPRING_SWITCH,
      SOFIA_SPRING_SWITCH,
      1,
    );
    expect(days.map((d) => d.dayKey)).toEqual([
      '2026-03-28',
      '2026-03-29',
      '2026-03-30',
    ]);
    expect(ZonedTimeSystem.dayKeyOf(SOFIA_SPRING_SWITCH, days)).toBe(
      '2026-03-29',
    );
  });

  it('reads the day on the zone clock: 22:13 UTC on the 28th is already the 29th in Sofia', () => {
    const ms = SOFIA_0329_START + 13 * MIN; // 2026-03-28T22:13Z
    const days = ZonedTimeSystem.dayTableAround(SOFIA, ms, ms, 0);
    expect(days.map((d) => d.dayKey)).toEqual(['2026-03-29']);
    expect((days[0] as DayOffset).transitionAtMinutes).toBe(180);
  });

  it('spans both instants of an interval crossing the autumn switch', () => {
    const days = ZonedTimeSystem.dayTableAround(
      SOFIA,
      SOFIA_1025_START - HOUR,
      SOFIA_1026_START + HOUR,
      0,
    );
    expect(days.map((d) => d.dayKey)).toEqual([
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
    ]);
  });

  it('treats a negative pad as none, and fails closed on a bad zone or instant', () => {
    expect(
      ZonedTimeSystem.dayTableAround(
        SOFIA,
        SOFIA_0729_0930,
        SOFIA_0729_0930,
        -3,
      ),
    ).toHaveLength(1);
    expect(
      ZonedTimeSystem.dayTableAround(
        'Not/AZone',
        SOFIA_0729_0930,
        SOFIA_0729_0930,
        1,
      ),
    ).toEqual([]);
    expect(
      ZonedTimeSystem.dayTableAround(SOFIA, Number.NaN, SOFIA_0729_0930, 1),
    ).toEqual([]);
    expect(
      ZonedTimeSystem.dayTableAround(
        SOFIA,
        SOFIA_0729_0930,
        Number.POSITIVE_INFINITY,
        1,
      ),
    ).toEqual([]);
  });

  it('never spins on instants a request supplies: far-apart ends or a huge pad build nothing', () => {
    // Years 0001 and 9999 are both readable instants; the span between them
    // is ~3.65M days. Refused before a single row is built.
    expect(
      ZonedTimeSystem.dayTableAround(
        SOFIA,
        -62_135_000_000_000,
        253_402_000_000_000,
        0,
      ),
    ).toEqual([]);
    expect(
      ZonedTimeSystem.dayTableAround(
        SOFIA,
        SOFIA_0729_0930,
        SOFIA_0729_0930,
        1_000_000_000,
      ),
    ).toEqual([]);
    expect(
      ZonedTimeSystem.dayTableAround(
        SOFIA,
        SOFIA_0729_0930,
        SOFIA_0729_0930,
        Number.POSITIVE_INFINITY,
      ),
    ).toEqual([]);
  });
});

describe('ZonedTimeSystem over the table', () => {
  const days = ZonedTimeSystem.dayTable(
    SOFIA,
    key('2026-07-28'),
    key('2026-07-30'),
  );

  it('dayKeyOf / startOfDayMs / startOfNextDayMs read the rows', () => {
    expect(ZonedTimeSystem.dayKeyOf(SOFIA_0729_0930, days)).toBe('2026-07-29');
    // Local midnight, not UTC midnight: 23:45 on the 29th still belongs to the 29th.
    expect(
      ZonedTimeSystem.dayKeyOf(SOFIA_0729_START + 23 * HOUR + 45 * MIN, days),
    ).toBe('2026-07-29');
    expect(ZonedTimeSystem.startOfDayMs(key('2026-07-29'), days)).toBe(
      SOFIA_0729_START,
    );
    expect(ZonedTimeSystem.startOfNextDayMs(key('2026-07-29'), days)).toBe(
      SOFIA_0729_START + 24 * HOUR,
    );
  });

  it('answers null outside the table', () => {
    expect(ZonedTimeSystem.dayKeyOf(SOFIA_0801_0900, days)).toBeNull();
    expect(ZonedTimeSystem.startOfDayMs(key('2026-08-01'), days)).toBeNull();
    expect(
      ZonedTimeSystem.startOfNextDayMs(key('2026-08-01'), days),
    ).toBeNull();
  });

  it('places a roster window on a specific date (atTime)', () => {
    const day = DayOffset.find(key('2026-07-29'), days) as DayOffset;
    expect(ZonedTimeSystem.instantOf(day, 9 * 60 + 30)).toBe(SOFIA_0729_0930);
  });
});

describe('ZonedTimeSystem.resolve — DST is an explicit decision', () => {
  it('builds an ordinary wall-clock time', () => {
    expect(
      valueOf(
        ZonedTimeSystem.resolve(
          key('2026-07-29'),
          9 * 60 + 30,
          SOFIA,
          DstResolution.Reject,
        ),
      ),
    ).toEqual({
      epochMs: SOFIA_0729_0930,
      zone: SOFIA,
    });
  });

  it('REJECTS a time the spring-forward erased (by default)', () => {
    expect(
      errorOf(
        ZonedTimeSystem.resolve(
          key('2026-03-29'),
          3 * 60 + 30,
          SOFIA,
          DstResolution.Reject,
        ),
      ),
    ).toEqual({
      code: TimeErrorCode.NonexistentLocalTime,
      rawValue: '2026-03-29T03:30',
      zone: SOFIA,
    });
    // Earlier/Later answer a repeat, not a gap.
    expect(
      errorOf(
        ZonedTimeSystem.resolve(
          key('2026-03-29'),
          210,
          SOFIA,
          DstResolution.Earlier,
        ),
      ).code,
    ).toBe(TimeErrorCode.NonexistentLocalTime);
  });

  it('shifts an erased time forward only when asked: 03:30 → 04:30 +03:00', () => {
    expect(
      valueOf(
        ZonedTimeSystem.resolve(
          key('2026-03-29'),
          210,
          SOFIA,
          DstResolution.ShiftForward,
        ),
      ).epochMs,
    ).toBe(SOFIA_0329_0430);
  });

  it('REJECTS a time the fall-back repeated, rather than silently picking one', () => {
    expect(
      errorOf(
        ZonedTimeSystem.resolve(
          key('2026-10-25'),
          210,
          SOFIA,
          DstResolution.Reject,
        ),
      ),
    ).toEqual({
      code: TimeErrorCode.AmbiguousLocalTime,
      rawValue: '2026-10-25T03:30',
      zone: SOFIA,
    });
    expect(
      errorOf(
        ZonedTimeSystem.resolve(
          key('2026-10-25'),
          210,
          SOFIA,
          DstResolution.ShiftForward,
        ),
      ).code,
    ).toBe(TimeErrorCode.AmbiguousLocalTime);
  });

  it('resolves a repeated time to either occurrence on request, an hour apart', () => {
    const earlier = valueOf(
      ZonedTimeSystem.resolve(
        key('2026-10-25'),
        210,
        SOFIA,
        DstResolution.Earlier,
      ),
    );
    const later = valueOf(
      ZonedTimeSystem.resolve(
        key('2026-10-25'),
        210,
        SOFIA,
        DstResolution.Later,
      ),
    );
    expect(earlier.epochMs).toBe(SOFIA_1025_0330_FIRST);
    expect(later.epochMs).toBe(SOFIA_1025_0330_SECOND);
    expect(later.epochMs - earlier.epochMs).toBe(60 * MIN);
  });

  it('rejects an unknown zone and impossible parts', () => {
    expect(
      errorOf(
        ZonedTimeSystem.resolve(
          key('2026-07-29'),
          540,
          'Not/AZone',
          DstResolution.Reject,
        ),
      ),
    ).toEqual({
      code: TimeErrorCode.InvalidTimeZone,
      rawZone: 'Not/AZone',
    });
    expect(
      errorOf(
        ZonedTimeSystem.resolve(
          key('2026-02-30'),
          540,
          SOFIA,
          DstResolution.Reject,
        ),
      ),
    ).toEqual({
      code: TimeErrorCode.InvalidDateTime,
      rawValue: '2026-02-30T09:00',
      reason: 'out_of_range',
    });
    for (const wall of [-1, 1440, 9.5]) {
      expect(
        errorOf(
          ZonedTimeSystem.resolve(
            key('2026-07-29'),
            wall,
            SOFIA,
            DstResolution.Reject,
          ),
        ).code,
      ).toBe(TimeErrorCode.InvalidDateTime);
    }
  });

  it('round-trips through epoch millis', () => {
    const wall = valueOf(ZonedTimeSystem.wallClockOf(SOFIA_0729_0930, SOFIA));
    expect(
      valueOf(
        ZonedTimeSystem.resolve(
          wall.dayKey,
          wall.minuteOfDay,
          SOFIA,
          DstResolution.Reject,
        ),
      ).epochMs,
    ).toBe(SOFIA_0729_0930);
  });
});

describe('ZonedTimeSystem.parseIso', () => {
  it('accepts a local ISO string with a valid IANA zone', () => {
    expect(
      valueOf(
        ZonedTimeSystem.parseIso(
          '2026-08-01T09:00:00.000',
          SOFIA,
          DstResolution.Reject,
        ),
      ),
    ).toEqual({
      epochMs: SOFIA_0801_0900,
      zone: SOFIA,
    });
    expect(
      valueOf(
        ZonedTimeSystem.parseIso(
          '2026-08-01T09:00',
          SOFIA,
          DstResolution.Reject,
        ),
      ).epochMs,
    ).toBe(SOFIA_0801_0900);
    // A date alone means its local midnight.
    expect(
      valueOf(
        ZonedTimeSystem.parseIso('2026-07-29', SOFIA, DstResolution.Reject),
      ).epochMs,
    ).toBe(SOFIA_0729_START);
    // One or two fraction digits are tenths and hundredths.
    expect(
      valueOf(
        ZonedTimeSystem.parseIso(
          '2026-08-01T09:00:00.5',
          SOFIA,
          DstResolution.Reject,
        ),
      ).epochMs,
    ).toBe(SOFIA_0801_0900 + 500);
  });

  it('reads an explicit offset as the instant it names, whatever the zone', () => {
    expect(
      valueOf(
        ZonedTimeSystem.parseIso(
          '2026-08-01T06:00:00Z',
          SOFIA,
          DstResolution.Reject,
        ),
      ).epochMs,
    ).toBe(SOFIA_0801_0900);
    expect(
      valueOf(
        ZonedTimeSystem.parseIso(
          '2026-08-01T11:30+0530',
          SOFIA,
          DstResolution.Reject,
        ),
      ).epochMs,
    ).toBe(SOFIA_0801_0900);
    expect(
      valueOf(
        ZonedTimeSystem.parseIso(
          '2026-08-01T03:00:00-03:00',
          UTC,
          DstResolution.Reject,
        ),
      ),
    ).toEqual({
      epochMs: SOFIA_0801_0900,
      zone: UTC,
    });
  });

  it('compares by INSTANT, not by the offset the local rendering carries', () => {
    // '…+03:00' sorts after '…+02:00' as a STRING while being the earlier
    // instant — the autumn fall-back hour inverted ordering in the old code.
    const earlier = valueOf(
      ZonedTimeSystem.parseIso(
        '2026-10-25T03:30:00+03:00',
        SOFIA,
        DstResolution.Reject,
      ),
    );
    const later = valueOf(
      ZonedTimeSystem.parseIso(
        '2026-10-25T03:30:00+02:00',
        SOFIA,
        DstResolution.Reject,
      ),
    );
    expect(earlier.epochMs).toBe(SOFIA_1025_0330_FIRST);
    expect(later.epochMs).toBe(SOFIA_1025_0330_SECOND);
  });

  it('measures elapsed time across a DST boundary, not clock difference', () => {
    // 01:30 → 04:30 reads as three hours on the wall but only two pass.
    const before = valueOf(
      ZonedTimeSystem.parseIso(
        '2026-03-29T01:30:00',
        SOFIA,
        DstResolution.Reject,
      ),
    );
    const after = valueOf(
      ZonedTimeSystem.parseIso(
        '2026-03-29T04:30:00',
        SOFIA,
        DstResolution.Reject,
      ),
    );
    expect(before.epochMs).toBe(SOFIA_0329_0130);
    expect((after.epochMs - before.epochMs) / MIN).toBe(120);
  });

  it('applies the same explicit DST decision to a local string', () => {
    expect(
      errorOf(
        ZonedTimeSystem.parseIso(
          '2026-03-29T03:30',
          SOFIA,
          DstResolution.Reject,
        ),
      ).code,
    ).toBe(TimeErrorCode.NonexistentLocalTime);
    expect(
      valueOf(
        ZonedTimeSystem.parseIso(
          '2026-10-25T03:30',
          SOFIA,
          DstResolution.Later,
        ),
      ).epochMs,
    ).toBe(SOFIA_1025_0330_SECOND);
  });

  it.each([
    'not-a-date',
    '2026-8-01',
    '2026-08-01 09:00',
    '2026-08-01T9:00',
    '2026-08-01T09',
    '2026-08-01T09:0x',
    '2026-08-01T09:00:0',
    '2026-08-01T09:00:00.',
    '2026-08-01T09:00:00,',
    '2026-08-01T09:00:00;5',
    '2026-08-01T09:00:00.1234567891',
    '2026-08-01T09:00:00.12a',
    '2026-08-01T09:00+3',
    '2026-08-01T09:00+031',
    '2026-08-01T09:00+03:0',
    '2026-08-01T09:00+24:00',
    '2026-08-01T09:00+03:60',
  ])('refuses the malformed %j as unparsable', (raw) => {
    expect(
      errorOf(ZonedTimeSystem.parseIso(raw, SOFIA, DstResolution.Reject)),
    ).toEqual({
      code: TimeErrorCode.InvalidDateTime,
      rawValue: raw,
      reason: 'unparsable',
    });
  });

  it.each([
    '2026-02-30T09:00',
    '2026-08-01T24:00',
    '2026-08-01T09:60',
    '2026-08-01T09:00:60',
  ])('refuses the impossible %j as out of range', (raw) => {
    expect(
      errorOf(ZonedTimeSystem.parseIso(raw, SOFIA, DstResolution.Reject)),
    ).toEqual({
      code: TimeErrorCode.InvalidDateTime,
      rawValue: raw,
      reason: 'out_of_range',
    });
  });

  it('rejects an invalid IANA zone', () => {
    expect(
      errorOf(
        ZonedTimeSystem.parseIso(
          '2026-08-01T09:00:00.000',
          'Not/AZone',
          DstResolution.Reject,
        ),
      ).code,
    ).toBe(TimeErrorCode.InvalidTimeZone);
  });

  it.each([
    // Python's isoformat — microseconds, truncated (never rounded) to the ms.
    ['2026-10-25T03:30:00.123456+03:00', SOFIA_1025_0330_FIRST + 123],
    ['2026-10-25T00:30:00.9999999Z', SOFIA_1025_0330_FIRST + 999],
    ['2026-10-25T00:30:00.123456789Z', SOFIA_1025_0330_FIRST + 123],
    // Postgres — an hour-only offset.
    ['2026-10-25T03:30:00+03', SOFIA_1025_0330_FIRST],
    ['2026-10-25T03:30-03', SOFIA_1025_0330_FIRST + 6 * HOUR],
    ['2026-10-25T06:00+0530', SOFIA_1025_0330_FIRST],
    // A comma as the decimal separator (ISO 8601 prefers it).
    ['2026-10-25T00:30:00,5Z', SOFIA_1025_0330_FIRST + 500],
  ])('reads the stored form %j the legacy fromISO read', (raw, epochMs) => {
    expect(
      valueOf(ZonedTimeSystem.parseIso(raw, SOFIA, DstResolution.Reject)),
    ).toEqual({ epochMs, zone: SOFIA });
  });
});

describe('ZonedTimeSystem.wallClockOf / zones', () => {
  it('recognizes a real IANA zone and rejects a bogus one', () => {
    expect(ZonedTimeSystem.isValidZone(SOFIA)).toBe(true);
    expect(ZonedTimeSystem.isValidZone(SOFIA)).toBe(true); // the cached formatter
    expect(ZonedTimeSystem.isValidZone('Not/AZone')).toBe(false);
    expect(valueOf(ZonedTimeSystem.checkZone(SOFIA))).toBe(SOFIA);
    expect(errorOf(ZonedTimeSystem.checkZone('Not/AZone'))).toEqual({
      code: TimeErrorCode.InvalidTimeZone,
      rawZone: 'Not/AZone',
    });
  });

  it('answers the CANONICAL zone id, so a stored zone is one spelling', () => {
    for (const spelling of ['europe/sofia', 'EUROPE/SOFIA', 'eUrope/sofia']) {
      expect(valueOf(ZonedTimeSystem.checkZone(spelling))).toBe(SOFIA);
      expect(
        valueOf(
          ZonedTimeSystem.resolve(
            key('2026-07-29'),
            9 * 60 + 30,
            spelling,
            DstResolution.Reject,
          ),
        ),
      ).toEqual({ epochMs: SOFIA_0729_0930, zone: SOFIA });
      expect(
        valueOf(
          ZonedTimeSystem.parseIso(
            '2026-07-29T06:30:00Z',
            spelling,
            DstResolution.Reject,
          ),
        ).zone,
      ).toBe(SOFIA);
    }
    expect(valueOf(ZonedTimeSystem.checkZone('utc'))).toBe(UTC);
    expect(valueOf(ZonedTimeSystem.checkZone('Etc/UTC'))).toBe(UTC);
  });

  it('refuses an offset id — not every browser engine accepts one', () => {
    for (const offset of ['+03:00', '-0500', '+03']) {
      expect(ZonedTimeSystem.isValidZone(offset)).toBe(false);
      expect(errorOf(ZonedTimeSystem.checkZone(offset))).toEqual({
        code: TimeErrorCode.InvalidTimeZone,
        rawZone: offset,
      });
      expect(
        ZonedTimeSystem.dayTable(offset, key('2026-07-29'), key('2026-07-29')),
      ).toEqual([]);
    }
  });

  it('exposes the calendar fields in the zone (2026-03-05 14:32, a Thursday)', () => {
    const at = valueOf(
      ZonedTimeSystem.parseIso(
        '2026-03-05T14:32:07',
        SOFIA,
        DstResolution.Reject,
      ),
    ).epochMs;
    expect(valueOf(ZonedTimeSystem.wallClockOf(at, SOFIA))).toEqual({
      dayKey: '2026-03-05',
      minuteOfDay: 14 * 60 + 32,
      second: 7,
      offsetMinutes: 120,
      weekday: Weekday.Thu,
    });
  });

  it('reads the day on the Sofia clock, not the UTC one (loyalty sofiaDayOf)', () => {
    // 22:30 UTC in summer is 01:30 the next morning in Sofia (UTC+3).
    const dayOf = (ms: number) =>
      valueOf(ZonedTimeSystem.wallClockOf(ms, SOFIA)).dayKey;
    expect(dayOf(1_785_537_000_000)).toBe('2026-08-01'); // 2026-07-31T22:30:00Z
    expect(dayOf(1_785_531_599_000)).toBe('2026-07-31'); // 2026-07-31T20:59:59Z
    // The winter offset too (UTC+2).
    expect(dayOf(1_798_754_399_000)).toBe('2026-12-31'); // 2026-12-31T21:59:59Z
    expect(dayOf(1_798_754_400_000)).toBe('2027-01-01'); // 2026-12-31T22:00:00Z
  });

  it('the table gives the same day without touching Intl', () => {
    const days = ZonedTimeSystem.dayTableAround(
      SOFIA,
      1_785_531_599_000,
      1_798_754_400_000,
      0,
    );
    expect(ZonedTimeSystem.dayKeyOf(1_785_537_000_000, days)).toBe(
      '2026-08-01',
    );
    expect(ZonedTimeSystem.dayKeyOf(1_785_531_599_000, days)).toBe(
      '2026-07-31',
    );
    expect(ZonedTimeSystem.dayKeyOf(1_798_754_399_000, days)).toBe(
      '2026-12-31',
    );
    expect(ZonedTimeSystem.dayKeyOf(1_798_754_400_000, days)).toBe(
      '2027-01-01',
    );
  });

  it('refuses an unknown zone or an instant it cannot read', () => {
    expect(errorOf(ZonedTimeSystem.wallClockOf(0, 'Not/AZone')).code).toBe(
      TimeErrorCode.InvalidTimeZone,
    );
    expect(errorOf(ZonedTimeSystem.wallClockOf(Number.NaN, SOFIA))).toEqual({
      code: TimeErrorCode.InvalidDateTime,
      rawValue: 'NaN',
      reason: 'out_of_range',
    });
  });
});

describe('ZonedTimeSystem.isoOf — an instant on the zone’s clock, with its offset', () => {
  it('spells the instant as ZonedDateTime.toISO() did in the shop’s zone', () => {
    // 2026-10-10T11:00:00.000Z — Sofia summer (EEST, +03:00).
    expect(valueOf(ZonedTimeSystem.isoOf(1_791_630_000_000, SOFIA))).toBe(
      '2026-10-10T14:00:00.000+03:00',
    );
    // 2026-12-01T08:30:15.007Z — Sofia winter (EET, +02:00); seconds and ms kept.
    expect(valueOf(ZonedTimeSystem.isoOf(1_796_113_815_007, SOFIA))).toBe(
      '2026-12-01T10:30:15.007+02:00',
    );
  });

  it('names each occurrence of the repeated hour by its own offset', () => {
    // 2026-10-25T00:30Z and 01:30Z both read 03:30 in Sofia.
    expect(valueOf(ZonedTimeSystem.isoOf(1_792_888_200_000, SOFIA))).toBe(
      '2026-10-25T03:30:00.000+03:00',
    );
    expect(valueOf(ZonedTimeSystem.isoOf(1_792_891_800_000, SOFIA))).toBe(
      '2026-10-25T03:30:00.000+02:00',
    );
  });

  it('writes a non-hour, a negative and a zero offset as ±HH:MM', () => {
    // 2026-10-10T00:00Z.
    expect(valueOf(ZonedTimeSystem.isoOf(1_791_590_400_000, KOLKATA))).toBe(
      '2026-10-10T05:30:00.000+05:30',
    );
    expect(valueOf(ZonedTimeSystem.isoOf(1_791_590_400_000, UTC))).toBe(
      '2026-10-10T00:00:00.000+00:00',
    );
    // 2026-10-10T02:00Z is the previous evening in São Paulo (-03:00).
    expect(valueOf(ZonedTimeSystem.isoOf(1_791_597_600_000, SAO_PAULO))).toBe(
      '2026-10-09T23:00:00.000-03:00',
    );
    // Before the epoch: the millisecond is still the positive remainder.
    expect(valueOf(ZonedTimeSystem.isoOf(-1, UTC))).toBe(
      '1969-12-31T23:59:59.999+00:00',
    );
  });

  it('reads back through parseIso as the same instant', () => {
    for (const epochMs of [1_791_630_000_000, 1_792_891_800_000]) {
      const iso = valueOf(ZonedTimeSystem.isoOf(epochMs, SOFIA));
      expect(
        valueOf(ZonedTimeSystem.parseIso(iso, SOFIA, DstResolution.Reject))
          .epochMs,
      ).toBe(epochMs);
    }
  });

  it('refuses a zone the runtime does not know, and an instant out of range', () => {
    expect(errorOf(ZonedTimeSystem.isoOf(0, 'Not/AZone'))).toEqual({
      code: TimeErrorCode.InvalidTimeZone,
      rawZone: 'Not/AZone',
    });
    expect(errorOf(ZonedTimeSystem.isoOf(Number.NaN, SOFIA)).code).toBe(
      TimeErrorCode.InvalidDateTime,
    );
  });
});

describe('UTC and a non-hour offset (sanity)', () => {
  it('UTC: every day starts at UTC midnight and nothing ever transitions', () => {
    const days = ZonedTimeSystem.dayTable(
      UTC,
      key('2026-03-28'),
      key('2026-10-26'),
    );
    expect(
      days.every(
        (d) => d.offsetMinutes === 0 && d.transitionAtMinutes === null,
      ),
    ).toBe(true);
    expect(DayOffset.find(key('2026-07-29'), days)?.dayStartMs).toBe(
      UTC_0729_START,
    );
    expect(
      valueOf(ZonedTimeSystem.wallClockOf(UTC_0729_START + 90 * MIN, UTC)),
    ).toMatchObject({
      dayKey: '2026-07-29',
      minuteOfDay: 90,
      offsetMinutes: 0,
    });
  });

  it('Asia/Kolkata: +05:30 shifts the day by half an hour too', () => {
    const day = row(KOLKATA, '2026-07-30');
    expect(day).toEqual({
      dayKey: '2026-07-30',
      dayStartMs: KOLKATA_0730_START,
      offsetMinutes: 330,
      transitionAtMinutes: null,
      transitionDeltaMinutes: 0,
      weekday: Weekday.Thu,
    });
    expect(ZonedTimeSystem.instantOf(day, 9 * 60 + 15)).toBe(KOLKATA_0730_0915);
    expect(ZonedTimeSystem.minuteOfDay(KOLKATA_0730_0915, day)).toBe(555);
    expect(
      valueOf(
        ZonedTimeSystem.resolve(
          key('2026-07-30'),
          555,
          KOLKATA,
          DstResolution.Reject,
        ),
      ).epochMs,
    ).toBe(KOLKATA_0730_0915);
    expect(
      valueOf(ZonedTimeSystem.wallClockOf(KOLKATA_0730_0915, KOLKATA))
        .offsetMinutes,
    ).toBe(330);
  });
});

describe('a zone that moves its clocks at midnight (America/Sao_Paulo)', () => {
  it('spring: midnight itself is erased, so the day starts at 01:00 on the new clock', () => {
    const days = ZonedTimeSystem.dayTable(
      SAO_PAULO,
      key('2018-11-03'),
      key('2018-11-05'),
    );
    expect(days[0]).toMatchObject({
      dayStartMs: SP_1103_START,
      offsetMinutes: -180,
      transitionAtMinutes: null,
    });
    expect(days[1]).toEqual({
      dayKey: '2018-11-04',
      dayStartMs: SP_SPRING_SWITCH,
      offsetMinutes: -180,
      transitionAtMinutes: 0,
      transitionDeltaMinutes: 60,
      weekday: Weekday.Sun,
    });
    expect((days[2] as DayOffset).dayStartMs).toBe(SP_1105_START);
    const day = days[1] as DayOffset;
    expect(ZonedTimeSystem.instantOf(day, 30)).toBe(SP_SPRING_SWITCH);
    expect(ZonedTimeSystem.instantOf(day, 60)).toBe(SP_SPRING_SWITCH);
    expect(ZonedTimeSystem.minuteOfDay(SP_SPRING_SWITCH, day)).toBe(60);
    expect(
      errorOf(
        ZonedTimeSystem.resolve(
          key('2018-11-04'),
          0,
          SAO_PAULO,
          DstResolution.Reject,
        ),
      ).code,
    ).toBe(TimeErrorCode.NonexistentLocalTime);
  });

  it('a table that STARTS on the erased midnight still starts at the switch', () => {
    expect(
      (
        ZonedTimeSystem.dayTable(
          SAO_PAULO,
          key('2018-11-04'),
          key('2018-11-04'),
        )[0] as DayOffset
      ).dayStartMs,
    ).toBe(SP_SPRING_SWITCH);
  });

  it('autumn: the 16th runs 25 hours and repeats its own last hour', () => {
    const days = ZonedTimeSystem.dayTable(
      SAO_PAULO,
      key('2019-02-16'),
      key('2019-02-17'),
    );
    expect(days[0]).toEqual({
      dayKey: '2019-02-16',
      dayStartMs: SP_0216_START,
      offsetMinutes: -120,
      transitionAtMinutes: 1440,
      transitionDeltaMinutes: -60,
      weekday: Weekday.Sat,
    });
    expect(days[1]).toMatchObject({
      dayStartMs: SP_0217_START,
      offsetMinutes: -180,
      transitionAtMinutes: null,
    });
    const day = days[0] as DayOffset;
    expect(DayOffset.endMs(day)).toBe(SP_0217_START);
    expect(ZonedTimeSystem.minuteOfDay(SP_FALL_SWITCH, day)).toBe(23 * 60);
    expect(ZonedTimeSystem.instantOf(day, 1440)).toBe(SP_0217_START);
    expect(DayOffset.endMs(days[1] as DayOffset)).toBe(SP_0218_START);
    expect(
      errorOf(
        ZonedTimeSystem.resolve(
          key('2019-02-16'),
          23 * 60 + 30,
          SAO_PAULO,
          DstResolution.Reject,
        ),
      ).code,
    ).toBe(TimeErrorCode.AmbiguousLocalTime);
  });
});

/*
 * Pinned against the legacy probe (a scratch comparison of the Luxon-backed
 * kernel over every transition day 2018–2027 and all IANA zones): in each
 * case below the new code is right and the legacy class was not, so a later
 * refactor must not drift back. The legacy `fromParts` probed ambiguity at
 * +1 h, so it never saw a 30-minute overlap, and its `startOf('day')` took
 * the SECOND of two midnights.
 */
describe('zones the Sofia set never reaches', () => {
  it('Australia/Lord_Howe: a 30-minute overlap in April, rejected unless a side is named', () => {
    const day = row(LORD_HOWE, '2026-04-05');
    expect(day).toEqual({
      dayKey: '2026-04-05',
      dayStartMs: LH_0405_START,
      offsetMinutes: 660,
      transitionAtMinutes: 120,
      transitionDeltaMinutes: -30,
      weekday: Weekday.Sun,
    });
    expect(DayOffset.lengthMinutes(day)).toBe(1470);
    expect(
      errorOf(
        ZonedTimeSystem.resolve(
          key('2026-04-05'),
          105,
          LORD_HOWE,
          DstResolution.Reject,
        ),
      ).code,
    ).toBe(TimeErrorCode.AmbiguousLocalTime);
    expect(
      valueOf(
        ZonedTimeSystem.resolve(
          key('2026-04-05'),
          105,
          LORD_HOWE,
          DstResolution.Earlier,
        ),
      ).epochMs,
    ).toBe(LH_0405_0145_FIRST);
    expect(
      valueOf(
        ZonedTimeSystem.resolve(
          key('2026-04-05'),
          105,
          LORD_HOWE,
          DstResolution.Later,
        ),
      ).epochMs,
    ).toBe(LH_0405_0145_SECOND);
    expect(ZonedTimeSystem.instantOf(day, 105)).toBe(LH_0405_0145_FIRST);
    expect(ZonedTimeSystem.minuteOfDay(LH_0405_0145_SECOND, day)).toBe(105);
  });

  it('Australia/Lord_Howe: a 30-minute gap in October, rejected unless shifted forward', () => {
    const day = row(LORD_HOWE, '2026-10-04');
    expect(day).toEqual({
      dayKey: '2026-10-04',
      dayStartMs: LH_1004_START,
      offsetMinutes: 630,
      transitionAtMinutes: 120,
      transitionDeltaMinutes: 30,
      weekday: Weekday.Sun,
    });
    expect(DayOffset.lengthMinutes(day)).toBe(1410);
    expect(
      errorOf(
        ZonedTimeSystem.resolve(
          key('2026-10-04'),
          135,
          LORD_HOWE,
          DstResolution.Reject,
        ),
      ).code,
    ).toBe(TimeErrorCode.NonexistentLocalTime);
    expect(
      valueOf(
        ZonedTimeSystem.resolve(
          key('2026-10-04'),
          135,
          LORD_HOWE,
          DstResolution.ShiftForward,
        ),
      ).epochMs,
    ).toBe(LH_1004_0215_SHIFTED);
    // 01:45 exists on the gap day: only the erased half hour is refused.
    expect(
      valueOf(
        ZonedTimeSystem.resolve(
          key('2026-10-04'),
          105,
          LORD_HOWE,
          DstResolution.Reject,
        ),
      ).epochMs,
    ).toBe(LH_1004_START + 105 * MIN);
  });

  it('Africa/Cairo: a fall-back AT midnight — transitionAtMinutes 1440, the last hour repeated', () => {
    const days = ZonedTimeSystem.dayTable(
      CAIRO,
      key('2026-10-29'),
      key('2026-10-30'),
    );
    expect(days[0]).toEqual({
      dayKey: '2026-10-29',
      dayStartMs: CAIRO_1029_START,
      offsetMinutes: 180,
      transitionAtMinutes: 1440,
      transitionDeltaMinutes: -60,
      weekday: Weekday.Thu,
    });
    expect(days[1]).toMatchObject({
      dayStartMs: CAIRO_1030_START,
      offsetMinutes: 120,
      transitionAtMinutes: null,
    });
    expectContiguous(days);
    const day = days[0] as DayOffset;
    // Every wall minute of [23:00, 24:00) happens twice…
    for (const wall of [1380, 1410, 1439]) {
      expect(
        errorOf(
          ZonedTimeSystem.resolve(
            key('2026-10-29'),
            wall,
            CAIRO,
            DstResolution.Reject,
          ),
        ).code,
      ).toBe(TimeErrorCode.AmbiguousLocalTime);
    }
    // …and 22:59 does not.
    expect(
      valueOf(
        ZonedTimeSystem.resolve(
          key('2026-10-29'),
          1379,
          CAIRO,
          DstResolution.Reject,
        ),
      ).epochMs,
    ).toBe(CAIRO_1029_START + 1379 * MIN);
    expect(ZonedTimeSystem.instantOf(day, 1410)).toBe(CAIRO_1029_2330_FIRST);
    expect(ZonedTimeSystem.minuteOfDay(CAIRO_FALL_SWITCH, day)).toBe(1380);
    expect(ZonedTimeSystem.minuteOfDay(CAIRO_1029_2330_SECOND, day)).toBe(1410);
    expect(
      valueOf(
        ZonedTimeSystem.resolve(
          key('2026-10-29'),
          1410,
          CAIRO,
          DstResolution.Later,
        ),
      ).epochMs,
    ).toBe(CAIRO_1029_2330_SECOND);
  });

  it('America/Scoresbysund: a repeated MIDNIGHT — the day starts at the first one', () => {
    const day = row(SCORESBYSUND, '2018-10-28');
    expect(day).toEqual({
      dayKey: '2018-10-28',
      dayStartMs: SCORESBY_1028_FIRST_MIDNIGHT,
      offsetMinutes: 0,
      transitionAtMinutes: 60,
      transitionDeltaMinutes: -60,
      weekday: Weekday.Sun,
    });
    expect(DayOffset.endMs(day)).toBe(SCORESBY_1029_START);
    expect(
      ZonedTimeSystem.minuteOfDay(SCORESBY_1028_SECOND_MIDNIGHT, day),
    ).toBe(0);
    expect(
      ZonedTimeSystem.dayKeyOf(SCORESBY_1028_FIRST_MIDNIGHT - 1, [
        row(SCORESBYSUND, '2018-10-27'),
        day,
      ]),
    ).toBe('2018-10-27');
  });
});

describe('day keys — civil arithmetic', () => {
  it('counts calendar days, signed, and is not thrown by a DST change', () => {
    expect(
      ZonedTimeSystem.daysBetween(key('2026-09-01'), key('2026-09-28')),
    ).toBe(27);
    expect(
      ZonedTimeSystem.daysBetween(key('2026-09-28'), key('2026-09-01')),
    ).toBe(-27);
    expect(
      ZonedTimeSystem.daysBetween(key('2026-09-28'), key('2026-09-28')),
    ).toBe(0);
    // The autumn transition makes one Sofia day 25 hours long; days are still days.
    expect(
      ZonedTimeSystem.daysBetween(key('2026-10-24'), key('2026-10-26')),
    ).toBe(2);
    expect(
      ZonedTimeSystem.daysBetween(key('2026-03-28'), key('2026-03-30')),
    ).toBe(2);
  });

  it('addDays moves forward and backward across months and years', () => {
    expect(ZonedTimeSystem.addDays(key('2026-01-31'), 1)).toBe('2026-02-01');
    expect(ZonedTimeSystem.addDays(key('2026-01-31'), -1)).toBe('2026-01-30');
    expect(ZonedTimeSystem.addDays(key('2026-12-31'), 1)).toBe('2027-01-01');
    expect(ZonedTimeSystem.addDays(key('2028-02-28'), 1)).toBe('2028-02-29');
    expect(ZonedTimeSystem.addDays(key('2026-03-28'), 0)).toBe('2026-03-28');
  });

  it('addMonths moves forward and backward, clamping to the month length', () => {
    expect(ZonedTimeSystem.addMonths(key('2026-01-31'), 1)).toBe('2026-02-28');
    expect(ZonedTimeSystem.addMonths(key('2028-01-31'), 1)).toBe('2028-02-29');
    expect(ZonedTimeSystem.addMonths(key('2026-01-31'), -1)).toBe('2025-12-31');
    expect(ZonedTimeSystem.addMonths(key('2026-03-17'), 12)).toBe('2027-03-17');
    expect(ZonedTimeSystem.addMonths(key('2026-05-31'), -3)).toBe('2026-02-28');
  });

  it('startOfMonth resets to the 1st', () => {
    expect(ZonedTimeSystem.startOfMonth(key('2026-03-17'))).toBe('2026-03-01');
  });

  it('rangeKeys lists every day of the range, both ends included', () => {
    expect(
      ZonedTimeSystem.rangeKeys(
        DateRange.of(key('2026-02-27'), key('2026-03-02')),
      ),
    ).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
    expect(
      ZonedTimeSystem.rangeKeys(
        DateRange.of(key('2026-03-02'), key('2026-03-01')),
      ),
    ).toEqual([]);
  });

  it('weekdayOf is the ISO weekday', () => {
    expect(ZonedTimeSystem.weekdayOf(key('2026-03-05'))).toBe(Weekday.Thu);
    expect(ZonedTimeSystem.weekdayOf(key('2026-06-15'))).toBe(Weekday.Mon);
    expect(ZonedTimeSystem.weekdayOf(key('1970-01-01'))).toBe(Weekday.Thu);
    expect(ZonedTimeSystem.weekdayOf(key('1969-12-28'))).toBe(Weekday.Sun);
  });

  it('wholeYearsBetween counts a birthday only once it has passed', () => {
    const birth = key('2000-06-15');
    expect(ZonedTimeSystem.wholeYearsBetween(birth, key('2026-06-14'))).toBe(
      25,
    );
    expect(ZonedTimeSystem.wholeYearsBetween(birth, key('2026-06-15'))).toBe(
      26,
    );
    expect(ZonedTimeSystem.wholeYearsBetween(birth, key('2026-06-16'))).toBe(
      26,
    );
    // A leap-day birthday completes its year on 28 February in a common
    // year — the legacy Luxon `yearsUntil` clamp (ZZD art. 72(2)).
    expect(
      ZonedTimeSystem.wholeYearsBetween(key('2000-02-29'), key('2001-02-27')),
    ).toBe(0);
    expect(
      ZonedTimeSystem.wholeYearsBetween(key('2000-02-29'), key('2001-02-28')),
    ).toBe(1);
    expect(
      ZonedTimeSystem.wholeYearsBetween(key('2000-02-29'), key('2001-03-01')),
    ).toBe(1);
    expect(
      ZonedTimeSystem.wholeYearsBetween(key('2008-02-29'), key('2025-02-28')),
    ).toBe(17);
    // …and on 29 February itself in a leap year, never on the 28th.
    expect(
      ZonedTimeSystem.wholeYearsBetween(key('2000-02-29'), key('2004-02-28')),
    ).toBe(3);
    expect(
      ZonedTimeSystem.wholeYearsBetween(key('2000-02-29'), key('2004-02-29')),
    ).toBe(4);
    expect(
      ZonedTimeSystem.wholeYearsBetween(key('2001-02-28'), key('2000-02-29')),
    ).toBe(-1);
    // Backwards, truncated toward zero.
    expect(
      ZonedTimeSystem.wholeYearsBetween(key('2026-06-15'), key('2000-06-16')),
    ).toBe(-25);
  });
});

describe('ZonedTimeSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const days = deepFreeze(
      ZonedTimeSystem.dayTable(SOFIA, key('2026-03-28'), key('2026-03-30')),
    );
    const range = deepFreeze(
      DateRange.of(key('2026-03-28'), key('2026-03-30')),
    );
    const run = () => ({
      table: ZonedTimeSystem.dayTable(
        SOFIA,
        key('2026-03-28'),
        key('2026-03-30'),
      ),
      around: ZonedTimeSystem.dayTableAround(
        SOFIA,
        SOFIA_SPRING_SWITCH,
        SOFIA_SPRING_SWITCH,
        1,
      ),
      dayKey: ZonedTimeSystem.dayKeyOf(SOFIA_0329_0430, days),
      instant: ZonedTimeSystem.instantOf(days[1] as DayOffset, 270),
      minute: ZonedTimeSystem.minuteOfDay(
        SOFIA_0329_0430,
        days[1] as DayOffset,
      ),
      keys: ZonedTimeSystem.rangeKeys(range),
      resolved: ZonedTimeSystem.resolve(
        key('2026-10-25'),
        210,
        SOFIA,
        DstResolution.Later,
      ),
      wall: ZonedTimeSystem.wallClockOf(SOFIA_0329_0430, SOFIA),
    });
    const once = run();
    const twice = run();
    expect(twice).toEqual(once);
    expect(once.table).toEqual(days);
    expect(once.around).toEqual(days);
  });
});
