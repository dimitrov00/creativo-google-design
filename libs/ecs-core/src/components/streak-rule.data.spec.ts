import { describe, expect, it } from 'vitest';
import {
  ServiceCategoryId,
  ServiceId,
  type LocalDate,
  type EngagementError,
} from '@core/primitives';
import { localDate } from '@core/testing';
import {
  StreakInterval,
  type StreakIntervalRule,
} from './streak-interval.data';
import { StreakQualifier } from './streak-qualifier.data';
import {
  HeadRole,
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
// default / isExcused), on the FLAT rule body. The head's id and name are
// guarded by `parseDefinitionId` / `parseName`.

/** The recommended rule, as a draft every case starts from. */
function base(): StreakRule {
  return {
    version: 3,
    effectiveFromLocalDate: localDate('2026-09-01'),
    enabled: true,
    streakQualifier: StreakQualifier.AnyVisit,
    minGapDays: 7,
    bookingHoldEnabled: true,
    bookingHoldMaxDaysPastDue: 14,
    streakInterval: StreakInterval.Fixed,
    intervalDays: 42,
    graceDays: 7,
    riskLeadDays: 7,
    protectionsEnabled: true,
    protectionsMaxBanked: 2,
    protectionsEarnEvery: 5,
    protectionsStartWith: 0,
    excuses: [
      StreakExcuse.ShopClosure,
      StreakExcuse.BarberAbsence,
      StreakExcuse.StaffCancelled,
    ],
    clientPauseEnabled: false,
    clientPauseMaxDaysPerYear: 90,
    repairEnabled: true,
    repairWindowDays: 14,
    repairPerYear: 1,
    onBreak: StreakOnBreak.Restart,
  };
}

const PERSONAL = {
  streakInterval: StreakInterval.Personal,
  intervalTolerancePct: 50,
  intervalMinDays: 21,
  intervalMaxDays: 70,
  intervalFallbackDays: 42,
} as const satisfies StreakIntervalRule;

/** A fixed interval of `days`, as the flat fields a patch replaces. */
const fixed = (intervalDays: number) =>
  ({ streakInterval: StreakInterval.Fixed, intervalDays }) as const;

/** A change of any flat field, a whole variant of the qualifier or the interval included. */
type Patch = { readonly [K in keyof StreakRule.Options]?: StreakRule[K] } & {
  readonly [key: string]: unknown;
};

/** What a document could hold and the types forbid. */
const unknownExcuse = (raw: string) => raw as StreakExcuse;
const unknownOnBreak = (raw: string) => raw as StreakOnBreak;
const corruptDay = (raw: string) => raw as LocalDate;

/** The draft with a patch over it — a personal interval patch drops the fixed figure, and back. */
function patched(patch: Patch): StreakRule {
  const draft: Record<string, unknown> = { ...base(), ...patch };
  if (draft['streakInterval'] === StreakInterval.Personal) {
    delete draft['intervalDays'];
  }
  return draft as unknown as StreakRule;
}

function rule(patch: Patch = {}): StreakRule {
  const result = StreakRule.parse(patched(patch));
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function errorsOf(patch: Patch): readonly EngagementError.StreakRuleError[] {
  const result = StreakRule.parse(patched(patch));
  return result.ok ? [] : result.error;
}

/** The fault's code without its dictionary prefix, lower-cased: `grace_out_of_range`. */
const shortCode = (errorCode: string): string =>
  errorCode.replace('ENGAGEMENT_STREAK_DEFINITION_', '').toLowerCase();

/** Each fault as `code field`, in the order they were found. */
function faults(patch: Patch): string[] {
  return errorsOf(patch).map((e) => `${shortCode(e.errorCode)} ${e.field}`);
}

describe('the rule vocabularies', () => {
  it('declares the tags SCREAMING, in their order', () => {
    expect(STREAK_EXCUSES).toEqual([
      'SHOP_CLOSURE',
      'BARBER_ABSENCE',
      'STAFF_CANCELLED',
      'CLOSED_DAYS',
    ]);
    expect(STREAK_SHOP_EXCUSES).toEqual([
      'SHOP_CLOSURE',
      'BARBER_ABSENCE',
      'STAFF_CANCELLED',
    ]);
    expect(Object.values(StreakOnBreak)).toEqual(['RESTART', 'HOLD']);
    expect(Object.values(StreakTransition)).toEqual([
      'GRANDFATHER',
      'RECOMPUTE',
    ]);
    expect(Object.values(StreakRuleDirection)).toEqual([
      'LOOSER',
      'STRICTER',
      'MIXED',
      'NEUTRAL',
      'SWITCH',
    ]);
    expect(Object.values(StreakRuleParameter)).toEqual([
      'NAME',
      'ENABLED',
      'QUALIFIER',
      'MIN_GAP_DAYS',
      'BOOKING_HOLD',
      'INTERVAL',
      'GRACE_DAYS',
      'RISK_LEAD_DAYS',
      'PROTECTIONS',
      'EXCUSES',
      'CLIENT_PAUSE',
      'REPAIR',
      'ON_BREAK',
    ]);
    expect(Object.values(HeadRole)).toEqual(['CURRENT', 'SCHEDULED']);
  });

  it('guards an excuse', () => {
    expect(isStreakExcuse('CLOSED_DAYS')).toBe(true);
    expect(isStreakExcuse('closedDays')).toBe(false);
    expect(isStreakExcuse('weather')).toBe(false);
    expect(isStreakExcuse(7)).toBe(false);
  });
});

describe('StreakRule.parse', () => {
  it('takes the recommended rule', () => {
    expect(faults({})).toEqual([]);
  });

  it('publishes every range it refuses by, keyed by the flat fields', () => {
    expect(StreakRule.LIMITS).toEqual({
      intervalDays: { min: 14, max: 182 },
      intervalTolerancePct: { min: 0, max: 100 },
      minGapDays: { min: 0, max: 14 },
      bookingHoldMaxDaysPastDue: { min: 0, max: 28 },
      graceDays: { min: 0, max: 21 },
      riskLeadDays: { min: 0, max: 21 },
      protectionsMaxBanked: { min: 0, max: 5 },
      protectionsEarnEvery: { min: 1, max: 24 },
      protectionsStartWith: { min: 0, max: 5 },
      clientPauseMaxDaysPerYear: { min: 0, max: 180 },
      repairWindowDays: { min: 1, max: 60 },
      repairPerYear: { min: 1, max: 4 },
    });
  });

  describe('every boundary that holds', () => {
    it.each<[string, Patch]>([
      ['version 1', { version: 1 }],
      [
        'an interval of two weeks, everything under it',
        {
          ...fixed(14),
          graceDays: 13,
          riskLeadDays: 13,
          minGapDays: 13,
        },
      ],
      ['an interval of half a year', fixed(182)],
      ['a personal interval', PERSONAL],
      ['no minimum gap', { minGapDays: 0 }],
      ['a minimum gap of two weeks', { minGapDays: 14 }],
      ['a hold of no day', { bookingHoldMaxDaysPastDue: 0 }],
      ['a hold of four weeks', { bookingHoldMaxDaysPastDue: 28 }],
      ['no grace', { graceDays: 0 }],
      ['three weeks of grace', { graceDays: 21 }],
      ['no cue', { riskLeadDays: 0 }],
      ['a cue three weeks ahead', { riskLeadDays: 21 }],
      ['an empty reserve', { protectionsMaxBanked: 0 }],
      [
        'a reserve of five, started full',
        { protectionsMaxBanked: 5, protectionsStartWith: 5 },
      ],
      ['a protection with every visit', { protectionsEarnEvery: 1 }],
      ['a protection every 24 visits', { protectionsEarnEvery: 24 }],
      ['no excuse', { excuses: [] }],
      ['every excuse', { excuses: [...STREAK_EXCUSES] }],
      [
        'a pause of no day',
        { clientPauseEnabled: true, clientPauseMaxDaysPerYear: 0 },
      ],
      [
        'a pause of half a year',
        { clientPauseEnabled: true, clientPauseMaxDaysPerYear: 180 },
      ],
      ['a way back within a day', { repairWindowDays: 1 }],
      ['a way back within 60 days', { repairWindowDays: 60 }],
      ['four ways back a year', { repairPerYear: 4 }],
      ['a miss that holds the count', { onBreak: StreakOnBreak.Hold }],
      ['a rule that is off', { enabled: false }],
      [
        'chosen services',
        {
          streakQualifier: StreakQualifier.Services,
          qualifierServiceIds: [ServiceId.of('svc-fade')],
        },
      ],
      [
        'chosen categories',
        {
          streakQualifier: StreakQualifier.Categories,
          qualifierCategoryIds: [ServiceCategoryId.of('cat-hair')],
        },
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
        { effectiveFromLocalDate: corruptDay('2026-02-30') },
        ['effective_day_invalid effectiveFromLocalDate'],
      ],
      [
        'a day written loosely',
        { effectiveFromLocalDate: corruptDay('2026-9-1') },
        ['effective_day_invalid effectiveFromLocalDate'],
      ],
      [
        'an instant for a day',
        { effectiveFromLocalDate: corruptDay('2026-09-01T07:00:00.000Z') },
        ['effective_day_invalid effectiveFromLocalDate'],
      ],
      [
        'no effective day',
        { effectiveFromLocalDate: corruptDay('') },
        ['effective_day_invalid effectiveFromLocalDate'],
      ],
      [
        'no chosen service',
        { streakQualifier: StreakQualifier.Services, qualifierServiceIds: [] },
        ['qualifier_empty qualifierServiceIds'],
      ],
      [
        'no chosen category',
        {
          streakQualifier: StreakQualifier.Categories,
          qualifierCategoryIds: [],
        },
        ['qualifier_empty qualifierCategoryIds'],
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
        { ...fixed(14), minGapDays: 14 },
        ['min_gap_out_of_range minGapDays'],
      ],
      [
        'a negative hold',
        { bookingHoldMaxDaysPastDue: -1 },
        ['booking_hold_out_of_range bookingHoldMaxDaysPastDue'],
      ],
      [
        'a hold past four weeks',
        { bookingHoldMaxDaysPastDue: 29 },
        ['booking_hold_out_of_range bookingHoldMaxDaysPastDue'],
      ],
      [
        'half a day of hold',
        { bookingHoldMaxDaysPastDue: 1.5 },
        ['booking_hold_out_of_range bookingHoldMaxDaysPastDue'],
      ],
      [
        'a hold out of range while it is off',
        { bookingHoldEnabled: false, bookingHoldMaxDaysPastDue: 60 },
        ['booking_hold_out_of_range bookingHoldMaxDaysPastDue'],
      ],
      [
        'an interval under two weeks',
        {
          ...fixed(13),
          graceDays: 0,
          riskLeadDays: 0,
          minGapDays: 0,
        },
        ['interval_out_of_range intervalDays'],
      ],
      [
        'an interval past half a year',
        fixed(183),
        ['interval_out_of_range intervalDays'],
      ],
      [
        'a tolerance past 100 %',
        { ...PERSONAL, intervalTolerancePct: 105 },
        ['tolerance_out_of_range intervalTolerancePct'],
      ],
      [
        'a clamp upside down',
        { ...PERSONAL, intervalMinDays: 80, intervalFallbackDays: 70 },
        ['clamp_inverted intervalMinDays'],
      ],
      [
        'a newcomer outside the clamp',
        { ...PERSONAL, intervalFallbackDays: 84 },
        ['fallback_outside_clamp intervalFallbackDays'],
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
        { ...fixed(21), graceDays: 21 },
        ['grace_not_shorter_than_interval graceDays'],
      ],
      [
        'a grace longer than the interval',
        { ...fixed(14), graceDays: 20 },
        ['grace_not_shorter_than_interval graceDays'],
      ],
      [
        'a grace as long as the shortest personal interval',
        { ...PERSONAL, intervalMinDays: 14, graceDays: 14 },
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
        { ...fixed(14), riskLeadDays: 14 },
        ['risk_lead_out_of_range riskLeadDays'],
      ],
      [
        'a negative reserve',
        { protectionsMaxBanked: -1 },
        ['protections_out_of_range protectionsMaxBanked'],
      ],
      [
        'a reserve of six',
        { protectionsMaxBanked: 6 },
        ['protections_out_of_range protectionsMaxBanked'],
      ],
      [
        'a protection every 0 visits',
        { protectionsEarnEvery: 0 },
        ['protections_out_of_range protectionsEarnEvery'],
      ],
      [
        'a protection every 25 visits',
        { protectionsEarnEvery: 25 },
        ['protections_out_of_range protectionsEarnEvery'],
      ],
      [
        'a negative start',
        { protectionsStartWith: -1 },
        ['protections_out_of_range protectionsStartWith'],
      ],
      [
        'a start of six',
        { protectionsMaxBanked: 5, protectionsStartWith: 6 },
        ['protections_out_of_range protectionsStartWith'],
      ],
      [
        'a start above the reserve',
        { protectionsMaxBanked: 2, protectionsStartWith: 3 },
        ['start_with_above_cap protectionsStartWith'],
      ],
      [
        'a start above a reserve that is itself refused',
        { protectionsMaxBanked: 6, protectionsStartWith: 3 },
        ['protections_out_of_range protectionsMaxBanked'],
      ],
      [
        'a reserve out of range while protections are off',
        { protectionsEnabled: false, protectionsMaxBanked: 9 },
        ['protections_out_of_range protectionsMaxBanked'],
      ],
      [
        'an excuse nobody knows',
        { excuses: [StreakExcuse.ShopClosure, unknownExcuse('weather')] },
        ['unknown_excuse excuses'],
      ],
      [
        'a negative pause',
        { clientPauseMaxDaysPerYear: -1 },
        ['client_pause_out_of_range clientPauseMaxDaysPerYear'],
      ],
      [
        'a pause past half a year',
        { clientPauseMaxDaysPerYear: 181 },
        ['client_pause_out_of_range clientPauseMaxDaysPerYear'],
      ],
      [
        'a way back within no day',
        { repairWindowDays: 0 },
        ['repair_out_of_range repairWindowDays'],
      ],
      [
        'a way back within 61 days',
        { repairWindowDays: 61 },
        ['repair_out_of_range repairWindowDays'],
      ],
      [
        'no way back a year',
        { repairPerYear: 0 },
        ['repair_out_of_range repairPerYear'],
      ],
      [
        'five ways back a year',
        { repairPerYear: 5 },
        ['repair_out_of_range repairPerYear'],
      ],
      [
        'a way back out of range while it is off',
        { repairEnabled: false, repairWindowDays: 90 },
        ['repair_out_of_range repairWindowDays'],
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
      errorCode: 'ENGAGEMENT_STREAK_DEFINITION_GRACE_OUT_OF_RANGE',
      field: 'graceDays',
      value: 30,
      min: 0,
      max: 21,
    });
    expect(errorsOf({ ...fixed(21), graceDays: 21 })[0]).toMatchObject({
      value: 21,
      shortestIntervalDays: 21,
    });
    expect(errorsOf({ protectionsStartWith: 3 })[0]).toMatchObject({
      value: 3,
      maxBanked: 2,
    });
    expect(errorsOf({ excuses: [unknownExcuse('weather')] })[0]).toMatchObject({
      value: 'weather',
    });
    expect(errorsOf({ onBreak: unknownOnBreak('pause') })[0]).toMatchObject({
      value: 'pause',
      options: 'RESTART, HOLD',
    });
  });

  it('narrows the cue and the minimum gap to what the interval leaves', () => {
    const tight: Patch = { ...fixed(14), graceDays: 0 };
    expect(errorsOf({ ...tight, riskLeadDays: 14 })[0]).toMatchObject({
      min: 0,
      max: 13,
    });
    expect(errorsOf({ ...tight, minGapDays: 14 })[0]).toMatchObject({
      min: 0,
      max: 13,
    });
    // An interval of 16 leaves the minimum gap its own range: 14, not 15.
    expect(errorsOf({ ...fixed(16), minGapDays: 15 })[0]).toMatchObject({
      min: 0,
      max: 14,
    });
  });

  it('judges what stays under the interval by its own range when the interval is refused', () => {
    expect(
      faults({
        ...fixed(5),
        graceDays: 20,
        riskLeadDays: 20,
        minGapDays: 10,
      }),
    ).toEqual(['interval_out_of_range intervalDays']);
  });

  it('reports every fault at once', () => {
    expect(
      faults({
        version: 0,
        effectiveFromLocalDate: corruptDay('tomorrow'),
        streakQualifier: StreakQualifier.Services,
        qualifierServiceIds: [],
        ...fixed(200),
        minGapDays: 20,
        graceDays: 40,
        riskLeadDays: 40,
        bookingHoldEnabled: true,
        bookingHoldMaxDaysPastDue: 40,
        protectionsEnabled: true,
        protectionsMaxBanked: 9,
        protectionsEarnEvery: 0,
        protectionsStartWith: 9,
        excuses: [unknownExcuse('weather'), unknownExcuse('traffic')],
        clientPauseEnabled: true,
        clientPauseMaxDaysPerYear: 365,
        repairEnabled: true,
        repairWindowDays: 0,
        repairPerYear: 9,
        onBreak: unknownOnBreak('forget'),
      }),
    ).toEqual([
      'version_not_positive version',
      'effective_day_invalid effectiveFromLocalDate',
      'qualifier_empty qualifierServiceIds',
      'interval_out_of_range intervalDays',
      'min_gap_out_of_range minGapDays',
      'booking_hold_out_of_range bookingHoldMaxDaysPastDue',
      'grace_out_of_range graceDays',
      'risk_lead_out_of_range riskLeadDays',
      'protections_out_of_range protectionsMaxBanked',
      'protections_out_of_range protectionsEarnEvery',
      'protections_out_of_range protectionsStartWith',
      'unknown_excuse excuses',
      'unknown_excuse excuses',
      'client_pause_out_of_range clientPauseMaxDaysPerYear',
      'repair_out_of_range repairWindowDays',
      'repair_out_of_range repairPerYear',
      'unknown_option onBreak',
    ]);
  });

  it('keeps the excuses in the vocabulary’s order, each once', () => {
    expect(
      rule({
        excuses: [
          StreakExcuse.ClosedDays,
          StreakExcuse.StaffCancelled,
          StreakExcuse.ShopClosure,
          StreakExcuse.ClosedDays,
        ],
      }).excuses,
    ).toEqual(['SHOP_CLOSURE', 'STAFF_CANCELLED', 'CLOSED_DAYS']);
  });

  it('keeps its figures as they were given, in a fresh flat struct', () => {
    const draft = base();
    const made = rule();
    expect(made).toEqual(draft);
    expect(made).not.toBe(draft);
    expect(made.excuses).not.toBe(draft.excuses);
  });

  it('says a chosen service once', () => {
    const made = rule({
      streakQualifier: StreakQualifier.Services,
      qualifierServiceIds: [
        ServiceId.of('svc-fade'),
        ServiceId.of('svc-beard'),
        ServiceId.of('svc-fade'),
      ],
    });
    expect({
      streakQualifier: made.streakQualifier,
      qualifierServiceIds:
        made.streakQualifier === StreakQualifier.Services
          ? made.qualifierServiceIds
          : null,
    }).toEqual({
      streakQualifier: 'SERVICES',
      qualifierServiceIds: ['svc-fade', 'svc-beard'],
    });
  });

  it('keeps no field of a variant it does not hold', () => {
    const made = rule(PERSONAL);
    expect(made).toMatchObject(PERSONAL);
    expect('intervalDays' in made).toBe(false);
    expect('qualifierServiceIds' in made).toBe(false);
  });

  it('answers for one cause', () => {
    const shop = rule();
    expect(
      STREAK_EXCUSES.map((cause) => StreakRule.isExcused(shop, cause)),
    ).toEqual([true, true, true, false]);
  });
});

describe('StreakRule.DEFAULT', () => {
  it('is the recommended rule, flat', () => {
    expect(StreakRule.DEFAULT).toEqual({
      version: 1,
      effectiveFromLocalDate: '2025-03-01',
      enabled: true,
      streakQualifier: 'ANY_VISIT',
      minGapDays: 7,
      bookingHoldEnabled: true,
      bookingHoldMaxDaysPastDue: 14,
      streakInterval: 'FIXED',
      intervalDays: 42,
      graceDays: 7,
      riskLeadDays: 7,
      protectionsEnabled: true,
      protectionsMaxBanked: 2,
      protectionsEarnEvery: 5,
      protectionsStartWith: 0,
      excuses: ['SHOP_CLOSURE', 'BARBER_ABSENCE', 'STAFF_CANCELLED'],
      clientPauseEnabled: false,
      clientPauseMaxDaysPerYear: 90,
      repairEnabled: true,
      repairWindowDays: 14,
      repairPerYear: 1,
      onBreak: 'RESTART',
    });
  });

  it('copies the rule alone off a struct that carries more', () => {
    const element = {
      ...StreakRule.DEFAULT,
      headRole: HeadRole.Current,
      streakTransition: null,
    };
    const rule = StreakRule.of(element);
    expect(rule).toEqual(StreakRule.DEFAULT);
    expect('headRole' in rule).toBe(false);
    expect(rule.excuses).not.toBe(StreakRule.DEFAULT.excuses);
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

describe('StreakRule.RULE_CHANGE_NOTICE_DAYS', () => {
  it('owes the clients who see the rhythm thirty days’ notice of a stricter rule (R29)', () => {
    expect(StreakRule.RULE_CHANGE_NOTICE_DAYS).toBe(30);
    expect(Number.isInteger(StreakRule.RULE_CHANGE_NOTICE_DAYS)).toBe(true);
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
          errorCode: 'ENGAGEMENT_STREAK_DEFINITION_ID_EMPTY',
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
    [{ bg: ' ', en: 'Visits in rhythm' }, ['nameBg']],
    [{ bg: 'Посещения в ритъм', en: '' }, ['nameEn']],
    [{ bg: '', en: '' }, ['nameEn', 'nameBg']],
  ])('refuses the blank half of %j', (name, fields) => {
    const result = StreakRule.parseName(name);
    expect(result.ok ? [] : result.error.map((e) => e.field)).toEqual(fields);
  });

  it('names the locale and what was handed in', () => {
    const result = StreakRule.parseName({ bg: '', en: 'x' });
    expect(result.ok ? null : result.error[0]).toEqual({
      errorCode: 'ENGAGEMENT_STREAK_DEFINITION_NAME_EMPTY',
      field: 'nameBg',
      value: '',
      locale: 'bg',
    });
  });
});
