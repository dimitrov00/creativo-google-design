import { describe, expect, it } from 'vitest';
import * as barrel from '../../index';
import * as entries from './catalog-entries';
import {
  STREAK_EXCUSES,
  STREAK_LIMITS,
  STREAK_SHOP_EXCUSES,
  StreakDefinition,
  StreakDefinitionProps,
  StreakExcuse,
  StreakRuleDirection,
} from './streak-definition';
import { StreakDefinitionError } from './streak-definition.errors';
import type { StreakIntervalProps } from './streak-interval';

/** The recommended rule, as a draft every case starts from. */
function base(): StreakDefinitionProps {
  return {
    id: 'cadence',
    name: { bg: 'Посещения в ритъм', en: 'Visits in rhythm' },
    version: 3,
    effectiveFrom: '2026-09-01',
    enabled: true,
    qualifier: { kind: 'anyVisit' },
    minGapDays: 7,
    bookingHold: { enabled: true, maxDaysPastDue: 14 },
    interval: { kind: 'fixed', days: 42 },
    graceDays: 7,
    riskLeadDays: 7,
    protections: { enabled: true, maxBanked: 2, earnEvery: 5, startWith: 0 },
    excuses: ['shopClosure', 'barberAbsence', 'staffCancelled'],
    clientPause: { enabled: false, maxDaysPerYear: 90 },
    repair: { enabled: true, windowDays: 14, perYear: 1 },
    onBreak: 'restart',
  };
}

const PERSONAL = {
  kind: 'personal',
  tolerancePct: 50,
  minDays: 21,
  maxDays: 70,
  fallbackDays: 42,
} as const satisfies StreakIntervalProps;

type Patch = Partial<StreakDefinitionProps>;

/** What a document could hold and the types forbid. */
const unknownExcuse = (raw: string) => raw as StreakExcuse;
const unknownOnBreak = (raw: string) => raw as StreakDefinitionProps['onBreak'];

function rule(patch: Patch = {}): StreakDefinition {
  const result = StreakDefinition.create({ ...base(), ...patch });
  if (result.isFailure()) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function errorsOf(patch: Patch): readonly StreakDefinitionError[] {
  const result = StreakDefinition.create({ ...base(), ...patch });
  return result.isFailure() ? result.error : [];
}

/** Each fault as `code field`, in the order they were found. */
function faults(patch: Patch): string[] {
  return errorsOf(patch).map((e) => `${e.code.split('.').pop()} ${e.field}`);
}

const protections = (
  patch: Partial<StreakDefinitionProps['protections']>,
): Patch => ({ protections: { ...base().protections, ...patch } });
const repair = (patch: Partial<StreakDefinitionProps['repair']>): Patch => ({
  repair: { ...base().repair, ...patch },
});
const hold = (patch: Partial<StreakDefinitionProps['bookingHold']>): Patch => ({
  bookingHold: { ...base().bookingHold, ...patch },
});
const pause = (
  patch: Partial<StreakDefinitionProps['clientPause']>,
): Patch => ({
  clientPause: { ...base().clientPause, ...patch },
});

describe('StreakDefinition.create', () => {
  it('takes the recommended rule', () => {
    expect(faults({})).toEqual([]);
  });

  it('publishes every range it refuses by', () => {
    expect(STREAK_LIMITS).toEqual({
      interval: {
        days: { min: 14, max: 182 },
        tolerancePct: { min: 0, max: 100 },
      },
      minGapDays: { min: 0, max: 14 },
      bookingHold: { maxDaysPastDue: { min: 0, max: 28 } },
      graceDays: { min: 0, max: 21 },
      riskLeadDays: { min: 0, max: 21 },
      protections: {
        maxBanked: { min: 0, max: 5 },
        earnEvery: { min: 1, max: 24 },
        startWith: { min: 0, max: 5 },
      },
      clientPause: { maxDaysPerYear: { min: 0, max: 180 } },
      repair: {
        windowDays: { min: 1, max: 60 },
        perYear: { min: 1, max: 4 },
      },
    });
  });

  describe('every boundary that holds', () => {
    it.each<[string, Patch]>([
      ['version 1', { version: 1 }],
      [
        'an interval of two weeks, everything under it',
        {
          interval: { kind: 'fixed', days: 14 },
          graceDays: 13,
          riskLeadDays: 13,
          minGapDays: 13,
        },
      ],
      [
        'an interval of half a year',
        { interval: { kind: 'fixed', days: 182 } },
      ],
      ['a personal interval', { interval: PERSONAL }],
      ['no minimum gap', { minGapDays: 0 }],
      ['a minimum gap of two weeks', { minGapDays: 14 }],
      ['a hold of no day', hold({ maxDaysPastDue: 0 })],
      ['a hold of four weeks', hold({ maxDaysPastDue: 28 })],
      ['no grace', { graceDays: 0 }],
      ['three weeks of grace', { graceDays: 21 }],
      ['no cue', { riskLeadDays: 0 }],
      ['a cue three weeks ahead', { riskLeadDays: 21 }],
      ['an empty reserve', protections({ maxBanked: 0 })],
      [
        'a reserve of five, started full',
        protections({ maxBanked: 5, startWith: 5 }),
      ],
      ['a protection with every visit', protections({ earnEvery: 1 })],
      ['a protection every 24 visits', protections({ earnEvery: 24 })],
      ['no excuse', { excuses: [] }],
      ['every excuse', { excuses: [...STREAK_EXCUSES] }],
      ['a pause of no day', pause({ enabled: true, maxDaysPerYear: 0 })],
      ['a pause of half a year', pause({ enabled: true, maxDaysPerYear: 180 })],
      ['a way back within a day', repair({ windowDays: 1 })],
      ['a way back within 60 days', repair({ windowDays: 60 })],
      ['four ways back a year', repair({ perYear: 4 })],
      ['a miss that holds the count', { onBreak: 'hold' }],
      ['a rule that is off', { enabled: false }],
      [
        'chosen services',
        { qualifier: { kind: 'services', serviceIds: ['svc-fade'] } },
      ],
      [
        'chosen categories',
        { qualifier: { kind: 'categories', categoryIds: ['cat-hair'] } },
      ],
    ])('takes %s', (_, patch) => {
      expect(faults(patch)).toEqual([]);
    });
  });

  describe('every fault', () => {
    it.each<[string, Patch, string[]]>([
      ['an empty id', { id: '' }, ['id_empty id']],
      ['a blank id', { id: '   ' }, ['id_empty id']],
      [
        'no Bulgarian name',
        { name: { bg: ' ', en: 'Visits in rhythm' } },
        ['name_empty name.bg'],
      ],
      [
        'no English name',
        { name: { bg: 'Посещения в ритъм', en: '' } },
        ['name_empty name.en'],
      ],
      [
        'no name at all',
        { name: { bg: '', en: '' } },
        ['name_empty name.en', 'name_empty name.bg'],
      ],
      ['version 0', { version: 0 }, ['version_not_positive version']],
      ['a negative version', { version: -2 }, ['version_not_positive version']],
      ['half a version', { version: 1.5 }, ['version_not_positive version']],
      [
        'a day that does not exist',
        { effectiveFrom: '2026-02-30' },
        ['effective_day_invalid effectiveFrom'],
      ],
      [
        'a day written loosely',
        { effectiveFrom: '2026-9-1' },
        ['effective_day_invalid effectiveFrom'],
      ],
      [
        'an instant for a day',
        { effectiveFrom: '2026-09-01T07:00:00.000Z' },
        ['effective_day_invalid effectiveFrom'],
      ],
      [
        'no effective day',
        { effectiveFrom: '' },
        ['effective_day_invalid effectiveFrom'],
      ],

      [
        'no chosen service',
        { qualifier: { kind: 'services', serviceIds: [] } },
        ['qualifier_empty qualifier.serviceIds'],
      ],
      [
        'no chosen category',
        { qualifier: { kind: 'categories', categoryIds: [] } },
        ['qualifier_empty qualifier.categoryIds'],
      ],

      [
        'a negative minimum gap',
        { minGapDays: -1 },
        ['min_gap_out_of_range minGapDays'],
      ],
      [
        'a minimum gap past two weeks',
        { minGapDays: 15 },
        ['min_gap_out_of_range minGapDays'],
      ],
      [
        'half a day of minimum gap',
        { minGapDays: 3.5 },
        ['min_gap_out_of_range minGapDays'],
      ],
      [
        'a minimum gap as long as the interval',
        { interval: { kind: 'fixed', days: 14 }, minGapDays: 14 },
        ['min_gap_out_of_range minGapDays'],
      ],

      [
        'a negative hold',
        hold({ maxDaysPastDue: -1 }),
        ['booking_hold_out_of_range bookingHold.maxDaysPastDue'],
      ],
      [
        'a hold past four weeks',
        hold({ maxDaysPastDue: 29 }),
        ['booking_hold_out_of_range bookingHold.maxDaysPastDue'],
      ],
      [
        'half a day of hold',
        hold({ maxDaysPastDue: 1.5 }),
        ['booking_hold_out_of_range bookingHold.maxDaysPastDue'],
      ],
      [
        'a hold out of range while it is off',
        hold({ enabled: false, maxDaysPastDue: 60 }),
        ['booking_hold_out_of_range bookingHold.maxDaysPastDue'],
      ],

      [
        'an interval under two weeks',
        {
          interval: { kind: 'fixed', days: 13 },
          graceDays: 0,
          riskLeadDays: 0,
          minGapDays: 0,
        },
        ['interval_out_of_range interval.days'],
      ],
      [
        'an interval past half a year',
        { interval: { kind: 'fixed', days: 183 } },
        ['interval_out_of_range interval.days'],
      ],
      [
        'a tolerance past 100 %',
        { interval: { ...PERSONAL, tolerancePct: 105 } },
        ['tolerance_out_of_range interval.tolerancePct'],
      ],
      [
        'a clamp upside down',
        { interval: { ...PERSONAL, minDays: 80, fallbackDays: 70 } },
        ['clamp_inverted interval.minDays'],
      ],
      [
        'a newcomer outside the clamp',
        { interval: { ...PERSONAL, fallbackDays: 84 } },
        ['fallback_outside_clamp interval.fallbackDays'],
      ],

      ['a negative grace', { graceDays: -1 }, ['grace_out_of_range graceDays']],
      [
        'a grace past three weeks',
        { graceDays: 22 },
        ['grace_out_of_range graceDays'],
      ],
      [
        'half a day of grace',
        { graceDays: 2.5 },
        ['grace_out_of_range graceDays'],
      ],
      [
        'a grace as long as the interval',
        { interval: { kind: 'fixed', days: 21 }, graceDays: 21 },
        ['grace_not_shorter_than_interval graceDays'],
      ],
      [
        'a grace longer than the interval',
        { interval: { kind: 'fixed', days: 14 }, graceDays: 20 },
        ['grace_not_shorter_than_interval graceDays'],
      ],
      [
        'a grace as long as the shortest personal interval',
        { interval: { ...PERSONAL, minDays: 14 }, graceDays: 14 },
        ['grace_not_shorter_than_interval graceDays'],
      ],

      [
        'a negative cue',
        { riskLeadDays: -1 },
        ['risk_lead_out_of_range riskLeadDays'],
      ],
      [
        'a cue past three weeks',
        { riskLeadDays: 22 },
        ['risk_lead_out_of_range riskLeadDays'],
      ],
      [
        'a cue as long as the interval',
        { interval: { kind: 'fixed', days: 14 }, riskLeadDays: 14 },
        ['risk_lead_out_of_range riskLeadDays'],
      ],

      [
        'a negative reserve',
        protections({ maxBanked: -1 }),
        ['protections_out_of_range protections.maxBanked'],
      ],
      [
        'a reserve of six',
        protections({ maxBanked: 6 }),
        ['protections_out_of_range protections.maxBanked'],
      ],
      [
        'a protection every 0 visits',
        protections({ earnEvery: 0 }),
        ['protections_out_of_range protections.earnEvery'],
      ],
      [
        'a protection every 25 visits',
        protections({ earnEvery: 25 }),
        ['protections_out_of_range protections.earnEvery'],
      ],
      [
        'a negative start',
        protections({ startWith: -1 }),
        ['protections_out_of_range protections.startWith'],
      ],
      [
        'a start of six',
        protections({ maxBanked: 5, startWith: 6 }),
        ['protections_out_of_range protections.startWith'],
      ],
      [
        'a start above the reserve',
        protections({ maxBanked: 2, startWith: 3 }),
        ['start_with_above_cap protections.startWith'],
      ],
      [
        'a start above a reserve that is itself refused',
        protections({ maxBanked: 6, startWith: 3 }),
        ['protections_out_of_range protections.maxBanked'],
      ],
      [
        'a reserve out of range while protections are off',
        protections({ enabled: false, maxBanked: 9 }),
        ['protections_out_of_range protections.maxBanked'],
      ],

      [
        'an excuse nobody knows',
        { excuses: ['shopClosure', unknownExcuse('weather')] },
        ['unknown_excuse excuses'],
      ],

      [
        'a negative pause',
        pause({ maxDaysPerYear: -1 }),
        ['client_pause_out_of_range clientPause.maxDaysPerYear'],
      ],
      [
        'a pause past half a year',
        pause({ maxDaysPerYear: 181 }),
        ['client_pause_out_of_range clientPause.maxDaysPerYear'],
      ],

      [
        'a way back within no day',
        repair({ windowDays: 0 }),
        ['repair_out_of_range repair.windowDays'],
      ],
      [
        'a way back within 61 days',
        repair({ windowDays: 61 }),
        ['repair_out_of_range repair.windowDays'],
      ],
      [
        'no way back a year',
        repair({ perYear: 0 }),
        ['repair_out_of_range repair.perYear'],
      ],
      [
        'five ways back a year',
        repair({ perYear: 5 }),
        ['repair_out_of_range repair.perYear'],
      ],
      [
        'a way back out of range while it is off',
        repair({ enabled: false, windowDays: 90 }),
        ['repair_out_of_range repair.windowDays'],
      ],

      [
        'a miss that does something unknown',
        { onBreak: unknownOnBreak('pause') },
        ['unknown_option onBreak'],
      ],
    ])('refuses %s', (_, patch, expected) => {
      expect(faults(patch)).toEqual(expected);
    });
  });

  it('hands back what was handed in, and the range it missed', () => {
    expect(errorsOf({ graceDays: 30 })[0]).toMatchObject({
      code: 'engagement.streak_definition.grace_out_of_range',
      field: 'graceDays',
      value: 30,
      min: 0,
      max: 21,
      params: { field: 'graceDays', value: 30, min: 0, max: 21 },
    });
    expect(
      errorsOf({ interval: { kind: 'fixed', days: 21 }, graceDays: 21 })[0],
    ).toMatchObject({ value: 21, shortestIntervalDays: 21 });
    expect(errorsOf(protections({ startWith: 3 }))[0]).toMatchObject({
      value: 3,
      maxBanked: 2,
    });
    expect(errorsOf({ excuses: [unknownExcuse('weather')] })[0]).toMatchObject({
      value: 'weather',
    });
    expect(errorsOf({ name: { bg: '', en: 'x' } })[0]).toMatchObject({
      locale: 'bg',
      value: '',
    });
  });

  it('narrows the cue and the minimum gap to what the interval leaves', () => {
    const tight: Patch = {
      interval: { kind: 'fixed', days: 14 },
      graceDays: 0,
    };
    expect(errorsOf({ ...tight, riskLeadDays: 14 })[0]).toMatchObject({
      min: 0,
      max: 13,
    });
    expect(errorsOf({ ...tight, minGapDays: 14 })[0]).toMatchObject({
      min: 0,
      max: 13,
    });
    // An interval of 16 leaves the minimum gap its own range: 14, not 15.
    expect(
      errorsOf({ interval: { kind: 'fixed', days: 16 }, minGapDays: 15 })[0],
    ).toMatchObject({ min: 0, max: 14 });
  });

  it('judges what stays under the interval by its own range when the interval is refused', () => {
    expect(
      faults({
        interval: { kind: 'fixed', days: 5 },
        graceDays: 20,
        riskLeadDays: 20,
        minGapDays: 10,
      }),
    ).toEqual(['interval_out_of_range interval.days']);
  });

  it('reports every fault at once', () => {
    expect(
      faults({
        id: '',
        version: 0,
        effectiveFrom: 'tomorrow',
        qualifier: { kind: 'services', serviceIds: [] },
        interval: { kind: 'fixed', days: 200 },
        minGapDays: 20,
        graceDays: 40,
        riskLeadDays: 40,
        bookingHold: { enabled: true, maxDaysPastDue: 40 },
        protections: {
          enabled: true,
          maxBanked: 9,
          earnEvery: 0,
          startWith: 9,
        },
        excuses: [unknownExcuse('weather'), unknownExcuse('traffic')],
        clientPause: { enabled: true, maxDaysPerYear: 365 },
        repair: { enabled: true, windowDays: 0, perYear: 9 },
        onBreak: unknownOnBreak('forget'),
      }),
    ).toEqual([
      'id_empty id',
      'version_not_positive version',
      'effective_day_invalid effectiveFrom',
      'qualifier_empty qualifier.serviceIds',
      'interval_out_of_range interval.days',
      'min_gap_out_of_range minGapDays',
      'booking_hold_out_of_range bookingHold.maxDaysPastDue',
      'grace_out_of_range graceDays',
      'risk_lead_out_of_range riskLeadDays',
      'protections_out_of_range protections.maxBanked',
      'protections_out_of_range protections.earnEvery',
      'protections_out_of_range protections.startWith',
      'unknown_excuse excuses',
      'unknown_excuse excuses',
      'client_pause_out_of_range clientPause.maxDaysPerYear',
      'repair_out_of_range repair.windowDays',
      'repair_out_of_range repair.perYear',
      'unknown_option onBreak',
    ]);
  });

  it('keeps the excuses in the vocabulary’s order, each once', () => {
    expect(
      rule({
        excuses: ['closedDays', 'staffCancelled', 'shopClosure', 'closedDays'],
      }).excuses,
    ).toEqual(['shopClosure', 'staffCancelled', 'closedDays']);
  });

  it('answers for one cause', () => {
    const shop = rule();
    expect(STREAK_EXCUSES.map((cause) => shop.isExcused(cause))).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it('trims its name and keeps its figures as they were given', () => {
    const made = rule({
      name: { bg: '  Посещения в ритъм ', en: 'Visits in rhythm' },
    });
    expect(made.name.bg).toBe('Посещения в ритъм');
    expect(made.toProps()).toEqual(base());
  });
});

describe('StreakDefinition.default', () => {
  it('is the recommended rule', () => {
    expect(StreakDefinition.default().toProps()).toEqual({
      id: 'cadence',
      name: { bg: 'Посещения в ритъм', en: 'Visits in rhythm' },
      version: 1,
      effectiveFrom: '2025-03-01',
      enabled: true,
      qualifier: { kind: 'anyVisit' },
      minGapDays: 7,
      bookingHold: { enabled: true, maxDaysPastDue: 14 },
      interval: { kind: 'fixed', days: 42 },
      graceDays: 7,
      riskLeadDays: 7,
      protections: { enabled: true, maxBanked: 2, earnEvery: 5, startWith: 0 },
      excuses: ['shopClosure', 'barberAbsence', 'staffCancelled'],
      clientPause: { enabled: false, maxDaysPerYear: 90 },
      repair: { enabled: true, windowDays: 14, perYear: 1 },
      onBreak: 'restart',
    });
  });

  it('is one value, however often it is asked for', () => {
    expect(StreakDefinition.default()).toBe(StreakDefinition.default());
  });

  it('cannot be edited in place', () => {
    const recommended = StreakDefinition.default();
    expect(() => {
      (recommended.protections as { maxBanked: number }).maxBanked = 5;
    }).toThrow(TypeError);
    expect(() => {
      (recommended.excuses as StreakExcuse[]).push('closedDays');
    }).toThrow(TypeError);
    expect(recommended.protections.maxBanked).toBe(2);
    expect(recommended.excuses).toEqual(STREAK_SHOP_EXCUSES);
  });
});

describe('StreakDefinition.summary', () => {
  it('states the recommended rule', () => {
    expect(rule().summary()).toEqual({
      enabled: true,
      interval: { kind: 'fixed', days: 42 },
      graceDays: 7,
      protections: { maxBanked: 2, earnEvery: 5 },
      shopExcuses: true,
      hold: { maxDaysPastDue: 14 },
      repair: { windowDays: 14 },
      holdsCount: false,
      qualifier: { kind: 'anyVisit' },
    });
  });

  it('states a personal interval and a list of services as they are', () => {
    const summary = rule({
      interval: PERSONAL,
      qualifier: { kind: 'services', serviceIds: ['svc-fade', 'svc-beard'] },
    }).summary();
    expect(summary.interval).toEqual(PERSONAL);
    expect(summary.qualifier).toEqual({
      kind: 'services',
      serviceIds: ['svc-fade', 'svc-beard'],
    });
  });

  it.each<[string, Patch, object]>([
    [
      'protections that are off',
      protections({ enabled: false }),
      { protections: null },
    ],
    [
      'a reserve that holds none',
      protections({ maxBanked: 0 }),
      { protections: null },
    ],
    ['a hold that is off', hold({ enabled: false }), { hold: null }],
    ['a hold of no day', hold({ maxDaysPastDue: 0 }), { hold: null }],
    ['a way back that is off', repair({ enabled: false }), { repair: null }],
    [
      'a miss that holds the count',
      { onBreak: 'hold' },
      { repair: null, holdsCount: true },
    ],
    ['no grace', { graceDays: 0 }, { graceDays: 0 }],
    ['a rule that is off', { enabled: false }, { enabled: false }],
  ])('says nothing of %s', (_, patch, expected) => {
    expect(rule(patch).summary()).toMatchObject(expected);
  });

  it.each<[string, readonly StreakExcuse[], boolean]>([
    [
      'every visit the shop calls off',
      ['shopClosure', 'barberAbsence', 'staffCancelled'],
      true,
    ],
    ['those and the closed days', [...STREAK_EXCUSES], true],
    ['all but the staff’s own cancel', ['shopClosure', 'barberAbsence'], false],
    ['the closed days alone', ['closedDays'], false],
    ['nothing', [], false],
  ])(
    'promises the shop’s excuses only when it excuses %s',
    (_, excuses, shopExcuses) => {
      expect(rule({ excuses }).summary().shopExcuses).toBe(shopExcuses);
    },
  );

  it('hands out copies', () => {
    const made = rule({ interval: PERSONAL });
    const summary = made.summary();
    (summary.interval as { minDays: number }).minDays = 14;
    expect(made.summary().interval).toEqual(PERSONAL);
  });
});

describe('StreakDefinition.changeFrom', () => {
  const services = (...serviceIds: string[]): Patch => ({
    qualifier: { kind: 'services', serviceIds },
  });

  /** `[what, the rule before, the rule after, the direction, what is listed]` */
  type Case = [
    string,
    Patch,
    Patch,
    StreakRuleDirection,
    (keyof StreakDefinitionProps)[],
  ];

  it.each<Case>([
    ['nothing', {}, {}, 'neutral', []],
    [
      'a new version and day alone',
      {},
      { version: 4, effectiveFrom: '2026-10-01' },
      'neutral',
      [],
    ],
    [
      'the name',
      {},
      { name: { bg: 'Ритъм', en: 'Rhythm' } },
      'neutral',
      ['name'],
    ],
    ['the cue', {}, { riskLeadDays: 14 }, 'neutral', ['riskLeadDays']],

    [
      'a longer interval',
      {},
      { interval: { kind: 'fixed', days: 49 } },
      'looser',
      ['interval'],
    ],
    [
      'a shorter interval',
      {},
      { interval: { kind: 'fixed', days: 35 } },
      'stricter',
      ['interval'],
    ],
    [
      'more tolerance',
      { interval: PERSONAL },
      { interval: { ...PERSONAL, tolerancePct: 75 } },
      'looser',
      ['interval'],
    ],
    [
      'less tolerance',
      { interval: PERSONAL },
      { interval: { ...PERSONAL, tolerancePct: 25 } },
      'stricter',
      ['interval'],
    ],
    [
      'a higher floor',
      { interval: PERSONAL },
      { interval: { ...PERSONAL, minDays: 28 } },
      'looser',
      ['interval'],
    ],
    [
      'a lower ceiling',
      { interval: PERSONAL },
      { interval: { ...PERSONAL, maxDays: 56 } },
      'stricter',
      ['interval'],
    ],
    [
      'a longer newcomer’s interval',
      { interval: PERSONAL },
      { interval: { ...PERSONAL, fallbackDays: 49 } },
      'looser',
      ['interval'],
    ],
    [
      'a higher floor under a lower ceiling',
      { interval: PERSONAL },
      { interval: { ...PERSONAL, minDays: 28, maxDays: 56 } },
      'mixed',
      ['interval'],
    ],
    [
      'a habit that starts where the fixed one ended',
      {},
      { interval: { ...PERSONAL, minDays: 42, fallbackDays: 42 } },
      'looser',
      ['interval'],
    ],
    [
      'a habit that ends where the fixed one stood',
      {},
      { interval: { ...PERSONAL, maxDays: 42 } },
      'stricter',
      ['interval'],
    ],
    [
      'a habit around the fixed one',
      {},
      { interval: PERSONAL },
      'mixed',
      ['interval'],
    ],
    [
      'one number past every habit',
      { interval: PERSONAL },
      { interval: { kind: 'fixed', days: 70 } },
      'looser',
      ['interval'],
    ],
    [
      'one number under every habit',
      { interval: PERSONAL },
      { interval: { kind: 'fixed', days: 21 }, graceDays: 7 },
      'stricter',
      ['interval'],
    ],
    [
      'one number inside the habits',
      { interval: PERSONAL },
      { interval: { kind: 'fixed', days: 42 } },
      'mixed',
      ['interval'],
    ],
    [
      'a habit clamped to the one number it replaces',
      {},
      { interval: { ...PERSONAL, minDays: 42, maxDays: 42, fallbackDays: 42 } },
      'neutral',
      ['interval'],
    ],

    ['more grace', {}, { graceDays: 10 }, 'looser', ['graceDays']],
    ['less grace', {}, { graceDays: 3 }, 'stricter', ['graceDays']],
    ['a shorter minimum gap', {}, { minGapDays: 3 }, 'looser', ['minGapDays']],
    [
      'a longer minimum gap',
      {},
      { minGapDays: 10 },
      'stricter',
      ['minGapDays'],
    ],

    [
      'a wider hold',
      {},
      hold({ maxDaysPastDue: 21 }),
      'looser',
      ['bookingHold'],
    ],
    [
      'a narrower hold',
      {},
      hold({ maxDaysPastDue: 7 }),
      'stricter',
      ['bookingHold'],
    ],
    [
      'the hold switched on',
      hold({ enabled: false }),
      {},
      'looser',
      ['bookingHold'],
    ],
    [
      'the hold switched off',
      {},
      hold({ enabled: false }),
      'stricter',
      ['bookingHold'],
    ],
    [
      'a figure of a hold that stays off',
      hold({ enabled: false }),
      hold({ enabled: false, maxDaysPastDue: 28 }),
      'neutral',
      ['bookingHold'],
    ],
    [
      'a hold of no day switched off',
      hold({ maxDaysPastDue: 0 }),
      hold({ enabled: false, maxDaysPastDue: 0 }),
      'neutral',
      ['bookingHold'],
    ],

    [
      'a larger reserve',
      {},
      protections({ maxBanked: 3 }),
      'looser',
      ['protections'],
    ],
    [
      'a smaller reserve',
      {},
      protections({ maxBanked: 1 }),
      'stricter',
      ['protections'],
    ],
    [
      'protections earned faster',
      {},
      protections({ earnEvery: 4 }),
      'looser',
      ['protections'],
    ],
    [
      'protections earned slower',
      {},
      protections({ earnEvery: 8 }),
      'stricter',
      ['protections'],
    ],
    [
      'a first protection with the first visit',
      {},
      protections({ startWith: 1 }),
      'looser',
      ['protections'],
    ],
    [
      'a larger reserve earned slower',
      {},
      protections({ maxBanked: 3, earnEvery: 8 }),
      'mixed',
      ['protections'],
    ],
    [
      'protections switched off',
      {},
      protections({ enabled: false }),
      'stricter',
      ['protections'],
    ],
    [
      'protections switched on',
      protections({ enabled: false }),
      {},
      'looser',
      ['protections'],
    ],
    [
      'a figure of protections that stay off',
      protections({ enabled: false }),
      protections({ enabled: false, earnEvery: 3 }),
      'neutral',
      ['protections'],
    ],
    [
      'an empty reserve filled, earned slower',
      protections({ maxBanked: 0 }),
      protections({ maxBanked: 1, earnEvery: 10 }),
      'looser',
      ['protections'],
    ],

    [
      'an excuse added',
      {},
      { excuses: [...STREAK_EXCUSES] },
      'looser',
      ['excuses'],
    ],
    [
      'an excuse removed',
      {},
      { excuses: ['shopClosure', 'barberAbsence'] },
      'stricter',
      ['excuses'],
    ],
    [
      'one excuse for another',
      {},
      { excuses: ['shopClosure', 'barberAbsence', 'closedDays'] },
      'mixed',
      ['excuses'],
    ],
    [
      'the excuses said in another order',
      {},
      { excuses: ['staffCancelled', 'shopClosure', 'barberAbsence'] },
      'neutral',
      [],
    ],

    [
      'the client’s pause switched on',
      {},
      pause({ enabled: true }),
      'looser',
      ['clientPause'],
    ],
    [
      'the client’s pause switched off',
      pause({ enabled: true }),
      {},
      'stricter',
      ['clientPause'],
    ],
    [
      'a shorter pause',
      pause({ enabled: true }),
      pause({ enabled: true, maxDaysPerYear: 30 }),
      'stricter',
      ['clientPause'],
    ],
    [
      'a figure of a pause that stays off',
      {},
      pause({ maxDaysPerYear: 30 }),
      'neutral',
      ['clientPause'],
    ],

    ['a longer way back', {}, repair({ windowDays: 21 }), 'looser', ['repair']],
    [
      'a shorter way back',
      {},
      repair({ windowDays: 7 }),
      'stricter',
      ['repair'],
    ],
    ['more ways back a year', {}, repair({ perYear: 2 }), 'looser', ['repair']],
    [
      'a longer way back, fewer a year',
      repair({ perYear: 2 }),
      repair({ windowDays: 30, perYear: 1 }),
      'mixed',
      ['repair'],
    ],
    [
      'the way back switched off',
      {},
      repair({ enabled: false }),
      'stricter',
      ['repair'],
    ],
    [
      'the way back switched on',
      repair({ enabled: false }),
      {},
      'looser',
      ['repair'],
    ],
    [
      'a figure of a way back that stays off',
      repair({ enabled: false }),
      repair({ enabled: false, windowDays: 30 }),
      'neutral',
      ['repair'],
    ],

    [
      'a miss that holds the count',
      {},
      { onBreak: 'hold' },
      'looser',
      ['onBreak'],
    ],
    [
      'a miss that starts over',
      { onBreak: 'hold' },
      {},
      'stricter',
      ['onBreak'],
    ],
    [
      'a miss that holds the count, the way back gone with it',
      {},
      { onBreak: 'hold', ...repair({ enabled: false }) },
      'looser',
      ['repair', 'onBreak'],
    ],
    [
      'a way back under a count that is held',
      { onBreak: 'hold' },
      { onBreak: 'hold', ...repair({ windowDays: 7 }) },
      'neutral',
      ['repair'],
    ],

    [
      'any visit narrowed to chosen services',
      {},
      services('svc-fade'),
      'stricter',
      ['qualifier'],
    ],
    [
      'chosen services widened to any visit',
      services('svc-fade'),
      {},
      'looser',
      ['qualifier'],
    ],
    [
      'a service added',
      services('svc-fade'),
      services('svc-fade', 'svc-beard'),
      'looser',
      ['qualifier'],
    ],
    [
      'a service removed',
      services('svc-fade', 'svc-beard'),
      services('svc-beard'),
      'stricter',
      ['qualifier'],
    ],
    [
      'one service for another',
      services('svc-fade'),
      services('svc-beard'),
      'mixed',
      ['qualifier'],
    ],
    [
      'services for categories',
      services('svc-fade'),
      { qualifier: { kind: 'categories', categoryIds: ['cat-hair'] } },
      'mixed',
      ['qualifier'],
    ],
    [
      'the services said in another order',
      services('svc-fade', 'svc-beard'),
      services('svc-beard', 'svc-fade'),
      'neutral',
      [],
    ],

    [
      'more grace and a shorter interval',
      {},
      { graceDays: 10, interval: { kind: 'fixed', days: 35 } },
      'mixed',
      ['interval', 'graceDays'],
    ],
    [
      'more grace and a longer interval',
      {},
      { graceDays: 10, interval: { kind: 'fixed', days: 49 } },
      'looser',
      ['interval', 'graceDays'],
    ],
    [
      'less grace and another cue',
      {},
      { graceDays: 3, riskLeadDays: 3 },
      'stricter',
      ['graceDays', 'riskLeadDays'],
    ],

    ['the rule switched off', {}, { enabled: false }, 'switch', ['enabled']],
    ['the rule switched on', { enabled: false }, {}, 'switch', ['enabled']],
    [
      'the rule switched off, whatever moved with it',
      {},
      { enabled: false, graceDays: 0 },
      'switch',
      ['enabled', 'graceDays'],
    ],
    [
      'a figure of a rule that stays off',
      { enabled: false },
      { enabled: false, graceDays: 10 },
      'looser',
      ['graceDays'],
    ],
  ])('%s', (_, before, after, direction, changed) => {
    expect(rule(after).changeFrom(rule(before))).toEqual({
      direction,
      changed,
    });
  });

  it('reads the other way round when the rules change places', () => {
    const before = rule();
    const after = rule({ graceDays: 10, ...protections({ maxBanked: 3 }) });
    expect(after.changeFrom(before).direction).toBe('looser');
    expect(before.changeFrom(after).direction).toBe('stricter');
    expect(before.changeFrom(after).changed).toEqual(
      after.changeFrom(before).changed,
    );
  });
});

describe('StreakDefinition.revise', () => {
  it('is the next version, from its own day, of the same rule', () => {
    const current = rule();
    const next = current.revise({ graceDays: 10 }, '2026-10-01');
    expect(next.isSuccess() && next.value.toProps()).toEqual({
      ...base(),
      version: 4,
      effectiveFrom: '2026-10-01',
      graceDays: 10,
    });
  });

  it('leaves the rule it revised as it was', () => {
    const current = rule();
    current.revise({ graceDays: 10, excuses: [] }, '2026-10-01');
    expect(current.toProps()).toEqual(base());
  });

  it('numbers and names itself: a patch cannot', () => {
    const next = rule().revise(
      { id: 'other', version: 40, effectiveFrom: '2030-01-01' },
      '2026-10-01',
    );
    expect(next.isSuccess() && next.value).toMatchObject({
      id: 'cadence',
      version: 4,
      effectiveFrom: '2026-10-01',
    });
  });

  it('replaces a part whole', () => {
    const next = rule().revise(
      {
        protections: {
          enabled: false,
          maxBanked: 0,
          earnEvery: 5,
          startWith: 0,
        },
      },
      '2026-10-01',
    );
    expect(next.isSuccess() && next.value.protections).toEqual({
      enabled: false,
      maxBanked: 0,
      earnEvery: 5,
      startWith: 0,
    });
  });

  it('with no patch is the same rule under a new number', () => {
    const current = rule();
    const next = current.revise({}, '2026-10-01');
    if (next.isFailure()) throw new Error('unreachable');
    expect(next.value.changeFrom(current)).toEqual({
      direction: 'neutral',
      changed: [],
    });
    expect(next.value.equals(current)).toBe(false);
  });

  it('refuses what `create` refuses', () => {
    const next = rule().revise(
      { graceDays: 30, interval: { kind: 'fixed', days: 7 } },
      'soon',
    );
    expect(next.isFailure() && next.error.map((e) => e.field)).toEqual([
      'effectiveFrom',
      'interval.days',
      'graceDays',
    ]);
  });
});

describe('StreakDefinition, as a value', () => {
  it('equals the same version of the same rule', () => {
    expect(rule().equals(rule())).toBe(true);
    expect(
      rule({
        excuses: ['staffCancelled', 'barberAbsence', 'shopClosure'],
      }).equals(rule()),
    ).toBe(true);
  });

  it.each<[string, Patch]>([
    ['another rule', { id: 'other' }],
    ['another version', { version: 4 }],
    ['another day', { effectiveFrom: '2026-09-02' }],
    ['another name', { name: { bg: 'Ритъм', en: 'Rhythm' } }],
    ['a rule that is off', { enabled: false }],
    [
      'another qualifier',
      { qualifier: { kind: 'services', serviceIds: ['svc-fade'] } },
    ],
    ['another minimum gap', { minGapDays: 5 }],
    ['another hold', hold({ maxDaysPastDue: 7 })],
    ['another interval', { interval: PERSONAL }],
    ['another grace', { graceDays: 5 }],
    ['another cue', { riskLeadDays: 3 }],
    ['another reserve', protections({ startWith: 1 })],
    ['other excuses', { excuses: [] }],
    ['another pause', pause({ enabled: true })],
    ['another way back', repair({ perYear: 2 })],
    ['another miss', { onBreak: 'hold' }],
  ])('differs from %s', (_, patch) => {
    expect(rule(patch).equals(rule())).toBe(false);
    expect(rule().equals(rule(patch))).toBe(false);
  });

  it('comes back from its own props as itself', () => {
    for (const patch of [
      {},
      { interval: PERSONAL },
      { qualifier: { kind: 'categories', categoryIds: ['cat-hair'] } },
      { enabled: false, onBreak: 'hold', excuses: [...STREAK_EXCUSES] },
    ] satisfies Patch[]) {
      const made = rule(patch);
      const again = StreakDefinition.create(made.toProps());
      expect(again.isSuccess() && again.value.equals(made)).toBe(true);
      expect(again.isSuccess() && again.value.toProps()).toEqual(
        made.toProps(),
      );
    }
  });

  it('hands out plain copies, never its own parts', () => {
    const made = rule();
    const props = made.toProps();
    props.protections.maxBanked = 5;
    props.repair.windowDays = 60;
    props.bookingHold.enabled = false;
    props.clientPause.enabled = true;
    props.name.bg = 'Друго';
    (props.excuses as StreakExcuse[]).push('closedDays');
    expect(made.toProps()).toEqual(base());
  });

  it('keeps nothing of the draft it was made from', () => {
    const draft = base();
    const made = rule(draft);
    draft.protections.maxBanked = 5;
    draft.repair.windowDays = 60;
    (draft.excuses as StreakExcuse[]).push('closedDays');
    expect(made.toProps()).toEqual(base());
  });
});

describe('the rhythm, on the lib’s barrel', () => {
  it('carries what the contract names', () => {
    expect(barrel.StreakDefinition).toBe(StreakDefinition);
    expect(barrel.STREAK_EXCUSES).toBe(STREAK_EXCUSES);
    expect(barrel.STREAK_LIMITS).toBe(STREAK_LIMITS);
    expect(barrel.StreakDefinitionError).toBe(StreakDefinitionError);
    expect(
      [
        barrel.StreakInterval,
        barrel.StreakQualifier,
        barrel.StreakDefinitionSchedule,
      ].map((cls) => typeof cls),
    ).toEqual(['function', 'function', 'function']);

    // The contract's types, read through the barrel: a name that leaves it
    // stops this file compiling.
    const draft: barrel.StreakDefinitionProps = base();
    const interval: barrel.StreakIntervalProps = draft.interval;
    const qualifier: barrel.StreakQualifierProps = draft.qualifier;
    const excuse: barrel.StreakExcuse = 'closedDays';
    const transition: barrel.StreakTransition = 'grandfather';
    const field: barrel.StreakDefinitionField = 'interval.days';
    const summary: barrel.StreakRuleSummary = rule(draft).summary();
    const change: barrel.StreakRuleChange = rule(draft).changeFrom(rule());
    const direction: barrel.StreakRuleDirection = change.direction;
    expect([
      interval.kind,
      qualifier.kind,
      excuse,
      transition,
      field,
      summary.enabled,
      direction,
    ]).toEqual([
      'fixed',
      'anyVisit',
      'closedDays',
      'grandfather',
      'interval.days',
      true,
      'neutral',
    ]);
  });

  it('hands the excuses on from where they used to live', () => {
    expect(entries.STREAK_EXCUSES).toBe(STREAK_EXCUSES);
    expect(STREAK_EXCUSES).toEqual([
      'shopClosure',
      'barberAbsence',
      'staffCancelled',
      'closedDays',
    ]);
    const excuse: entries.StreakExcuse = 'closedDays';
    expect(STREAK_EXCUSES).toContain(excuse);
  });
});
