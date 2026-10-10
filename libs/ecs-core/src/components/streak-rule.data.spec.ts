import { describe, expect, it } from 'vitest';
import type { ServiceCategoryId } from '../entities/service-category.entity';
import type { ServiceId } from '../entities/service.entity';
import { DayKey } from './day-key.data';
import type { EngagementError } from './engagement-errors.data';
import type { StreakInterval } from './streak-interval.data';
import {
  STREAK_EXCUSES,
  STREAK_SHOP_EXCUSES,
  StreakExcuse,
  StreakOnBreak,
  StreakRule,
  StreakRuleDirection,
  StreakRuleParameter,
  StreakTransition,
  isStreakExcuse,
} from './streak-rule.data';

// The cases of `streak-definition.spec.ts` (StreakDefinition.create /
// default / isExcused), on the plain rule body. The head's id and name are
// guarded by `parseDefinitionId` / `parseName`.

/** The recommended rule, as a draft every case starts from. */
function base(): StreakRule {
  return {
    version: 3,
    effectiveFromDayKey: DayKey.of('2026-09-01'),
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
} as const satisfies StreakInterval;

type Patch = Partial<StreakRule>;

/** What a document could hold and the types forbid. */
const unknownExcuse = (raw: string) => raw as StreakExcuse;
const unknownOnBreak = (raw: string) => raw as StreakOnBreak;
const sid = (raw: string) => raw as ServiceId;
const cid = (raw: string) => raw as ServiceCategoryId;

function rule(patch: Patch = {}): StreakRule {
  const result = StreakRule.parse({ ...base(), ...patch });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function errorsOf(patch: Patch): readonly EngagementError.StreakRuleError[] {
  const result = StreakRule.parse({ ...base(), ...patch });
  return result.ok ? [] : result.error;
}

/** Each fault as `code field`, in the order they were found. */
function faults(patch: Patch): string[] {
  return errorsOf(patch).map((e) => `${e.code.split('.').pop()} ${e.field}`);
}

const protections = (patch: Partial<StreakRule.Protections>): Patch => ({
  protections: { ...base().protections, ...patch },
});
const repair = (patch: Partial<StreakRule.Repair>): Patch => ({
  repair: { ...base().repair, ...patch },
});
const hold = (patch: Partial<StreakRule.BookingHold>): Patch => ({
  bookingHold: { ...base().bookingHold, ...patch },
});
const pause = (patch: Partial<StreakRule.ClientPause>): Patch => ({
  clientPause: { ...base().clientPause, ...patch },
});

describe('the rule vocabularies', () => {
  it('keeps the stored strings, in their order', () => {
    expect(STREAK_EXCUSES).toEqual([
      'shopClosure',
      'barberAbsence',
      'staffCancelled',
      'closedDays',
    ]);
    expect(STREAK_SHOP_EXCUSES).toEqual([
      'shopClosure',
      'barberAbsence',
      'staffCancelled',
    ]);
    expect(Object.values(StreakOnBreak)).toEqual(['restart', 'hold']);
    expect(Object.values(StreakTransition)).toEqual([
      'grandfather',
      'recompute',
    ]);
    expect(Object.values(StreakRuleDirection)).toEqual([
      'looser',
      'stricter',
      'mixed',
      'neutral',
      'switch',
    ]);
    expect(Object.values(StreakRuleParameter)).toEqual([
      'name',
      'enabled',
      'qualifier',
      'minGapDays',
      'bookingHold',
      'interval',
      'graceDays',
      'riskLeadDays',
      'protections',
      'excuses',
      'clientPause',
      'repair',
      'onBreak',
    ]);
  });

  it('guards an excuse', () => {
    expect(isStreakExcuse('closedDays')).toBe(true);
    expect(isStreakExcuse('weather')).toBe(false);
    expect(isStreakExcuse(7)).toBe(false);
  });
});

describe('StreakRule.parse', () => {
  it('takes the recommended rule', () => {
    expect(faults({})).toEqual([]);
  });

  it('publishes every range it refuses by', () => {
    expect(StreakRule.LIMITS).toEqual({
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
        { qualifier: { kind: 'services', serviceIds: [sid('svc-fade')] } },
      ],
      [
        'chosen categories',
        { qualifier: { kind: 'categories', categoryIds: [cid('cat-hair')] } },
      ],
    ])('takes %s', (_, patch) => {
      expect(faults(patch)).toEqual([]);
    });
  });

  describe('every fault', () => {
    it.each<[string, Patch, string[]]>([
      ['version 0', { version: 0 }, ['version_not_positive version']],
      ['a negative version', { version: -2 }, ['version_not_positive version']],
      ['half a version', { version: 1.5 }, ['version_not_positive version']],
      [
        'a day that does not exist',
        { effectiveFromDayKey: DayKey.of('2026-02-30') },
        ['effective_day_invalid effectiveFromDayKey'],
      ],
      [
        'a day written loosely',
        { effectiveFromDayKey: DayKey.of('2026-9-1') },
        ['effective_day_invalid effectiveFromDayKey'],
      ],
      [
        'an instant for a day',
        { effectiveFromDayKey: DayKey.of('2026-09-01T07:00:00.000Z') },
        ['effective_day_invalid effectiveFromDayKey'],
      ],
      [
        'no effective day',
        { effectiveFromDayKey: DayKey.of('') },
        ['effective_day_invalid effectiveFromDayKey'],
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
    expect(errorsOf({ graceDays: 30 })[0]).toEqual({
      code: 'engagement.streak_definition.grace_out_of_range',
      field: 'graceDays',
      value: 30,
      min: 0,
      max: 21,
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
    expect(errorsOf({ onBreak: unknownOnBreak('pause') })[0]).toMatchObject({
      value: 'pause',
      options: 'restart, hold',
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
        version: 0,
        effectiveFromDayKey: DayKey.of('tomorrow'),
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
      'version_not_positive version',
      'effective_day_invalid effectiveFromDayKey',
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

  it('keeps its figures as they were given, in a fresh struct', () => {
    const draft = base();
    const made = rule();
    expect(made).toEqual(draft);
    expect(made).not.toBe(draft);
    expect(made.protections).not.toBe(draft.protections);
    expect(made.excuses).not.toBe(draft.excuses);
  });

  it('says a chosen service once', () => {
    expect(
      rule({
        qualifier: {
          kind: 'services',
          serviceIds: [sid('svc-fade'), sid('svc-beard'), sid('svc-fade')],
        },
      }).qualifier,
    ).toEqual({ kind: 'services', serviceIds: ['svc-fade', 'svc-beard'] });
  });

  it('answers for one cause', () => {
    const shop = rule();
    expect(
      STREAK_EXCUSES.map((cause) => StreakRule.isExcused(shop, cause)),
    ).toEqual([true, true, true, false]);
  });
});

describe('StreakRule.DEFAULT', () => {
  it('is the recommended rule', () => {
    expect(StreakRule.DEFAULT).toEqual({
      version: 1,
      effectiveFromDayKey: '2025-03-01',
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

  it('passes its own guard', () => {
    const parsed = StreakRule.parse(StreakRule.DEFAULT);
    expect(parsed.ok && parsed.value).toEqual(StreakRule.DEFAULT);
  });

  it('is one value, however often it is asked for', () => {
    expect(StreakRule.DEFAULT).toBe(StreakRule.DEFAULT);
  });

  it('is served under the rhythm’s stable id and name', () => {
    expect(StreakRule.DEFAULT_DEFINITION_ID).toBe('cadence');
    expect(StreakRule.DEFAULT_NAME).toEqual({
      bg: 'Посещения в ритъм',
      en: 'Visits in rhythm',
    });
  });
});

describe('the head’s guards', () => {
  it('takes an id as given and refuses a blank one', () => {
    expect(StreakRule.parseDefinitionId('cadence')).toEqual({
      ok: true,
      value: 'cadence',
    });
    for (const blank of ['', '   ']) {
      expect(StreakRule.parseDefinitionId(blank)).toEqual({
        ok: false,
        error: {
          code: 'engagement.streak_definition.id_empty',
          field: 'id',
          value: blank,
        },
      });
    }
  });

  it('trims a name in both languages', () => {
    expect(
      StreakRule.parseName({
        bg: '  Посещения в ритъм ',
        en: 'Visits in rhythm',
      }),
    ).toEqual({
      ok: true,
      value: { bg: 'Посещения в ритъм', en: 'Visits in rhythm' },
    });
  });

  it.each([
    [{ bg: ' ', en: 'Visits in rhythm' }, ['name.bg']],
    [{ bg: 'Посещения в ритъм', en: '' }, ['name.en']],
    [{ bg: '', en: '' }, ['name.en', 'name.bg']],
  ])('refuses the blank half of %j', (name, fields) => {
    const result = StreakRule.parseName(name);
    expect(result.ok ? [] : result.error.map((e) => e.field)).toEqual(fields);
  });

  it('names the locale and what was handed in', () => {
    const result = StreakRule.parseName({ bg: '', en: 'x' });
    expect(result.ok ? null : result.error[0]).toEqual({
      code: 'engagement.streak_definition.name_empty',
      field: 'name.bg',
      value: '',
      locale: 'bg',
    });
  });
});
