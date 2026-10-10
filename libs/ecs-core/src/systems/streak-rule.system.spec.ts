import { describe, expect, it } from 'vitest';
import { DayKey } from '../components/day-key.data';
import { LocalizedText } from '../components/localized-text.data';
import type { StreakInterval } from '../components/streak-interval.data';
import type { StreakQualifier } from '../components/streak-qualifier.data';
import {
  STREAK_EXCUSES,
  StreakRule,
  type ScheduledStreakRule,
  type StreakExcuse,
  type StreakRuleDirection,
  type StreakRuleParameter,
  type StreakTransition,
} from '../components/streak-rule.data';
import { deepFreeze } from '../testing';
import {
  StreakRuleSystem,
  type StreakRuleChange,
  type StreakSchedule,
} from './streak-rule.system';
import { ZonedTimeSystem } from './zoned-time.system';

/*
 * COPIED, never moved (the legacy specs keep running against their shims):
 *
 * - every case of libs/domain/engagement/src/lib/loyalty/streak-schedule.spec.ts
 *   but two — `refuses a version of another rule` and the `id_mismatch` line
 *   of `reports every fault at once` (engagement Q8 retired the code with
 *   the class: the head's bodies carry no id), and `cannot be re-scheduled
 *   in place` (an `Object.freeze` probe; a struct is never frozen in
 *   production, and the purity case below proves the system never writes
 *   what it is handed);
 * - the `summary`, `changeFrom` and value (`equals`) cases of
 *   streak-definition.spec.ts (`revise` and the factory's own cases stay
 *   with the class and `StreakRule.parse`).
 *
 * Re-targeted: a version is the plain `StreakRule` (its name is the head's,
 * so a `name` in a patch only says whether the name moved), `effectiveFrom`
 * is `effectiveFromDayKey`, a waiting version is the rule with its
 * `transition` beside it (`ScheduledStreakRule`), and an error's list
 * parameter is one joined string.
 */

type Patch = Omit<Partial<StreakRule>, 'qualifier' | 'effectiveFromDayKey'> & {
  readonly name?: LocalizedText;
  readonly effectiveFrom?: string;
  readonly qualifier?:
    | { readonly kind: 'anyVisit' }
    | { readonly kind: 'services'; readonly serviceIds: readonly string[] }
    | { readonly kind: 'categories'; readonly categoryIds: readonly string[] };
};

/** The recommended rule as version 3 from 2026-09-01: what every case starts from. */
function base(): StreakRule {
  return {
    ...StreakRule.DEFAULT,
    version: 3,
    effectiveFromDayKey: DayKey.of('2026-09-01'),
  };
}

function rule(patch: Patch = {}): StreakRule {
  const { effectiveFrom, qualifier, ...rest } = patch;
  // The name is the head's: a version holds none.
  const figures = Object.fromEntries(
    Object.entries(rest).filter(([key]) => key !== 'name'),
  ) as Partial<StreakRule>;
  const result = StreakRule.parse({
    ...base(),
    ...figures,
    ...(effectiveFrom === undefined
      ? {}
      : { effectiveFromDayKey: DayKey.of(effectiveFrom) }),
    ...(qualifier === undefined
      ? {}
      : { qualifier: qualifier as StreakQualifier }),
  });
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

/** The head's name a patch names, or the recommended one. */
const nameOf = (patch: Patch): LocalizedText =>
  patch.name ?? StreakRule.DEFAULT_NAME;

const PERSONAL = {
  kind: 'personal',
  tolerancePct: 50,
  minDays: 21,
  maxDays: 70,
  fallbackDays: 42,
} as const satisfies StreakInterval;

const protections = (patch: Partial<StreakRule['protections']>): Patch => ({
  protections: { ...base().protections, ...patch },
});
const repair = (patch: Partial<StreakRule['repair']>): Patch => ({
  repair: { ...base().repair, ...patch },
});
const hold = (patch: Partial<StreakRule['bookingHold']>): Patch => ({
  bookingHold: { ...base().bookingHold, ...patch },
});
const pause = (patch: Partial<StreakRule['clientPause']>): Patch => ({
  clientPause: { ...base().clientPause, ...patch },
});

// ── streak-schedule.spec.ts ──────────────────────────────────────────────

const CURRENT = rule();
const NEXT = rule({
  version: 4,
  effectiveFrom: '2026-10-01',
  interval: { kind: 'fixed', days: 35 },
});

const waiting = (
  definition: StreakRule,
  transition: StreakTransition,
): ScheduledStreakRule => ({ ...definition, transition });

function schedule(
  scheduled: ScheduledStreakRule | null = waiting(NEXT, 'grandfather'),
  current: StreakRule = CURRENT,
): StreakSchedule {
  const result = StreakRuleSystem.schedule(current, scheduled);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

/** Each fault as `code field`, in the order they were found. */
function faults(
  definition: StreakRule,
  transition: StreakTransition = 'grandfather',
): string[] {
  const result = StreakRuleSystem.schedule(
    CURRENT,
    waiting(definition, transition),
  );
  return result.ok
    ? []
    : result.error.map((e) => `${e.code.split('.').pop()} ${e.field}`);
}

describe('StreakRuleSystem.schedule', () => {
  it('holds the rule in force alone', () => {
    const head = schedule(null);
    expect(head.current).toBe(CURRENT);
    expect(head.scheduled).toBeNull();
  });

  it('holds the rule in force and the one that waits', () => {
    const head = schedule();
    expect(head.current).toBe(CURRENT);
    expect(head.scheduled).toEqual({ ...NEXT, transition: 'grandfather' });
  });

  it.each(['grandfather', 'recompute'] as const)(
    'takes the transition %s',
    (transition) => {
      expect(faults(NEXT, transition)).toEqual([]);
    },
  );

  it.each([3, 2])('refuses version %s after version 3', (version) => {
    const result = StreakRuleSystem.schedule(
      CURRENT,
      waiting(rule({ version, effectiveFrom: '2026-10-01' }), 'grandfather'),
    );
    expect(!result.ok && result.error).toHaveLength(1);
    expect(!result.ok && result.error[0]).toMatchObject({
      code: 'engagement.streak_schedule.version_not_rising',
      field: 'scheduled.version',
      value: version,
      currentVersion: 3,
    });
  });

  it('takes a version that skips a number', () => {
    // A withdrawn version keeps its number: the next one is two above.
    expect(faults(rule({ version: 5, effectiveFrom: '2026-10-01' }))).toEqual(
      [],
    );
  });

  it.each(['2026-09-01', '2026-08-31'])(
    'refuses a rule that waits for %s when the one in force began on 2026-09-01',
    (effectiveFrom) => {
      const result = StreakRuleSystem.schedule(
        CURRENT,
        waiting(rule({ version: 4, effectiveFrom }), 'grandfather'),
      );
      expect(!result.ok && result.error).toHaveLength(1);
      expect(!result.ok && result.error[0]).toMatchObject({
        code: 'engagement.streak_schedule.scheduled_not_after_current',
        field: 'scheduled.effectiveFromDayKey',
        value: effectiveFrom,
        currentEffectiveFromDayKey: '2026-09-01',
      });
    },
  );

  it('takes a rule that waits for the very next day', () => {
    expect(faults(rule({ version: 4, effectiveFrom: '2026-09-02' }))).toEqual(
      [],
    );
  });

  it('refuses a transition it does not know', () => {
    const result = StreakRuleSystem.schedule(
      CURRENT,
      waiting(NEXT, 'forget' as string as StreakTransition),
    );
    expect(!result.ok && result.error).toHaveLength(1);
    expect(!result.ok && result.error[0]).toMatchObject({
      code: 'engagement.streak_definition.unknown_option',
      field: 'scheduled.transition',
      value: 'forget',
      options: 'grandfather, recompute',
    });
  });

  it('reports every fault at once', () => {
    expect(
      faults(
        rule({ version: 1, effectiveFrom: '2026-01-01' }),
        'forget' as string as StreakTransition,
      ),
    ).toEqual([
      'version_not_rising scheduled.version',
      'scheduled_not_after_current scheduled.effectiveFromDayKey',
      'unknown_option scheduled.transition',
    ]);
  });
});

describe('StreakRuleSystem, by date', () => {
  it.each([
    { today: '2026-09-01', inForce: 3, upcoming: 4 },
    { today: '2026-09-29', inForce: 3, upcoming: 4 },
    { today: '2026-09-30', inForce: 3, upcoming: 4 },
    { today: '2026-10-01', inForce: 4, upcoming: null },
    { today: '2026-10-02', inForce: 4, upcoming: null },
    { today: '2027-03-15', inForce: 4, upcoming: null },
  ])(
    'on $today version $inForce is in force and $upcoming waits',
    ({ today, inForce, upcoming }) => {
      const head = schedule();
      expect(StreakRuleSystem.inForceOn(head, DayKey.of(today)).version).toBe(
        inForce,
      );
      expect(
        StreakRuleSystem.upcomingOn(head, DayKey.of(today))?.version ?? null,
      ).toBe(upcoming);
    },
  );

  it('hands the waiting rule over with what it does to the runs that exist', () => {
    expect(
      StreakRuleSystem.upcomingOn(
        schedule(waiting(NEXT, 'recompute')),
        DayKey.of('2026-09-29'),
      ),
    ).toEqual({ ...NEXT, transition: 'recompute' });
  });

  it('with nothing waiting, the rule in force is the rule on any day', () => {
    const head = schedule(null);
    for (const today of ['2026-09-01', '2026-09-29', '2030-01-01']) {
      expect(StreakRuleSystem.inForceOn(head, DayKey.of(today))).toBe(CURRENT);
      expect(StreakRuleSystem.upcomingOn(head, DayKey.of(today))).toBeNull();
    }
  });

  it('a first rule that has not begun yet is still the only rule there is', () => {
    expect(
      StreakRuleSystem.inForceOn(schedule(null), DayKey.of('2026-08-15')),
    ).toBe(CURRENT);
  });

  it('hands a rule that is off over as the rule in force: the reader asks it', () => {
    const off = rule({
      version: 4,
      effectiveFrom: '2026-10-01',
      enabled: false,
    });
    const head = schedule(waiting(off, 'grandfather'));
    expect(
      StreakRuleSystem.inForceOn(head, DayKey.of('2026-09-30')).enabled,
    ).toBe(true);
    expect(
      StreakRuleSystem.inForceOn(head, DayKey.of('2026-10-01')).enabled,
    ).toBe(false);
  });
});

describe('StreakRuleSystem.earliestEffectiveDay', () => {
  const TODAY = DayKey.of('2026-09-29');
  const change = (direction: StreakRuleDirection): StreakRuleChange => ({
    direction,
    changed: [],
  });
  const unseen = { clientsSeeRhythm: false, noticeDays: 30 };
  const seen = { clientsSeeRhythm: true, noticeDays: 30 };

  it.each<[StreakRuleDirection, typeof seen, string, string]>([
    ['neutral', unseen, '2026-09-29', 'today'],
    ['neutral', seen, '2026-09-29', 'today'],
    ['looser', unseen, '2026-09-30', 'tomorrow'],
    ['looser', seen, '2026-09-30', 'tomorrow'],
    ['switch', unseen, '2026-09-30', 'tomorrow'],
    ['switch', seen, '2026-09-30', 'tomorrow'],
    ['stricter', unseen, '2026-09-30', 'tomorrow'],
    ['mixed', unseen, '2026-09-30', 'tomorrow'],
    ['stricter', seen, '2026-10-29', 'a notice period ahead'],
    ['mixed', seen, '2026-10-29', 'a notice period ahead'],
  ])('a %s change with %o may begin on %s (%s)', (direction, policy, day) => {
    expect(
      StreakRuleSystem.earliestEffectiveDay(
        change(direction).direction,
        TODAY,
        policy,
      ),
    ).toBe(day);
  });

  it('never lets what takes something away begin today, whatever the notice', () => {
    for (const noticeDays of [0, -5]) {
      expect(
        StreakRuleSystem.earliestEffectiveDay(
          change('stricter').direction,
          TODAY,
          {
            clientsSeeRhythm: true,
            noticeDays,
          },
        ),
      ).toBe('2026-09-30');
    }
  });

  it('reads the change the rule itself classified', () => {
    const stricter = StreakRuleSystem.changeFrom(NEXT, CURRENT, false);
    expect(stricter.direction).toBe('stricter');
    expect(
      StreakRuleSystem.earliestEffectiveDay(stricter.direction, TODAY, seen),
    ).toBe('2026-10-29');
  });
});

describe('addDays — the civil day count the schedule moves by (ZonedTimeSystem)', () => {
  const addDays = (day: string, days: number): string =>
    ZonedTimeSystem.addDays(DayKey.of(day), days);

  it.each([
    ['2026-09-29', 0, '2026-09-29'],
    ['2026-09-29', 1, '2026-09-30'],
    ['2026-09-30', 1, '2026-10-01'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2028-02-28', 1, '2028-02-29'],
    ['2027-02-28', 1, '2027-03-01'],
    ['2026-09-29', 42, '2026-11-10'],
    ['2026-09-29', 182, '2027-03-30'],
    ['2026-10-01', -1, '2026-09-30'],
    ['2026-03-01', -42, '2026-01-18'],
  ])('%s and %s days is %s', (day, days, expected) => {
    expect(addDays(day, days)).toBe(expected);
  });

  it('counts calendar days across both of Sofia’s clock changes', () => {
    // 29.03.2026 has 23 hours in Sofia and 25.10.2026 has 25: a date has neither.
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25');
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
  });
});

// ── streak-definition.spec.ts: summary, changeFrom, as a value ───────────

describe('StreakRuleSystem.summary', () => {
  it('states the recommended rule', () => {
    expect(StreakRuleSystem.summary(rule())).toEqual({
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
    const summary = StreakRuleSystem.summary(
      rule({
        interval: PERSONAL,
        qualifier: { kind: 'services', serviceIds: ['svc-fade', 'svc-beard'] },
      }),
    );
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
    expect(StreakRuleSystem.summary(rule(patch))).toMatchObject(expected);
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
      expect(StreakRuleSystem.summary(rule({ excuses })).shopExcuses).toBe(
        shopExcuses,
      );
    },
  );

  it('hands out copies', () => {
    const made = rule({ interval: PERSONAL });
    const summary = StreakRuleSystem.summary(made);
    (summary.interval as { minDays: number }).minDays = 14;
    expect(StreakRuleSystem.summary(made).interval).toEqual(PERSONAL);
  });
});

describe('StreakRuleSystem.changeFrom', () => {
  const services = (...serviceIds: string[]): Patch => ({
    qualifier: { kind: 'services', serviceIds },
  });

  /** `[what, the rule before, the rule after, the direction, what is listed]` */
  type Case = [
    string,
    Patch,
    Patch,
    StreakRuleDirection,
    StreakRuleParameter[],
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
    expect(
      StreakRuleSystem.changeFrom(
        rule(after),
        rule(before),
        !LocalizedText.equals(nameOf(after), nameOf(before)),
      ),
    ).toEqual({
      direction,
      changed,
    });
  });

  it('reads the other way round when the rules change places', () => {
    const before = rule();
    const after = rule({ graceDays: 10, ...protections({ maxBanked: 3 }) });
    expect(StreakRuleSystem.changeFrom(after, before, false).direction).toBe(
      'looser',
    );
    expect(StreakRuleSystem.changeFrom(before, after, false).direction).toBe(
      'stricter',
    );
    expect(StreakRuleSystem.changeFrom(before, after, false).changed).toEqual(
      StreakRuleSystem.changeFrom(after, before, false).changed,
    );
  });
});

describe('StreakRuleSystem.equals, a rule as a value', () => {
  it('equals the same version of the same rule', () => {
    expect(StreakRuleSystem.equals(rule(), rule())).toBe(true);
    expect(
      StreakRuleSystem.equals(
        rule({
          excuses: ['staffCancelled', 'barberAbsence', 'shopClosure'],
        }),
        rule(),
      ),
    ).toBe(true);
  });

  it.each<[string, Patch]>([
    ['another version', { version: 4 }],
    ['another day', { effectiveFrom: '2026-09-02' }],
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
    expect(StreakRuleSystem.equals(rule(patch), rule())).toBe(false);
    expect(StreakRuleSystem.equals(rule(), rule(patch))).toBe(false);
  });
});

describe('StreakRuleSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const current = deepFreeze(rule());
    const next = deepFreeze(
      waiting(rule({ version: 4, effectiveFrom: '2026-10-01' }), 'grandfather'),
    );
    const head = deepFreeze({ current, scheduled: next });
    const today = DayKey.of('2026-09-29');
    const once = [
      StreakRuleSystem.schedule(current, next),
      StreakRuleSystem.inForceOn(head, today),
      StreakRuleSystem.upcomingOn(head, today),
      StreakRuleSystem.changeFrom(next, current, true),
      StreakRuleSystem.summary(next),
      StreakRuleSystem.earliestEffectiveDay('stricter', today, {
        clientsSeeRhythm: true,
        noticeDays: 30,
      }),
    ];
    const twice = [
      StreakRuleSystem.schedule(current, next),
      StreakRuleSystem.inForceOn(head, today),
      StreakRuleSystem.upcomingOn(head, today),
      StreakRuleSystem.changeFrom(next, current, true),
      StreakRuleSystem.summary(next),
      StreakRuleSystem.earliestEffectiveDay('stricter', today, {
        clientsSeeRhythm: true,
        noticeDays: 30,
      }),
    ];
    expect(twice).toEqual(once);
  });
});
