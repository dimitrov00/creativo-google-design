import { describe, expect, it } from 'vitest';
import {
  BarberId,
  Currency,
  LocationId,
  MinuteCount,
  PriceCents,
  ServiceId,
} from '@core/primitives';
import { deepFreeze, localDate, minuteCount, utcMs } from '@core/testing';
import { ANALYTICS_DEFINITION_VERSION } from './analytics-report.data';
import { type DayBody, DayFigures, type DayRow } from './day-figures.data';

/*
 * The per-day family (staff analytics v2, «The day document»): the empty
 * day, the read-time door and the row projection.
 */

const ivan = BarberId.of('ivan');
const DAY = localDate('2026-09-14');
const AT = utcMs('2026-09-16T02:30:00.000Z');

describe('DayFigures.empty', () => {
  it('is zeros throughout, 24 empty buckets each, no service row, euro, stamped with this definition', () => {
    const empty = DayFigures.empty(ivan, DAY, AT);
    expect(empty.barberId).toBe(ivan);
    expect(empty.localDate).toBe(DAY);
    for (const field of DayFigures.MINUTE_FIELDS) expect(empty[field]).toBe(0);
    for (const field of DayFigures.COUNT_FIELDS) expect(empty[field]).toBe(0);
    expect(empty.dayTakingsCents).toBe(0);
    expect(empty.dayTipsCents).toBe(0);
    expect(empty.currency).toBe(Currency.EUR);
    expect(empty.dayServices).toEqual([]);
    expect(empty.dayHourWorked).toHaveLength(24);
    expect(empty.dayHourRostered).toHaveLength(24);
    expect(empty.dayHourWorked.every((m) => m === 0)).toBe(true);
    expect(empty.dayDefinitionVersion).toBe(ANALYTICS_DEFINITION_VERSION);
    expect(empty.dayComputedAtUtcMs).toBe(AT);
  });

  it('names thirteen minute fields and eleven count fields, every one a field of the empty day', () => {
    expect(DayFigures.MINUTE_FIELDS).toHaveLength(13);
    expect(DayFigures.COUNT_FIELDS).toHaveLength(11);
    const empty = DayFigures.empty(ivan, DAY, AT);
    for (const field of [
      ...DayFigures.MINUTE_FIELDS,
      ...DayFigures.COUNT_FIELDS,
    ]) {
      expect(Object.hasOwn(empty, field), field).toBe(true);
    }
  });
});

describe('DayFigures.is — the read-time door', () => {
  const good = (): Record<string, unknown> => ({
    ...DayFigures.empty(ivan, DAY, AT),
    dayWorkedMinutes: MinuteCount.ZERO + 90,
    dayTakingsCents: 2800 as PriceCents,
    dayServices: [
      {
        serviceId: ServiceId.of('svc-cut'),
        workedSeatCount: 2,
        takingsCents: 2800,
        serviceMinutes: 60,
      },
    ],
  });

  it('admits a well-formed body as it is', () => {
    expect(DayFigures.is(good())).toBe(true);
    expect(DayFigures.is(DayFigures.empty(ivan, DAY, AT))).toBe(true);
  });

  it('refuses what is not a record', () => {
    for (const raw of [null, undefined, 'day', 7, [], true]) {
      expect(DayFigures.is(raw)).toBe(false);
    }
  });

  it('refuses a missing or malformed field, whichever it is', () => {
    const broken: readonly (readonly [string, unknown])[] = [
      ['barberId', ''],
      ['localDate', '2026-9-14'],
      ['dayRosteredMinutes', -1],
      ['dayUnsoldMinutes', 1.5],
      ['dayClosedDayMinutes', undefined],
      ['dayTakingsCents', -100],
      ['dayTipsCents', '300'],
      ['currency', 'eur'],
      ['dayNoShowBase', -1],
      ['dayUnknownOriginVisitCount', 0.5],
      ['dayServices', 'none'],
      ['dayServices', [{ serviceId: 'svc', workedSeatCount: 1 }]],
      [
        'dayServices',
        [
          {
            serviceId: '',
            workedSeatCount: 1,
            takingsCents: 0,
            serviceMinutes: 0,
          },
        ],
      ],
      ['dayHourWorked', []],
      ['dayHourWorked', new Array(23).fill(0)],
      ['dayHourRostered', new Array(24).fill('0')],
      ['dayDefinitionVersion', -1],
      ['dayComputedAtUtcMs', 'now'],
    ];
    for (const [field, value] of broken) {
      expect(DayFigures.is({ ...good(), [field]: value }), field).toBe(false);
    }
    const { dayWorkedSeatCount: _dropped, ...missing } = good();
    void _dropped;
    expect(DayFigures.is(missing)).toBe(false);
  });

  it('allocates nothing and leaves the body as it was', () => {
    const body = deepFreeze(good());
    expect(DayFigures.is(body)).toBe(true);
    expect(body).toEqual(good());
  });
});

describe('DayFigures — where the day happened (ADR 2026-11-09)', () => {
  const centre = LocationId.of('loc-centre');
  const mladost = LocationId.of('loc-mladost');
  const share = (cents: number): DayFigures => ({
    ...DayFigures.empty(ivan, DAY, AT),
    dayTakingsCents: cents as PriceCents,
  });
  /** A split day's share — a day's figures; the extra stamp fields are not read. */
  const bodyOf = (cents: number): DayBody => share(cents);
  const body = DayFigures.empty(ivan, DAY, AT);
  const shareBody = bodyOf(0);

  it('admits no location, one with no shares, and two or more with one share each', () => {
    expect(DayFigures.is({ ...body, dayLocationIds: [centre] })).toBe(true);
    expect(
      DayFigures.is({
        ...body,
        dayLocationIds: [centre, mladost],
        dayLocations: [shareBody, shareBody],
      }),
    ).toBe(true);
  });

  it('refuses unsorted or repeated ids, a share for a lone location, and a count that does not match', () => {
    for (const malformed of [
      {
        dayLocationIds: [mladost, centre],
        dayLocations: [shareBody, shareBody],
      },
      {
        dayLocationIds: [centre, centre],
        dayLocations: [shareBody, shareBody],
      },
      { dayLocationIds: [centre], dayLocations: [shareBody] },
      { dayLocationIds: [centre, mladost], dayLocations: [shareBody] },
      { dayLocationIds: [centre, mladost], dayLocations: [] },
      { dayLocationIds: ['' as LocationId], dayLocations: [] },
      { dayLocationIds: [centre, mladost], dayLocations: [{}, shareBody] },
      { dayLocationIds: null, dayLocations: [] },
    ]) {
      expect(DayFigures.is({ ...body, ...malformed })).toBe(false);
    }
  });

  it('atLocation: the day itself for its one location, the share of a split day, an empty held day elsewhere', () => {
    const lone = { ...share(2800), dayLocationIds: [centre], dayLocations: [] };
    expect(DayFigures.atLocation(lone, centre)).toBe(lone);
    expect(DayFigures.atLocation(lone, mladost)).toEqual({
      ...DayFigures.empty(ivan, DAY, AT),
    });

    const split = {
      ...share(2800),
      dayLocationIds: [centre, mladost],
      dayLocations: [bodyOf(1000), bodyOf(1800)],
    };
    const atMladost = DayFigures.atLocation(deepFreeze(split), mladost);
    expect(atMladost.dayTakingsCents).toBe(1800);
    expect(atMladost.dayLocationIds).toEqual([mladost]);
    expect(atMladost.dayLocations).toEqual([]);
    expect(atMladost.dayComputedAtUtcMs).toBe(AT);
    expect(DayFigures.is(atMladost)).toBe(true);
  });
});

describe('DayFigures.rowOf — the declared projection', () => {
  it('keeps exactly the seventeen DayRow fields and drops the rest', () => {
    const figures = { ...DayFigures.empty(ivan, DAY, AT), dayNoShowCount: 3 };
    const row: DayRow = DayFigures.rowOf(figures);
    expect(Object.keys(row).sort()).toEqual(
      [
        'barberId',
        'localDate',
        'dayRosteredMinutes',
        'dayWorkedMinutes',
        'dayNoShowMinutes',
        'dayUnmarkedMinutes',
        'dayBookedAheadMinutes',
        'dayHeldMinutes',
        'dayBlockedMinutes',
        'dayBreakMinutes',
        'dayShortGapMinutes',
        'dayUnsoldMinutes',
        'dayOpenMinutes',
        'dayClosedDayMinutes',
        'dayTakingsCents',
        'dayTipsCents',
        'currency',
      ].sort(),
    );
    expect(Object.hasOwn(row, 'dayNoShowCount')).toBe(false);
    expect(Object.hasOwn(row, 'dayServices')).toBe(false);
    expect(Object.hasOwn(row, 'dayDefinitionVersion')).toBe(false);
    for (const key of Object.keys(row) as (keyof DayRow)[]) {
      expect(row[key]).toBe(figures[key]);
    }
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const figures = deepFreeze(DayFigures.empty(ivan, DAY, AT));
    expect(DayFigures.rowOf(figures)).toEqual(DayFigures.rowOf(figures));
    expect(figures).toEqual(DayFigures.empty(ivan, DAY, AT));
  });
});

describe('DayFigures.otherMinutesOf — the time bar’s «Друго»', () => {
  it('is the held minutes plus the short gaps, nothing else', () => {
    const row = deepFreeze(
      DayFigures.rowOf({
        ...DayFigures.empty(ivan, DAY, AT),
        dayHeldMinutes: minuteCount(25),
        dayShortGapMinutes: minuteCount(15),
        dayBlockedMinutes: minuteCount(60),
        dayBreakMinutes: minuteCount(30),
        dayUnsoldMinutes: minuteCount(45),
      }),
    );
    expect(DayFigures.otherMinutesOf(row)).toBe(40);
    expect(DayFigures.otherMinutesOf(DayFigures.empty(ivan, DAY, AT))).toBe(0);
  });
});
