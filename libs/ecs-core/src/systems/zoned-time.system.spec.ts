import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type Result,
  Weekday,
  LocalDate,
  type MinuteOfDay,
  type TimeZone,
  UtcEpochMs,
} from '@core/primitives';
import { DateTimeInvalidReason, TimeErrorCode } from '@core/errors';
import { ZonedTimeSystem } from './zoned-time.system';
import {
  deepFreeze,
  localDate,
  minute,
  unwrapOk,
  utcMs,
  offsetIso,
} from '@core/testing';

/*
 * Every expected instant below is a LITERAL epoch-ms constant (its UTC
 * reading in the comment), never computed with a date library — the
 * successor of the kernel's 32 Luxon-backed DST specs (§9 D5). The
 * pre-flatten day-table API (`dayTable`, `instantOf`, `resolve`, `parseIso`,
 * `wallClockOf`, `isoOf`, the day-key helpers) is gone (flatten-spec §2.2):
 * every one of its cases below is re-shaped onto the ingestion API —
 * `toUtc` (gap → `DST_GAP_INVALID_TIME`, repeat → the EARLIER offset),
 * `toLocal`, `startOfLocalDay`, `parseOffsetIso` — and the civil day
 * arithmetic lives in `local-date.primitive.spec.ts`. An instant's spelling
 * on a zone's clock is the test-support `offsetIso` (`test-support.spec.ts`).
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

const SOFIA_TZ = unwrapOk(ZonedTimeSystem.checkZone(SOFIA));
const KOLKATA_TZ = unwrapOk(ZonedTimeSystem.checkZone(KOLKATA));
const UTC_TZ = unwrapOk(ZonedTimeSystem.checkZone(UTC));
const SAO_PAULO_TZ = unwrapOk(ZonedTimeSystem.checkZone(SAO_PAULO));
const LORD_HOWE_TZ = unwrapOk(ZonedTimeSystem.checkZone(LORD_HOWE));
const CAIRO_TZ = unwrapOk(ZonedTimeSystem.checkZone(CAIRO));
const SCORESBYSUND_TZ = unwrapOk(ZonedTimeSystem.checkZone(SCORESBYSUND));

/** A literal epoch-ms constant of this file as the brand. */
const at = (ms: number): UtcEpochMs => unwrapOk(UtcEpochMs.of(ms));

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

/** The instant of a wall-clock minute — a gap minute is a broken fixture. */
function utcOf(raw: string, wall: number, zone: TimeZone): number {
  return valueOf(ZonedTimeSystem.toUtc(localDate(raw), minute(wall), zone));
}

/** The shop day's length in minutes: next local midnight − this one. */
function dayLengthMinutes(raw: string, zone: TimeZone): number {
  const day = localDate(raw);
  return (
    (ZonedTimeSystem.startOfLocalDay(LocalDate.addDays(day, 1), zone) -
      ZonedTimeSystem.startOfLocalDay(day, zone)) /
    MIN
  );
}

/** The `±HH:MM` offset `offsetIso` spells for an instant — the offset in force. */
function offsetOf(ms: number, zone: TimeZone): string {
  return offsetIso(at(ms), zone).slice(-6);
}

describe('the DST set — day lengths and switch days (Europe/Sofia)', () => {
  it('the 23-hour spring day: its 03:00–03:59 never happens', () => {
    expect(
      ZonedTimeSystem.startOfLocalDay(localDate('2026-03-29'), SOFIA_TZ),
    ).toBe(SOFIA_0329_START);
    expect(dayLengthMinutes('2026-03-29', SOFIA_TZ)).toBe(23 * 60);
    expect(
      ZonedTimeSystem.startOfLocalDay(localDate('2026-03-30'), SOFIA_TZ),
    ).toBe(SOFIA_0330_START);
    expect(LocalDate.weekday(localDate('2026-03-29'))).toBe(Weekday.Sun);
    expect(offsetOf(SOFIA_0329_START, SOFIA_TZ)).toBe('+02:00');
    expect(offsetOf(SOFIA_SPRING_SWITCH, SOFIA_TZ)).toBe('+03:00');
    for (const wall of [180, 239]) {
      expect(
        errorOf(
          ZonedTimeSystem.toUtc(
            localDate('2026-03-29'),
            minute(wall),
            SOFIA_TZ,
          ),
        ).errorCode,
      ).toBe(TimeErrorCode.DstGap);
    }
  });

  it('the 25-hour autumn day: its 03:00–03:59 happens twice', () => {
    expect(
      ZonedTimeSystem.startOfLocalDay(localDate('2026-10-25'), SOFIA_TZ),
    ).toBe(SOFIA_1025_START);
    expect(dayLengthMinutes('2026-10-25', SOFIA_TZ)).toBe(25 * 60);
    expect(
      ZonedTimeSystem.startOfLocalDay(localDate('2026-10-26'), SOFIA_TZ),
    ).toBe(SOFIA_1026_START);
    expect(
      ZonedTimeSystem.toLocal(at(SOFIA_1025_0330_FIRST), SOFIA_TZ),
    ).toEqual(ZonedTimeSystem.toLocal(at(SOFIA_1025_0330_SECOND), SOFIA_TZ));
    expect(offsetOf(SOFIA_1025_0330_FIRST, SOFIA_TZ)).toBe('+03:00');
    expect(offsetOf(SOFIA_1025_0330_SECOND, SOFIA_TZ)).toBe('+02:00');
  });

  it('the days either side are ordinary: 24 hours, each starting where the last ended', () => {
    expect(
      ZonedTimeSystem.startOfLocalDay(localDate('2026-03-28'), SOFIA_TZ),
    ).toBe(SOFIA_0328_START);
    expect(dayLengthMinutes('2026-03-28', SOFIA_TZ)).toBe(24 * 60);
    expect(dayLengthMinutes('2026-03-30', SOFIA_TZ)).toBe(24 * 60);
    expect(offsetOf(SOFIA_0328_START, SOFIA_TZ)).toBe('+02:00');
    expect(offsetOf(SOFIA_0330_START, SOFIA_TZ)).toBe('+03:00');
    expect(LocalDate.weekday(localDate('2026-03-28'))).toBe(Weekday.Sat);
    expect(LocalDate.weekday(localDate('2026-03-30'))).toBe(Weekday.Mon);
  });

  it('exactly the two switch days of a whole year differ from 24 hours, and no time is lost', () => {
    const year = LocalDate.range(
      localDate('2026-01-01'),
      localDate('2026-12-31'),
    );
    expect(year).toHaveLength(365);
    expect(
      year.filter((day) => dayLengthMinutes(day, SOFIA_TZ) !== 24 * 60),
    ).toEqual(['2026-03-29', '2026-10-25']);
    // Spring and autumn cancel out: 365 days of exactly 24 hours each.
    expect(
      ZonedTimeSystem.startOfLocalDay(localDate('2027-01-01'), SOFIA_TZ) -
        ZonedTimeSystem.startOfLocalDay(localDate('2026-01-01'), SOFIA_TZ),
    ).toBe(365 * 24 * HOUR);
  });

  it('fails closed on a zone the runtime does not know', () => {
    const bogus = 'Not/AZone' as TimeZone;
    expect(
      errorOf(ZonedTimeSystem.toUtc(localDate('2026-03-29'), minute(0), bogus)),
    ).toEqual({
      errorCode: TimeErrorCode.InvalidTimeZone,
      rawZone: 'Not/AZone',
    });
    expect(() =>
      ZonedTimeSystem.startOfLocalDay(localDate('2026-03-29'), bogus),
    ).toThrow(/defect/);
  });

  it('fails closed outside the years it can read — year 0000 never reaches the formatter', () => {
    // The formatter prints a year-0 instant as year 1 (no era part); an
    // instant built there would be a year off. Refused, not wrong.
    expect(
      errorOf(
        ZonedTimeSystem.toUtc(localDate('0000-12-31'), minute(0), UTC_TZ),
      ),
    ).toEqual({
      errorCode: TimeErrorCode.InvalidDateTime,
      rawValue: '0000-12-31T00:00',
      dateTimeInvalidReason: DateTimeInvalidReason.OutOfRange,
    });
    expect(
      ZonedTimeSystem.toUtc(localDate('9999-12-31'), minute(0), UTC_TZ).ok,
    ).toBe(false);
    expect(() =>
      ZonedTimeSystem.startOfLocalDay(localDate('0001-01-02'), UTC_TZ),
    ).toThrow(/outside the readable window/);
    expect(() =>
      ZonedTimeSystem.startOfLocalDay(localDate('9999-12-30'), UTC_TZ),
    ).toThrow(/outside the readable window/);
    expect(
      ZonedTimeSystem.startOfLocalDay(localDate('0001-01-05'), UTC_TZ),
    ).toBe(utcOf('0001-01-05', 0, UTC_TZ));
  });

  it('local mean time: a second-precise offset still reads back as the same wall minute', () => {
    // Sofia kept Istanbul mean time (+01:56:56) until 1894-11-30; Monrovia
    // kept −00:44:30 until 1972-01-07. The instant carries the odd seconds;
    // the wall clock it reads on is the minute that was asked for.
    for (const [raw, zone] of [
      ['1894-11-28', SOFIA_TZ],
      ['1894-12-01', SOFIA_TZ],
      ['1971-06-01', unwrapOk(ZonedTimeSystem.checkZone('Africa/Monrovia'))],
      ['1972-02-01', unwrapOk(ZonedTimeSystem.checkZone('Africa/Monrovia'))],
    ] as const) {
      const instant = valueOf(
        ZonedTimeSystem.toUtc(localDate(raw), minute(600), zone),
      );
      expect(ZonedTimeSystem.toLocal(instant, zone)).toEqual({
        localDate: raw,
        minute: 600,
      });
    }
    expect(Math.abs(utcOf('1894-11-28', 600, SOFIA_TZ) % MIN)).not.toBe(0);
    expect(Math.abs(utcOf('1894-12-01', 600, SOFIA_TZ) % MIN)).toBe(0);
  });

  it('reads any of ten years of days in one step each — no table to build', () => {
    const from = localDate('2020-01-01');
    const last = LocalDate.addDays(from, 3659);
    expect(
      ZonedTimeSystem.startOfLocalDay(last, UTC_TZ) -
        ZonedTimeSystem.startOfLocalDay(from, UTC_TZ),
    ).toBe(3659 * 24 * HOUR);
  });
});

describe('both sides of the switch minute — toUtc / toLocal', () => {
  it('spring: before the switch is plain subtraction from local midnight', () => {
    expect(utcOf('2026-03-29', 0, SOFIA_TZ)).toBe(SOFIA_0329_START);
    expect(utcOf('2026-03-29', 179, SOFIA_TZ)).toBe(SOFIA_0329_0259);
    expect(ZonedTimeSystem.toLocal(at(SOFIA_0329_0259), SOFIA_TZ).minute).toBe(
      179,
    );
  });

  it('spring: at and after the switch the clock is an hour ahead', () => {
    expect(utcOf('2026-03-29', 240, SOFIA_TZ)).toBe(SOFIA_SPRING_SWITCH);
    expect(
      ZonedTimeSystem.toLocal(at(SOFIA_SPRING_SWITCH), SOFIA_TZ).minute,
    ).toBe(240);
    expect(utcOf('2026-03-29', 270, SOFIA_TZ)).toBe(SOFIA_0329_0430);
    expect(ZonedTimeSystem.toLocal(at(SOFIA_0329_0430), SOFIA_TZ).minute).toBe(
      270,
    );
  });

  it('spring: an erased wall minute is refused; the first minute that exists is the switch', () => {
    for (const wall of [180, 210, 239]) {
      expect(
        errorOf(
          ZonedTimeSystem.toUtc(
            localDate('2026-03-29'),
            minute(wall),
            SOFIA_TZ,
          ),
        ).errorCode,
      ).toBe(TimeErrorCode.DstGap);
    }
    expect(utcOf('2026-03-29', 240, SOFIA_TZ)).toBe(SOFIA_SPRING_SWITCH);
  });

  it('autumn: the first 03:00–03:59 is before the switch, the second after it', () => {
    expect(utcOf('2026-10-25', 210, SOFIA_TZ)).toBe(SOFIA_1025_0330_FIRST);
    expect(
      ZonedTimeSystem.toLocal(at(SOFIA_1025_0330_FIRST), SOFIA_TZ).minute,
    ).toBe(210);
    // The switch instant reads 03:00 again, and the second 03:30 reads 03:30.
    expect(
      ZonedTimeSystem.toLocal(at(SOFIA_FALL_SWITCH), SOFIA_TZ).minute,
    ).toBe(180);
    expect(
      ZonedTimeSystem.toLocal(at(SOFIA_1025_0330_SECOND), SOFIA_TZ).minute,
    ).toBe(210);
    // 04:00 exists once, after the repeat: 5 real hours after midnight.
    expect(utcOf('2026-10-25', 240, SOFIA_TZ)).toBe(
      SOFIA_1025_START + 5 * HOUR,
    );
    expect(
      ZonedTimeSystem.toLocal(at(SOFIA_1025_START + 5 * HOUR), SOFIA_TZ).minute,
    ).toBe(240);
    expect(utcOf('2026-10-25', 239, SOFIA_TZ)).toBe(
      SOFIA_1025_START + 239 * MIN,
    );
  });

  it('the closing midnight (1440) is the next day’s start on every kind of day', () => {
    expect(
      ZonedTimeSystem.startOfLocalDay(localDate('2026-03-30'), SOFIA_TZ),
    ).toBe(SOFIA_0330_START);
    expect(
      ZonedTimeSystem.startOfLocalDay(localDate('2026-10-26'), SOFIA_TZ),
    ).toBe(SOFIA_1026_START);
    expect(
      ZonedTimeSystem.startOfLocalDay(localDate('2026-07-30'), SOFIA_TZ),
    ).toBe(SOFIA_0729_START + 24 * HOUR);
  });

  it('toLocal floors to the minute, and a visit crossing midnight reads on the next day', () => {
    expect(
      ZonedTimeSystem.toLocal(at(SOFIA_0729_0930 + 59_999), SOFIA_TZ),
    ).toEqual({ localDate: '2026-07-29', minute: 570 });
    expect(
      ZonedTimeSystem.toLocal(
        at(SOFIA_0729_START + 24 * HOUR + 15 * MIN),
        SOFIA_TZ,
      ),
    ).toEqual({ localDate: '2026-07-30', minute: 15 });
  });

  // ~105k Intl round trips: about 2 s alone, but past Vitest's 5 s default
  // when `run-many -t test --parallel=3` shares the CPU — its own budget.
  it('round-trips every existing wall minute of every Sofia day of 2026', () => {
    const mismatches: string[] = [];
    for (const day of LocalDate.range(
      localDate('2026-01-01'),
      localDate('2026-12-31'),
    )) {
      for (let wall = 0; wall < 1440; wall += 5) {
        const instant = ZonedTimeSystem.toUtc(day, minute(wall), SOFIA_TZ);
        const erased = day === '2026-03-29' && wall >= 180 && wall < 240;
        if (erased) {
          if (instant.ok) mismatches.push(`${day} ${wall} not refused`);
          continue;
        }
        if (!instant.ok) {
          mismatches.push(`${day} ${wall} refused`);
          continue;
        }
        const back = ZonedTimeSystem.toLocal(instant.value, SOFIA_TZ);
        if (back.localDate !== day || back.minute !== wall) {
          mismatches.push(`${day} ${wall}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  }, 30_000);

  it('agrees with the zone itself (Intl) for any instant', () => {
    const zones = [SOFIA_TZ, KOLKATA_TZ, SAO_PAULO_TZ];
    const formats = zones.map(
      (timeZone) =>
        new Intl.DateTimeFormat('en-CA', {
          timeZone,
          hourCycle: 'h23',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }),
    );
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 }),
        fc.integer({ min: 1_541_000_000_000, max: 1_793_500_000_000 }),
        (z, ms) => {
          const parts = Object.fromEntries(
            (formats.at(z) as Intl.DateTimeFormat)
              .formatToParts(ms)
              .map((part) => [part.type, part.value]),
          );
          expect(
            ZonedTimeSystem.toLocal(at(ms), zones.at(z) as TimeZone),
          ).toEqual({
            localDate: `${parts['year']}-${parts['month']}-${parts['day']}`,
            minute: Number(parts['hour']) * 60 + Number(parts['minute']),
          });
        },
      ),
    );
  });
});

describe('a roster window spanning the switch', () => {
  it('places every post-switch shift at the right instant (spring)', () => {
    // 09:00–18:00 lies wholly after the switch: on the +03:00 clock.
    expect(utcOf('2026-03-29', 9 * 60, SOFIA_TZ)).toBe(SOFIA_0329_0900);
    expect(utcOf('2026-03-29', 18 * 60, SOFIA_TZ)).toBe(SOFIA_0329_1800);
    // 02:00–06:00 spans it: four hours of wall clock, three of real time.
    const start = utcOf('2026-03-29', 2 * 60, SOFIA_TZ);
    const end = utcOf('2026-03-29', 6 * 60, SOFIA_TZ);
    expect(start).toBe(SOFIA_0329_0200);
    expect(end - start).toBe(3 * HOUR);
  });

  it('places every post-switch shift at the right instant (autumn)', () => {
    expect(utcOf('2026-10-25', 9 * 60, SOFIA_TZ)).toBe(SOFIA_1025_0900);
    expect(utcOf('2026-10-25', 18 * 60, SOFIA_TZ)).toBe(SOFIA_1025_1800);
    // 02:00–06:00 spans it: four hours of wall clock, five of real time.
    const start = utcOf('2026-10-25', 2 * 60, SOFIA_TZ);
    const end = utcOf('2026-10-25', 6 * 60, SOFIA_TZ);
    expect(end - start).toBe(5 * HOUR);
  });

  it('refuses a window that starts inside the erased hour; one from the switch stays monotone', () => {
    expect(
      ZonedTimeSystem.toUtc(
        localDate('2026-03-29'),
        minute(3 * 60 + 30),
        SOFIA_TZ,
      ).ok,
    ).toBe(false);
    const start = utcOf('2026-03-29', 4 * 60, SOFIA_TZ);
    const end = utcOf('2026-03-29', 4 * 60 + 15, SOFIA_TZ);
    expect(start).toBe(SOFIA_SPRING_SWITCH);
    expect(end - start).toBe(15 * MIN);
  });
});

describe('toLocal — the shop day of an instant, read on the zone clock', () => {
  it('names the switch day of an instant on the switch', () => {
    expect(
      ZonedTimeSystem.toLocal(at(SOFIA_SPRING_SWITCH), SOFIA_TZ).localDate,
    ).toBe('2026-03-29');
  });

  it('reads the day on the zone clock: 22:13 UTC on the 28th is already the 29th in Sofia', () => {
    expect(
      ZonedTimeSystem.toLocal(at(SOFIA_0329_START + 13 * MIN), SOFIA_TZ),
    ).toEqual({ localDate: '2026-03-29', minute: 13 });
  });

  it('reads both ends of an interval crossing the autumn switch', () => {
    expect(
      ZonedTimeSystem.toLocal(at(SOFIA_1025_START - HOUR), SOFIA_TZ),
    ).toEqual({
      localDate: '2026-10-24',
      minute: 23 * 60,
    });
    expect(
      ZonedTimeSystem.toLocal(at(SOFIA_1026_START + HOUR), SOFIA_TZ),
    ).toEqual({
      localDate: '2026-10-26',
      minute: 60,
    });
  });

  it('a zone it does not know is a defect, and a non-instant never becomes a UtcEpochMs', () => {
    expect(() =>
      ZonedTimeSystem.toLocal(at(SOFIA_0729_0930), 'Not/AZone' as TimeZone),
    ).toThrow(/defect/);
    expect(UtcEpochMs.of(Number.NaN).ok).toBe(false);
    expect(UtcEpochMs.of(Number.POSITIVE_INFINITY).ok).toBe(false);
  });

  it('reads instants at both ends of the readable years in one step each', () => {
    expect(
      ZonedTimeSystem.toLocal(at(-62_135_000_000_000), SOFIA_TZ).localDate,
    ).toBe('0001-01-07');
    expect(
      ZonedTimeSystem.toLocal(at(253_402_000_000_000), SOFIA_TZ).localDate,
    ).toBe('9999-12-28');
  });
});

describe('one shop day on the zone clock', () => {
  it('toLocal / startOfLocalDay read the day and its edges', () => {
    expect(
      ZonedTimeSystem.toLocal(at(SOFIA_0729_0930), SOFIA_TZ).localDate,
    ).toBe('2026-07-29');
    // Local midnight, not UTC midnight: 23:45 on the 29th still belongs to the 29th.
    expect(
      ZonedTimeSystem.toLocal(
        at(SOFIA_0729_START + 23 * HOUR + 45 * MIN),
        SOFIA_TZ,
      ).localDate,
    ).toBe('2026-07-29');
    expect(
      ZonedTimeSystem.startOfLocalDay(localDate('2026-07-29'), SOFIA_TZ),
    ).toBe(SOFIA_0729_START);
    expect(
      ZonedTimeSystem.startOfLocalDay(localDate('2026-07-30'), SOFIA_TZ),
    ).toBe(SOFIA_0729_START + 24 * HOUR);
  });

  it('places a roster window on a specific date (atTime)', () => {
    expect(utcOf('2026-07-29', 9 * 60 + 30, SOFIA_TZ)).toBe(SOFIA_0729_0930);
  });
});

describe('toUtc — DST is decided once, locked (gap refused, repeat → the earlier offset)', () => {
  it('builds an ordinary wall-clock time', () => {
    expect(utcOf('2026-07-29', 9 * 60 + 30, SOFIA_TZ)).toBe(SOFIA_0729_0930);
  });

  it('REFUSES a time the spring-forward erased, naming the shop day, minute and zone', () => {
    expect(
      errorOf(
        ZonedTimeSystem.toUtc(
          localDate('2026-03-29'),
          minute(3 * 60 + 30),
          SOFIA_TZ,
        ),
      ),
    ).toEqual({
      errorCode: TimeErrorCode.DstGap,
      localDate: '2026-03-29',
      minute: 210,
      timeZone: SOFIA,
    });
  });

  it('never shifts an erased time: 04:30 +03:00 is reached only by asking for 04:30', () => {
    expect(utcOf('2026-03-29', 270, SOFIA_TZ)).toBe(SOFIA_0329_0430);
  });

  it('resolves a time the fall-back repeated to the EARLIER offset, never refusing it', () => {
    expect(utcOf('2026-10-25', 210, SOFIA_TZ)).toBe(SOFIA_1025_0330_FIRST);
  });

  it('the later occurrence is the same wall time an hour on', () => {
    const earlier = utcOf('2026-10-25', 210, SOFIA_TZ);
    expect(earlier + HOUR).toBe(SOFIA_1025_0330_SECOND);
    expect(ZonedTimeSystem.toLocal(at(earlier + HOUR), SOFIA_TZ)).toEqual(
      ZonedTimeSystem.toLocal(at(earlier), SOFIA_TZ),
    );
  });

  it('refuses an unknown zone and impossible parts', () => {
    expect(
      errorOf(
        ZonedTimeSystem.toUtc(
          localDate('2026-07-29'),
          minute(540),
          'Not/AZone' as TimeZone,
        ),
      ),
    ).toEqual({
      errorCode: TimeErrorCode.InvalidTimeZone,
      rawZone: 'Not/AZone',
    });
    // An impossible day never becomes a LocalDate …
    expect(LocalDate.parse('2026-02-30').ok).toBe(false);
    // … and a minute outside [0, 1440) that slipped past its brand is refused.
    for (const [wall, rawValue] of [
      [1440, '2026-07-29T24:00'],
      [9.5, '2026-07-29T00:09.5'],
    ] as const) {
      expect(
        errorOf(
          ZonedTimeSystem.toUtc(
            localDate('2026-07-29'),
            wall as MinuteOfDay,
            SOFIA_TZ,
          ),
        ),
      ).toEqual({
        errorCode: TimeErrorCode.InvalidDateTime,
        rawValue,
        dateTimeInvalidReason: DateTimeInvalidReason.OutOfRange,
      });
    }
    expect(
      ZonedTimeSystem.toUtc(
        localDate('2026-07-29'),
        -1 as MinuteOfDay,
        SOFIA_TZ,
      ).ok,
    ).toBe(false);
  });

  it('round-trips through the instant', () => {
    const wall = ZonedTimeSystem.toLocal(at(SOFIA_0729_0930), SOFIA_TZ);
    expect(
      valueOf(ZonedTimeSystem.toUtc(wall.localDate, wall.minute, SOFIA_TZ)),
    ).toBe(SOFIA_0729_0930);
  });
});

describe('reading ISO strings — an offset names an instant, a wall clock needs the zone', () => {
  it('a local wall clock goes through toUtc with the location zone', () => {
    expect(utcOf('2026-08-01', 9 * 60, SOFIA_TZ)).toBe(SOFIA_0801_0900);
    // A date alone means its local midnight.
    expect(
      ZonedTimeSystem.startOfLocalDay(localDate('2026-07-29'), SOFIA_TZ),
    ).toBe(SOFIA_0729_START);
    // One fraction digit is tenths.
    expect(
      valueOf(ZonedTimeSystem.parseOffsetIso('2026-08-01T09:00:00.5+03:00')),
    ).toBe(SOFIA_0801_0900 + 500);
  });

  it('reads an explicit offset as the instant it names, whatever the zone', () => {
    for (const raw of [
      '2026-08-01T06:00:00Z',
      '2026-08-01T11:30+0530',
      '2026-08-01T03:00:00-03:00',
    ]) {
      expect(valueOf(ZonedTimeSystem.parseOffsetIso(raw))).toBe(
        SOFIA_0801_0900,
      );
    }
  });

  it('compares by INSTANT, not by the offset the local rendering carries', () => {
    // '…+03:00' sorts after '…+02:00' as a STRING while being the earlier
    // instant — the autumn fall-back hour inverted ordering in the old code.
    const earlier = valueOf(
      ZonedTimeSystem.parseOffsetIso('2026-10-25T03:30:00+03:00'),
    );
    const later = valueOf(
      ZonedTimeSystem.parseOffsetIso('2026-10-25T03:30:00+02:00'),
    );
    expect(earlier).toBe(SOFIA_1025_0330_FIRST);
    expect(later).toBe(SOFIA_1025_0330_SECOND);
    expect(UtcEpochMs.compare(earlier, later)).toBe(-1);
  });

  it('measures elapsed time across a DST boundary, not clock difference', () => {
    // 01:30 → 04:30 reads as three hours on the wall but only two pass.
    const before = utcOf('2026-03-29', 90, SOFIA_TZ);
    const after = utcOf('2026-03-29', 270, SOFIA_TZ);
    expect(before).toBe(SOFIA_0329_0130);
    expect((after - before) / MIN).toBe(120);
  });

  it('applies the same locked DST decision to a local wall clock', () => {
    expect(
      errorOf(
        ZonedTimeSystem.toUtc(localDate('2026-03-29'), minute(210), SOFIA_TZ),
      ).errorCode,
    ).toBe(TimeErrorCode.DstGap);
    expect(utcOf('2026-10-25', 210, SOFIA_TZ)).toBe(SOFIA_1025_0330_FIRST);
  });

  it.each([
    'not-a-date',
    '2026-8-01T09:00Z',
    '2026-08-01 09:00Z',
    '2026-08-01T9:00Z',
    '2026-08-01T09Z',
    '2026-08-01T09:0xZ',
    '2026-08-01T09:00:0Z',
    '2026-08-01T09:00:00.Z',
    '2026-08-01T09:00:00,Z',
    '2026-08-01T09:00:00;5Z',
    '2026-08-01T09:00:00.1234567891Z',
    '2026-08-01T09:00:00.12aZ',
    '2026-08-01T09:00+3',
    '2026-08-01T09:00+031',
    '2026-08-01T09:00+03:0',
    '2026-08-01T09:00+24:00',
    '2026-08-01T09:00+03:60',
  ])('refuses the malformed %j as unparsable', (raw) => {
    expect(errorOf(ZonedTimeSystem.parseOffsetIso(raw))).toEqual({
      errorCode: TimeErrorCode.InvalidDateTime,
      rawValue: raw,
      dateTimeInvalidReason: DateTimeInvalidReason.Unparsable,
    });
  });

  it('refuses an invalid IANA zone at its door', () => {
    expect(errorOf(ZonedTimeSystem.checkZone('Not/AZone')).errorCode).toBe(
      TimeErrorCode.InvalidTimeZone,
    );
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
    expect(valueOf(ZonedTimeSystem.parseOffsetIso(raw))).toBe(epochMs);
  });
});

describe('zones — checkZone, and what an instant reads as', () => {
  it('recognizes a real IANA zone and rejects a bogus one', () => {
    expect(valueOf(ZonedTimeSystem.checkZone(SOFIA))).toBe(SOFIA);
    expect(valueOf(ZonedTimeSystem.checkZone(SOFIA))).toBe(SOFIA); // the cached formatter
    expect(errorOf(ZonedTimeSystem.checkZone('Not/AZone'))).toEqual({
      errorCode: TimeErrorCode.InvalidTimeZone,
      rawZone: 'Not/AZone',
    });
  });

  it('answers the CANONICAL zone id, so a stored zone is one spelling', () => {
    for (const spelling of ['europe/sofia', 'EUROPE/SOFIA', 'eUrope/sofia']) {
      const zone = valueOf(ZonedTimeSystem.checkZone(spelling));
      expect(zone).toBe(SOFIA);
      expect(utcOf('2026-07-29', 9 * 60 + 30, zone)).toBe(SOFIA_0729_0930);
    }
    expect(valueOf(ZonedTimeSystem.checkZone('utc'))).toBe(UTC);
    expect(valueOf(ZonedTimeSystem.checkZone('Etc/UTC'))).toBe(UTC);
  });

  it('refuses an offset id — not every browser engine accepts one', () => {
    for (const offset of ['+03:00', '-0500', '+03']) {
      expect(errorOf(ZonedTimeSystem.checkZone(offset))).toEqual({
        errorCode: TimeErrorCode.InvalidTimeZone,
        rawZone: offset,
      });
    }
  });

  it('exposes the calendar fields in the zone (2026-03-05 14:32:07, a Thursday)', () => {
    const instant = valueOf(
      ZonedTimeSystem.parseOffsetIso('2026-03-05T14:32:07+02:00'),
    );
    expect(ZonedTimeSystem.toLocal(instant, SOFIA_TZ)).toEqual({
      localDate: '2026-03-05',
      minute: 14 * 60 + 32,
    });
    expect(LocalDate.weekday(localDate('2026-03-05'))).toBe(Weekday.Thu);
    expect(offsetIso(instant, SOFIA_TZ)).toBe('2026-03-05T14:32:07.000+02:00');
  });

  it('reads the day on the Sofia clock, not the UTC one (loyalty sofiaDayOf)', () => {
    // 22:30 UTC in summer is 01:30 the next morning in Sofia (UTC+3).
    const dayOf = (ms: number) =>
      ZonedTimeSystem.toLocal(at(ms), SOFIA_TZ).localDate;
    expect(dayOf(1_785_537_000_000)).toBe('2026-08-01'); // 2026-07-31T22:30:00Z
    expect(dayOf(1_785_531_599_000)).toBe('2026-07-31'); // 2026-07-31T20:59:59Z
    // The winter offset too (UTC+2).
    expect(dayOf(1_798_754_399_000)).toBe('2026-12-31'); // 2026-12-31T21:59:59Z
    expect(dayOf(1_798_754_400_000)).toBe('2027-01-01'); // 2026-12-31T22:00:00Z
  });
});

describe('UTC and a non-hour offset (sanity)', () => {
  it('UTC: every day starts at UTC midnight and nothing ever transitions', () => {
    for (const day of LocalDate.range(
      localDate('2026-03-28'),
      localDate('2026-10-26'),
    )) {
      expect(dayLengthMinutes(day, UTC_TZ)).toBe(24 * 60);
    }
    expect(
      ZonedTimeSystem.startOfLocalDay(localDate('2026-07-29'), UTC_TZ),
    ).toBe(UTC_0729_START);
    expect(
      ZonedTimeSystem.toLocal(at(UTC_0729_START + 90 * MIN), UTC_TZ),
    ).toEqual({
      localDate: '2026-07-29',
      minute: 90,
    });
    expect(offsetOf(UTC_0729_START, UTC_TZ)).toBe('+00:00');
  });

  it('Asia/Kolkata: +05:30 shifts the day by half an hour too', () => {
    expect(
      ZonedTimeSystem.startOfLocalDay(localDate('2026-07-30'), KOLKATA_TZ),
    ).toBe(KOLKATA_0730_START);
    expect(dayLengthMinutes('2026-07-30', KOLKATA_TZ)).toBe(24 * 60);
    expect(LocalDate.weekday(localDate('2026-07-30'))).toBe(Weekday.Thu);
    expect(utcOf('2026-07-30', 9 * 60 + 15, KOLKATA_TZ)).toBe(
      KOLKATA_0730_0915,
    );
    expect(
      ZonedTimeSystem.toLocal(at(KOLKATA_0730_0915), KOLKATA_TZ).minute,
    ).toBe(555);
    expect(offsetOf(KOLKATA_0730_0915, KOLKATA_TZ)).toBe('+05:30');
  });
});

describe('a zone that moves its clocks at midnight (America/Sao_Paulo)', () => {
  it('spring: midnight itself is erased, so the day starts at 01:00 on the new clock', () => {
    expect(
      ZonedTimeSystem.startOfLocalDay(localDate('2018-11-03'), SAO_PAULO_TZ),
    ).toBe(SP_1103_START);
    expect(offsetOf(SP_1103_START, SAO_PAULO_TZ)).toBe('-03:00');
    expect(
      ZonedTimeSystem.startOfLocalDay(localDate('2018-11-04'), SAO_PAULO_TZ),
    ).toBe(SP_SPRING_SWITCH);
    expect(dayLengthMinutes('2018-11-04', SAO_PAULO_TZ)).toBe(23 * 60);
    expect(LocalDate.weekday(localDate('2018-11-04'))).toBe(Weekday.Sun);
    expect(
      ZonedTimeSystem.startOfLocalDay(localDate('2018-11-05'), SAO_PAULO_TZ),
    ).toBe(SP_1105_START);
    for (const wall of [0, 30]) {
      expect(
        errorOf(
          ZonedTimeSystem.toUtc(
            localDate('2018-11-04'),
            minute(wall),
            SAO_PAULO_TZ,
          ),
        ).errorCode,
      ).toBe(TimeErrorCode.DstGap);
    }
    expect(utcOf('2018-11-04', 60, SAO_PAULO_TZ)).toBe(SP_SPRING_SWITCH);
    expect(ZonedTimeSystem.toLocal(at(SP_SPRING_SWITCH), SAO_PAULO_TZ)).toEqual(
      {
        localDate: '2018-11-04',
        minute: 60,
      },
    );
  });

  it('autumn: the 16th runs 25 hours and repeats its own last hour', () => {
    expect(
      ZonedTimeSystem.startOfLocalDay(localDate('2019-02-16'), SAO_PAULO_TZ),
    ).toBe(SP_0216_START);
    expect(offsetOf(SP_0216_START, SAO_PAULO_TZ)).toBe('-02:00');
    expect(dayLengthMinutes('2019-02-16', SAO_PAULO_TZ)).toBe(25 * 60);
    expect(LocalDate.weekday(localDate('2019-02-16'))).toBe(Weekday.Sat);
    expect(
      ZonedTimeSystem.startOfLocalDay(localDate('2019-02-17'), SAO_PAULO_TZ),
    ).toBe(SP_0217_START);
    expect(offsetOf(SP_0217_START, SAO_PAULO_TZ)).toBe('-03:00');
    expect(
      ZonedTimeSystem.startOfLocalDay(localDate('2019-02-18'), SAO_PAULO_TZ),
    ).toBe(SP_0218_START);
    expect(ZonedTimeSystem.toLocal(at(SP_FALL_SWITCH), SAO_PAULO_TZ)).toEqual({
      localDate: '2019-02-16',
      minute: 23 * 60,
    });
    // 23:30 happens twice; ingestion takes the earlier (−02:00) occurrence.
    expect(utcOf('2019-02-16', 23 * 60 + 30, SAO_PAULO_TZ)).toBe(
      SP_FALL_SWITCH - 30 * MIN,
    );
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
  it('Australia/Lord_Howe: a 30-minute overlap in April resolves to the earlier offset', () => {
    expect(
      ZonedTimeSystem.startOfLocalDay(localDate('2026-04-05'), LORD_HOWE_TZ),
    ).toBe(LH_0405_START);
    expect(offsetOf(LH_0405_START, LORD_HOWE_TZ)).toBe('+11:00');
    expect(dayLengthMinutes('2026-04-05', LORD_HOWE_TZ)).toBe(1470);
    expect(utcOf('2026-04-05', 105, LORD_HOWE_TZ)).toBe(LH_0405_0145_FIRST);
    expect(
      ZonedTimeSystem.toLocal(at(LH_0405_0145_FIRST), LORD_HOWE_TZ).minute,
    ).toBe(105);
    expect(
      ZonedTimeSystem.toLocal(at(LH_0405_0145_SECOND), LORD_HOWE_TZ).minute,
    ).toBe(105);
    expect(offsetOf(LH_0405_0145_SECOND, LORD_HOWE_TZ)).toBe('+10:30');
  });

  it('Australia/Lord_Howe: a 30-minute gap in October is refused', () => {
    expect(
      ZonedTimeSystem.startOfLocalDay(localDate('2026-10-04'), LORD_HOWE_TZ),
    ).toBe(LH_1004_START);
    expect(offsetOf(LH_1004_START, LORD_HOWE_TZ)).toBe('+10:30');
    expect(dayLengthMinutes('2026-10-04', LORD_HOWE_TZ)).toBe(1410);
    expect(
      errorOf(
        ZonedTimeSystem.toUtc(
          localDate('2026-10-04'),
          minute(135),
          LORD_HOWE_TZ,
        ),
      ).errorCode,
    ).toBe(TimeErrorCode.DstGap);
    // 02:45 exists on the new clock; 01:45 exists before the gap.
    expect(utcOf('2026-10-04', 165, LORD_HOWE_TZ)).toBe(LH_1004_0215_SHIFTED);
    expect(utcOf('2026-10-04', 105, LORD_HOWE_TZ)).toBe(
      LH_1004_START + 105 * MIN,
    );
  });

  it('Africa/Cairo: a fall-back AT midnight repeats the last hour, the earlier one is ingested', () => {
    expect(
      ZonedTimeSystem.startOfLocalDay(localDate('2026-10-29'), CAIRO_TZ),
    ).toBe(CAIRO_1029_START);
    expect(
      ZonedTimeSystem.startOfLocalDay(localDate('2026-10-30'), CAIRO_TZ),
    ).toBe(CAIRO_1030_START);
    expect(dayLengthMinutes('2026-10-29', CAIRO_TZ)).toBe(25 * 60);
    expect(LocalDate.weekday(localDate('2026-10-29'))).toBe(Weekday.Thu);
    // Every wall minute of [23:00, 24:00) happens twice — the first is taken …
    for (const wall of [1380, 1410, 1439]) {
      expect(utcOf('2026-10-29', wall, CAIRO_TZ)).toBe(
        CAIRO_1029_START + wall * MIN,
      );
    }
    // … and 22:59 happens once.
    expect(utcOf('2026-10-29', 1379, CAIRO_TZ)).toBe(
      CAIRO_1029_START + 1379 * MIN,
    );
    expect(utcOf('2026-10-29', 1410, CAIRO_TZ)).toBe(CAIRO_1029_2330_FIRST);
    expect(
      ZonedTimeSystem.toLocal(at(CAIRO_FALL_SWITCH), CAIRO_TZ).minute,
    ).toBe(1380);
    expect(
      ZonedTimeSystem.toLocal(at(CAIRO_1029_2330_SECOND), CAIRO_TZ),
    ).toEqual({
      localDate: '2026-10-29',
      minute: 1410,
    });
  });

  it('America/Scoresbysund: a repeated MIDNIGHT — the day starts at the first one', () => {
    expect(
      ZonedTimeSystem.startOfLocalDay(localDate('2018-10-28'), SCORESBYSUND_TZ),
    ).toBe(SCORESBY_1028_FIRST_MIDNIGHT);
    expect(
      ZonedTimeSystem.startOfLocalDay(localDate('2018-10-29'), SCORESBYSUND_TZ),
    ).toBe(SCORESBY_1029_START);
    expect(
      ZonedTimeSystem.toLocal(
        at(SCORESBY_1028_SECOND_MIDNIGHT),
        SCORESBYSUND_TZ,
      ),
    ).toEqual({ localDate: '2018-10-28', minute: 0 });
    expect(
      ZonedTimeSystem.toLocal(
        at(SCORESBY_1028_FIRST_MIDNIGHT - 1),
        SCORESBYSUND_TZ,
      ),
    ).toEqual({ localDate: '2018-10-27', minute: 1439 });
  });
});

/* ══ The ingestion API (flatten-spec §2.1) ═══════════════════════════════ */

describe('ZonedTimeSystem.checkZone — the TimeZone smart constructor (F-2)', () => {
  it('answers the canonical IANA id as a TimeZone', () => {
    expect(SOFIA_TZ).toBe('Europe/Sofia');
    expect(unwrapOk(ZonedTimeSystem.checkZone('europe/sofia'))).toBe(SOFIA);
    expect(unwrapOk(ZonedTimeSystem.checkZone('Etc/UTC'))).toBe(UTC);
  });

  it('refuses an unknown zone and an offset id as TIME_INVALID_TIME_ZONE', () => {
    for (const raw of ['Not/AZone', '+03:00', '']) {
      expect(errorOf(ZonedTimeSystem.checkZone(raw))).toEqual({
        errorCode: 'TIME_INVALID_TIME_ZONE',
        rawZone: raw,
      });
    }
  });
});

describe('ZonedTimeSystem.toUtc — the DST set, locked 2026-10-10', () => {
  it('Europe/Sofia 2026-03-29: a time inside the spring-forward gap is DST_GAP_INVALID_TIME', () => {
    for (const wall of [180, 210, 239]) {
      expect(
        errorOf(
          ZonedTimeSystem.toUtc(
            localDate('2026-03-29'),
            minute(wall),
            SOFIA_TZ,
          ),
        ),
      ).toEqual({
        errorCode: TimeErrorCode.DstGap,
        localDate: '2026-03-29',
        minute: wall,
        timeZone: SOFIA,
      });
    }
    expect(TimeErrorCode.DstGap).toBe('DST_GAP_INVALID_TIME');
  });

  it('Europe/Sofia 2026-03-29: the minutes either side of the gap resolve exactly', () => {
    const day = localDate('2026-03-29');
    expect(valueOf(ZonedTimeSystem.toUtc(day, minute(179), SOFIA_TZ))).toBe(
      SOFIA_0329_0259,
    );
    expect(valueOf(ZonedTimeSystem.toUtc(day, minute(240), SOFIA_TZ))).toBe(
      SOFIA_SPRING_SWITCH,
    );
    expect(valueOf(ZonedTimeSystem.toUtc(day, minute(270), SOFIA_TZ))).toBe(
      SOFIA_0329_0430,
    );
    expect(valueOf(ZonedTimeSystem.toUtc(day, minute(0), SOFIA_TZ))).toBe(
      SOFIA_0329_START,
    );
  });

  it('Europe/Sofia 2026-10-25: a repeated time resolves to the EARLIER offset (+03:00)', () => {
    const day = localDate('2026-10-25');
    expect(valueOf(ZonedTimeSystem.toUtc(day, minute(210), SOFIA_TZ))).toBe(
      SOFIA_1025_0330_FIRST,
    );
    expect(SOFIA_1025_0330_FIRST).toBeLessThan(SOFIA_1025_0330_SECOND);
    expect(
      offsetIso(
        valueOf(ZonedTimeSystem.toUtc(day, minute(210), SOFIA_TZ)),
        SOFIA_TZ,
      ),
    ).toBe('2026-10-25T03:30:00.000+03:00');
    // 03:00 itself is repeated too; 04:00 happens once, on the new clock.
    expect(valueOf(ZonedTimeSystem.toUtc(day, minute(180), SOFIA_TZ))).toBe(
      SOFIA_FALL_SWITCH - HOUR,
    );
    expect(valueOf(ZonedTimeSystem.toUtc(day, minute(540), SOFIA_TZ))).toBe(
      SOFIA_1025_0900,
    );
  });

  it('every minute of both Sofia DST days: the gap refused, the rest the earliest instant that reads it', () => {
    const refused: string[] = [];
    for (const raw of ['2026-03-29', '2026-10-25']) {
      const day = localDate(raw);
      for (let wall = 0; wall < 1440; wall++) {
        const fresh = ZonedTimeSystem.toUtc(day, minute(wall), SOFIA_TZ);
        if (!fresh.ok) {
          refused.push(`${raw} ${wall}`);
          continue;
        }
        expect(ZonedTimeSystem.toLocal(fresh.value, SOFIA_TZ)).toEqual({
          localDate: raw,
          minute: wall,
        });
        // The earliest: an hour before never reads the same wall minute.
        expect(
          ZonedTimeSystem.toLocal(at(fresh.value - HOUR), SOFIA_TZ),
        ).not.toEqual({ localDate: raw, minute: wall });
      }
    }
    expect(refused).toEqual(
      Array.from({ length: 60 }, (_, i) => `2026-03-29 ${180 + i}`),
    );
  });

  it('UTC: no gap and no repeat — every minute is exact', () => {
    expect(
      valueOf(
        ZonedTimeSystem.toUtc(localDate('2026-07-29'), minute(0), UTC_TZ),
      ),
    ).toBe(UTC_0729_START);
    expect(
      valueOf(
        ZonedTimeSystem.toUtc(localDate('2026-03-29'), minute(210), UTC_TZ),
      ),
    ).toBe(utcMs('2026-03-29T03:30:00Z'));
  });

  it('Asia/Kolkata: a half-hour offset (+05:30), no DST', () => {
    expect(
      valueOf(
        ZonedTimeSystem.toUtc(localDate('2026-07-30'), minute(0), KOLKATA_TZ),
      ),
    ).toBe(KOLKATA_0730_START);
    expect(
      valueOf(
        ZonedTimeSystem.toUtc(
          localDate('2026-07-30'),
          minute(9 * 60 + 15),
          KOLKATA_TZ,
        ),
      ),
    ).toBe(KOLKATA_0730_0915);
  });

  it('America/Sao_Paulo 2018-11-04: midnight itself is in the gap', () => {
    expect(
      errorOf(
        ZonedTimeSystem.toUtc(localDate('2018-11-04'), minute(0), SAO_PAULO_TZ),
      ).errorCode,
    ).toBe('DST_GAP_INVALID_TIME');
    expect(
      valueOf(
        ZonedTimeSystem.toUtc(
          localDate('2018-11-04'),
          minute(60),
          SAO_PAULO_TZ,
        ),
      ),
    ).toBe(SP_SPRING_SWITCH);
  });

  it('Australia/Lord_Howe: a 30-minute gap is refused, a 30-minute repeat takes the earlier offset', () => {
    expect(
      errorOf(
        ZonedTimeSystem.toUtc(
          localDate('2026-10-04'),
          minute(2 * 60 + 15),
          LORD_HOWE_TZ,
        ),
      ).errorCode,
    ).toBe(TimeErrorCode.DstGap);
    const repeated = valueOf(
      ZonedTimeSystem.toUtc(
        localDate('2026-04-05'),
        minute(60 + 45),
        LORD_HOWE_TZ,
      ),
    );
    expect(offsetIso(repeated, LORD_HOWE_TZ)).toBe(
      '2026-04-05T01:45:00.000+11:00',
    );
  });

  it('refuses an unknown zone and a day outside the readable window', () => {
    expect(
      errorOf(
        ZonedTimeSystem.toUtc(
          localDate('2026-07-29'),
          minute(0),
          'Not/AZone' as typeof SOFIA_TZ,
        ),
      ),
    ).toEqual({ errorCode: 'TIME_INVALID_TIME_ZONE', rawZone: 'Not/AZone' });
    expect(
      errorOf(
        ZonedTimeSystem.toUtc(localDate('0000-06-01'), minute(0), UTC_TZ),
      ),
    ).toEqual({
      errorCode: TimeErrorCode.InvalidDateTime,
      rawValue: '0000-06-01T00:00',
      dateTimeInvalidReason: DateTimeInvalidReason.OutOfRange,
    });
  });
});

describe('ZonedTimeSystem.toLocal / shopNow — the instant on the shop wall clock', () => {
  it('reads the Sofia clock, not the UTC one (22:30Z in summer is 01:30 the next day)', () => {
    expect(
      ZonedTimeSystem.toLocal(utcMs('2026-07-28T22:30:00Z'), SOFIA_TZ),
    ).toEqual({ localDate: '2026-07-29', minute: 90 });
  });

  it('is total across both Sofia transitions', () => {
    expect(ZonedTimeSystem.toLocal(at(SOFIA_0329_0259), SOFIA_TZ)).toEqual({
      localDate: '2026-03-29',
      minute: 179,
    });
    expect(ZonedTimeSystem.toLocal(at(SOFIA_SPRING_SWITCH), SOFIA_TZ)).toEqual({
      localDate: '2026-03-29',
      minute: 240,
    });
    expect(
      ZonedTimeSystem.toLocal(at(SOFIA_1025_0330_FIRST), SOFIA_TZ),
    ).toEqual({ localDate: '2026-10-25', minute: 210 });
    expect(
      ZonedTimeSystem.toLocal(at(SOFIA_1025_0330_SECOND), SOFIA_TZ),
    ).toEqual({ localDate: '2026-10-25', minute: 210 });
  });

  it('UTC and Asia/Kolkata', () => {
    expect(ZonedTimeSystem.toLocal(at(UTC_0729_START), UTC_TZ)).toEqual({
      localDate: '2026-07-29',
      minute: 0,
    });
    expect(ZonedTimeSystem.toLocal(at(KOLKATA_0730_0915), KOLKATA_TZ)).toEqual({
      localDate: '2026-07-30',
      minute: 555,
    });
  });

  it('round-trips toUtc for every minute of an ordinary day', () => {
    for (let wall = 0; wall < 1440; wall += 7) {
      const instant = valueOf(
        ZonedTimeSystem.toUtc(localDate('2026-07-29'), minute(wall), SOFIA_TZ),
      );
      expect(ZonedTimeSystem.toLocal(instant, SOFIA_TZ)).toEqual({
        localDate: '2026-07-29',
        minute: wall,
      });
    }
  });

  it('shopNow derives the shop-local now once: localDate + currentMinute + the same instant', () => {
    const now = utcMs('2026-09-28T09:00:00+03:00');
    expect(ZonedTimeSystem.shopNow(now, SOFIA_TZ)).toEqual({
      localDate: '2026-09-28',
      currentMinute: 540,
      utcEpochMs: now,
    });
    expect(ZonedTimeSystem.shopNow(now, KOLKATA_TZ)).toEqual({
      localDate: '2026-09-28',
      currentMinute: 690,
      utcEpochMs: now,
    });
  });
});

describe('ZonedTimeSystem.startOfLocalDay — the first instant of a shop day', () => {
  it('is local midnight on ordinary and DST days alike', () => {
    expect(
      ZonedTimeSystem.startOfLocalDay(localDate('2026-03-29'), SOFIA_TZ),
    ).toBe(SOFIA_0329_START);
    expect(
      ZonedTimeSystem.startOfLocalDay(localDate('2026-03-30'), SOFIA_TZ),
    ).toBe(SOFIA_0330_START);
    expect(
      ZonedTimeSystem.startOfLocalDay(localDate('2026-10-25'), SOFIA_TZ),
    ).toBe(SOFIA_1025_START);
    expect(
      ZonedTimeSystem.startOfLocalDay(localDate('2026-07-29'), UTC_TZ),
    ).toBe(UTC_0729_START);
    expect(
      ZonedTimeSystem.startOfLocalDay(localDate('2026-07-30'), KOLKATA_TZ),
    ).toBe(KOLKATA_0730_START);
  });

  it('a midnight inside a gap resolves to the gap’s end (America/Sao_Paulo 2018-11-04)', () => {
    expect(
      ZonedTimeSystem.startOfLocalDay(localDate('2018-11-04'), SAO_PAULO_TZ),
    ).toBe(SP_SPRING_SWITCH);
    expect(
      ZonedTimeSystem.startOfLocalDay(localDate('2018-11-05'), SAO_PAULO_TZ),
    ).toBe(SP_1105_START);
  });

  it('a repeated midnight takes its first occurrence (America/Sao_Paulo 2019-02-16)', () => {
    expect(
      ZonedTimeSystem.startOfLocalDay(localDate('2019-02-16'), SAO_PAULO_TZ),
    ).toBe(SP_0216_START);
    expect(
      ZonedTimeSystem.startOfLocalDay(localDate('2019-02-17'), SAO_PAULO_TZ),
    ).toBe(SP_0217_START);
  });

  it('on a month of Sofia days: midnight exists, reads back as minute 0, and follows the last minute of the day before', () => {
    for (const day of LocalDate.range(
      localDate('2026-03-15'),
      localDate('2026-04-15'),
    )) {
      const start = ZonedTimeSystem.startOfLocalDay(day, SOFIA_TZ);
      expect(start).toBe(utcOf(day, 0, SOFIA_TZ));
      expect(ZonedTimeSystem.toLocal(start, SOFIA_TZ)).toEqual({
        localDate: day,
        minute: 0,
      });
      expect(ZonedTimeSystem.toLocal(at(start - 1), SOFIA_TZ)).toEqual({
        localDate: LocalDate.addDays(day, -1),
        minute: 1439,
      });
    }
  });
});

describe('ZonedTimeSystem.parseOffsetIso — an instant that names its offset', () => {
  it('reads every offset form the legacy reader read', () => {
    expect(
      valueOf(ZonedTimeSystem.parseOffsetIso('2026-08-01T09:00:00+03:00')),
    ).toBe(SOFIA_0801_0900);
    expect(
      valueOf(ZonedTimeSystem.parseOffsetIso('2026-08-01T06:00:00Z')),
    ).toBe(SOFIA_0801_0900);
    expect(
      valueOf(ZonedTimeSystem.parseOffsetIso('2026-08-01T09:00+0300')),
    ).toBe(SOFIA_0801_0900);
    expect(valueOf(ZonedTimeSystem.parseOffsetIso('2026-08-01T09:00+03'))).toBe(
      SOFIA_0801_0900,
    );
    expect(
      valueOf(
        ZonedTimeSystem.parseOffsetIso('2026-08-01T09:00:00.123456+03:00'),
      ),
    ).toBe(SOFIA_0801_0900 + 123);
    expect(
      valueOf(ZonedTimeSystem.parseOffsetIso('2026-10-25T03:30:00.000+02:00')),
    ).toBe(SOFIA_1025_0330_SECOND);
  });

  it('refuses a string with no offset — a wall clock goes through toUtc with the location zone', () => {
    for (const raw of ['2026-08-01T09:00:00', '2026-08-01', 'not-a-date']) {
      expect(errorOf(ZonedTimeSystem.parseOffsetIso(raw))).toEqual({
        errorCode: 'TIME_INVALID_DATE_TIME',
        rawValue: raw,
        dateTimeInvalidReason: 'UNPARSABLE',
      });
    }
  });

  it('refuses an impossible date or clock time as OUT_OF_RANGE', () => {
    for (const raw of [
      '2026-02-30T09:00Z',
      '2026-08-01T24:00Z',
      '2026-08-01T09:60Z',
      '2026-08-01T09:00:60Z',
      '0000-01-01T00:00Z',
    ]) {
      expect(errorOf(ZonedTimeSystem.parseOffsetIso(raw))).toEqual({
        errorCode: TimeErrorCode.InvalidDateTime,
        rawValue: raw,
        dateTimeInvalidReason: DateTimeInvalidReason.OutOfRange,
      });
    }
  });
});

describe('ZonedTimeSystem.parseIsoIn — a wire start, on the shop’s terms', () => {
  it('reads a string WITH an offset as the instant it names, whatever the zone', () => {
    expect(
      valueOf(ZonedTimeSystem.parseIsoIn('2026-08-01T09:00:00+03:00', UTC_TZ)),
    ).toBe(SOFIA_0801_0900);
    expect(
      valueOf(
        ZonedTimeSystem.parseIsoIn('2026-10-25T03:30:00.000+02:00', SOFIA_TZ),
      ),
    ).toBe(SOFIA_1025_0330_SECOND);
  });

  it('reads a bare wall clock on the zone’s clock — seconds and milliseconds kept, a date alone its midnight', () => {
    expect(
      valueOf(ZonedTimeSystem.parseIsoIn('2026-08-01T09:00', SOFIA_TZ)),
    ).toBe(SOFIA_0801_0900);
    expect(
      valueOf(ZonedTimeSystem.parseIsoIn('2026-08-01T09:00:07.250', SOFIA_TZ)),
    ).toBe(SOFIA_0801_0900 + 7_250);
    expect(valueOf(ZonedTimeSystem.parseIsoIn('2026-03-29', SOFIA_TZ))).toBe(
      SOFIA_0329_START,
    );
  });

  it('refuses a wall clock inside the spring-forward gap, and resolves a repeat to the EARLIER offset (Law 7.3)', () => {
    expect(
      errorOf(ZonedTimeSystem.parseIsoIn('2026-03-29T03:30:00', SOFIA_TZ)),
    ).toEqual({
      errorCode: 'DST_GAP_INVALID_TIME',
      localDate: '2026-03-29',
      minute: 210,
      timeZone: SOFIA_TZ,
    });
    expect(
      valueOf(ZonedTimeSystem.parseIsoIn('2026-10-25T03:30', SOFIA_TZ)),
    ).toBe(SOFIA_1025_0330_FIRST);
  });

  it('refuses what is no date-time at all, or no real one', () => {
    expect(errorOf(ZonedTimeSystem.parseIsoIn('not-a-date', SOFIA_TZ))).toEqual(
      {
        errorCode: TimeErrorCode.InvalidDateTime,
        rawValue: 'not-a-date',
        dateTimeInvalidReason: DateTimeInvalidReason.Unparsable,
      },
    );
    for (const raw of [
      '2026-02-30T09:00',
      '2026-08-01T24:00',
      '2026-08-01T09:60',
      '2026-08-01T09:00:60',
    ]) {
      expect(errorOf(ZonedTimeSystem.parseIsoIn(raw, SOFIA_TZ))).toEqual({
        errorCode: TimeErrorCode.InvalidDateTime,
        rawValue: raw,
        dateTimeInvalidReason: DateTimeInvalidReason.OutOfRange,
      });
    }
  });
});

describe('ZonedTimeSystem.frameShopDay — the envelope’s instant of one shop day (P-17)', () => {
  // book-appointment.pipeline.spec.ts `frameWallClock` and the reschedule's
  // frame, restated on branded input (the pipeline parses, the system places).
  it('answers the instant of the EARLIEST start, whatever the order', () => {
    expect(
      ZonedTimeSystem.frameShopDay(
        localDate('2026-07-29'),
        [minute(630), minute(570), null, minute(600)],
        SOFIA_TZ,
      ),
    ).toEqual({ ok: true, value: SOFIA_0729_0930 });
    // Equal starts: the first wins — the same instant either way.
    expect(
      valueOf(
        ZonedTimeSystem.frameShopDay(
          localDate('2026-07-29'),
          [minute(570), minute(570)],
          SOFIA_TZ,
        ),
      ),
    ).toBe(SOFIA_0729_0930);
  });

  it('refuses a start inside the spring-forward gap DST_GAP_INVALID_TIME — never shifted', () => {
    expect(
      errorOf(
        ZonedTimeSystem.frameShopDay(
          localDate('2026-03-29'),
          [minute(540), minute(210)],
          SOFIA_TZ,
        ),
      ),
    ).toEqual({
      errorCode: TimeErrorCode.DstGap,
      localDate: '2026-03-29',
      minute: 210,
      timeZone: SOFIA_TZ,
    });
  });

  it('refuses the FIRST gap start in the order given, even when a later one is earlier', () => {
    expect(
      errorOf(
        ZonedTimeSystem.frameShopDay(
          localDate('2026-03-29'),
          [minute(220), minute(190)],
          SOFIA_TZ,
        ),
      ),
    ).toMatchObject({ errorCode: TimeErrorCode.DstGap, minute: 220 });
  });

  it('reads a fall-back repeat on the EARLIER offset', () => {
    expect(
      valueOf(
        ZonedTimeSystem.frameShopDay(
          localDate('2026-10-25'),
          [minute(210)],
          SOFIA_TZ,
        ),
      ),
    ).toBe(SOFIA_1025_0330_FIRST);
  });

  it('places nothing and refuses nothing for a day that is no day', () => {
    // 03:30 on the spring-forward day would be a gap — but with no day
    // nothing is placed.
    expect(
      ZonedTimeSystem.frameShopDay(null, [minute(210), null], SOFIA_TZ),
    ).toEqual({ ok: true, value: null });
  });

  it('skips the null slots, and answers null when no start is left', () => {
    expect(
      valueOf(
        ZonedTimeSystem.frameShopDay(
          localDate('2026-07-29'),
          [null, minute(570), null],
          SOFIA_TZ,
        ),
      ),
    ).toBe(SOFIA_0729_0930);
    expect(
      ZonedTimeSystem.frameShopDay(localDate('2026-07-29'), [null], SOFIA_TZ),
    ).toEqual({ ok: true, value: null });
    expect(
      ZonedTimeSystem.frameShopDay(localDate('2026-07-29'), [], SOFIA_TZ),
    ).toEqual({ ok: true, value: null });
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const starts = deepFreeze([minute(630), minute(570), null]);
    const once = ZonedTimeSystem.frameShopDay(
      localDate('2026-07-29'),
      starts,
      SOFIA_TZ,
    );
    expect(
      ZonedTimeSystem.frameShopDay(localDate('2026-07-29'), starts, SOFIA_TZ),
    ).toEqual(once);
    expect(starts).toEqual([630, 570, null]);
  });
});

describe('ZonedTimeSystem ingestion API purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const day = deepFreeze(localDate('2026-10-25'));
    const run = () => ({
      utc: ZonedTimeSystem.toUtc(day, minute(210), SOFIA_TZ),
      gap: ZonedTimeSystem.toUtc(
        localDate('2026-03-29'),
        minute(210),
        SOFIA_TZ,
      ),
      local: ZonedTimeSystem.toLocal(at(SOFIA_SPRING_SWITCH), SOFIA_TZ),
      now: ZonedTimeSystem.shopNow(at(SOFIA_0801_0900), SOFIA_TZ),
      start: ZonedTimeSystem.startOfLocalDay(day, SOFIA_TZ),
      parsed: ZonedTimeSystem.parseOffsetIso('2026-08-01T09:00:00+03:00'),
    });
    expect(run()).toEqual(run());
  });
});
