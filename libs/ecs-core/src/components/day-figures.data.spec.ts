import { describe, expect, it } from 'vitest';
import {
  BarberId,
  Currency,
  MinuteCount,
  PriceCents,
  ServiceId,
} from '@core/primitives';
import { deepFreeze, localDate, utcMs } from '@core/testing';
import { ANALYTICS_DEFINITION_VERSION } from './analytics-report.data';
import { DayFigures, type DayRow } from './day-figures.data';

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
