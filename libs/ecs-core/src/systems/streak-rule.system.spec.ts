import { describe, expect, it } from 'vitest';
import {
  LocalizedText,
  StreakInterval,
  StreakIntervalRule,
  StreakQualifierRule,
  HeadRole,
  STREAK_EXCUSES,
  StreakExcuse,
  StreakOnBreak,
  StreakRule,
  StreakRuleDirection,
  StreakRuleParameter,
  StreakTransition,
  type ScheduledStreakRule,
} from '@core/components';
import { ServiceCategoryId, ServiceId, LocalDate } from '@core/primitives';
import { deepFreeze, localDate } from '@core/testing';
import {
  StreakRuleSystem,
  type StreakRuleChange,
  type StreakSchedule,
} from './streak-rule.system';

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
 * Re-targeted: a version is the FLAT `StreakRule` (its name is the head's,
 * so a `name` in a patch only says whether the name moved), `effectiveFrom`
 * is `effectiveFromLocalDate`, the head is the `rules` list (F-9) with the
 * waiting version's `streakTransition` beside it, every tag is SCREAMING
 * and an error names the flat field. A case's change is still written by
 * PART — the interval and qualifier slices, each option part's figures
 * together — and flattened onto the rule by `rule()`, so every case table
 * reads as it did.
 */

type Part<K extends string> = { readonly [F in K]?: number | boolean };

type Patch = {
  readonly name?: LocalizedText;
  readonly version?: number;
  readonly effectiveFrom?: string;
  readonly enabled?: boolean;
  readonly qualifier?: StreakQualifierRule;
  readonly minGapDays?: number;
  readonly bookingHold?: Part<'enabled' | 'maxDaysPastDue'>;
  readonly interval?: StreakIntervalRule;
  readonly graceDays?: number;
  readonly riskLeadDays?: number;
  readonly protections?: Part<
    'enabled' | 'maxBanked' | 'earnEvery' | 'startWith'
  >;
  readonly excuses?: readonly StreakExcuse[];
  readonly clientPause?: Part<'enabled' | 'maxDaysPerYear'>;
  readonly repair?: Part<'enabled' | 'windowDays' | 'perYear'>;
  readonly onBreak?: StreakOnBreak;
};

/** The recommended rule as version 3 from 2026-09-01: what every case starts from. */
function base(): StreakRule {
  return {
    ...StreakRule.DEFAULT,
    version: 3,
    effectiveFromLocalDate: localDate('2026-09-01'),
  };
}

/** A part's figures, prefixed onto the flat rule (`protections.maxBanked` → `protectionsMaxBanked`). */
function prefixed(
  prefix: string,
  part: Readonly<Record<string, number | boolean | undefined>> | undefined,
): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = {};
  for (const [field, value] of Object.entries(part ?? {})) {
    if (value === undefined) continue;
    out[`${prefix}${field.charAt(0).toUpperCase()}${field.slice(1)}`] = value;
  }
  return out;
}

/** The version a patch makes: the base with the patch flattened over it, parsed. */
function rule(patch: Patch = {}): StreakRule {
  const draft = {
    ...StreakRule.of(base()),
    ...(patch.version === undefined ? {} : { version: patch.version }),
    ...(patch.effectiveFrom === undefined
      ? {}
      : { effectiveFromLocalDate: localDate(patch.effectiveFrom) }),
    ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
    ...(patch.minGapDays === undefined ? {} : { minGapDays: patch.minGapDays }),
    ...(patch.graceDays === undefined ? {} : { graceDays: patch.graceDays }),
    ...(patch.riskLeadDays === undefined
      ? {}
      : { riskLeadDays: patch.riskLeadDays }),
    ...(patch.excuses === undefined ? {} : { excuses: patch.excuses }),
    ...(patch.onBreak === undefined ? {} : { onBreak: patch.onBreak }),
    ...prefixed('bookingHold', patch.bookingHold),
    ...prefixed('protections', patch.protections),
    ...prefixed('clientPause', patch.clientPause),
    ...prefixed('repair', patch.repair),
  } as Record<string, unknown>;
  // A slice replaces the variant whole: none of the old variant's fields stay.
  if (patch.interval !== undefined) {
    for (const key of Object.keys(draft)) {
      if (key.startsWith('interval')) delete draft[key];
    }
    Object.assign(draft, patch.interval);
  }
  if (patch.qualifier !== undefined) {
    for (const key of Object.keys(draft)) {
      if (key.startsWith('qualifier')) delete draft[key];
    }
    Object.assign(draft, patch.qualifier);
  }
  const result = StreakRule.parse(draft as unknown as StreakRule);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

/** The head's name a patch names, or the recommended one. */
const nameOf = (patch: Patch): LocalizedText =>
  patch.name ?? StreakRule.DEFAULT_NAME;

const fixed = (days: number): StreakIntervalRule =>
  StreakIntervalRule.fixed(days);

const PERSONAL = {
  streakInterval: StreakInterval.Personal,
  intervalTolerancePct: 50,
  intervalMinDays: 21,
  intervalMaxDays: 70,
  intervalFallbackDays: 42,
} as const satisfies StreakIntervalRule;

/* Each part, as the base holds it — what a part's patch changes figures of. */
const BASE_PROTECTIONS = {
  enabled: true,
  maxBanked: 2,
  earnEvery: 5,
  startWith: 0,
};
const BASE_REPAIR = { enabled: true, windowDays: 14, perYear: 1 };
const BASE_HOLD = { enabled: true, maxDaysPastDue: 14 };
const BASE_PAUSE = { enabled: false, maxDaysPerYear: 90 };

const protections = (patch: Partial<typeof BASE_PROTECTIONS>): Patch => ({
  protections: { ...BASE_PROTECTIONS, ...patch },
});
const repair = (patch: Partial<typeof BASE_REPAIR>): Patch => ({
  repair: { ...BASE_REPAIR, ...patch },
});
const hold = (patch: Partial<typeof BASE_HOLD>): Patch => ({
  bookingHold: { ...BASE_HOLD, ...patch },
});
const pause = (patch: Partial<typeof BASE_PAUSE>): Patch => ({
  clientPause: { ...BASE_PAUSE, ...patch },
});

/** The head's waiting element, or `null`, and its element in force — for the cases that read the head. */
const scheduledOf = (head: StreakSchedule) => StreakRuleSystem.scheduled(head);
const currentOf = (head: StreakSchedule) => StreakRuleSystem.current(head);

// ── streak-schedule.spec.ts ──────────────────────────────────────────────

const CURRENT = rule();
const NEXT = rule({
  version: 4,
  effectiveFrom: '2026-10-01',
  interval: fixed(35),
});

const waiting = (
  definition: StreakRule,
  streakTransition: StreakTransition,
): ScheduledStreakRule => ({ ...definition, streakTransition });

/** A rule as the head holds it in force: the rule alone, its role, no transition. */
const asCurrent = (definition: StreakRule) => ({
  ...StreakRule.of(definition),
  headRole: HeadRole.Current,
  streakTransition: null,
});

/** A rule as the head holds it waiting, with what it does to the runs that exist. */
const asScheduled = (
  definition: StreakRule,
  streakTransition: StreakTransition,
) => ({
  ...StreakRule.of(definition),
  headRole: HeadRole.Scheduled,
  streakTransition,
});

function schedule(
  scheduled: ScheduledStreakRule | null = waiting(
    NEXT,
    StreakTransition.Grandfather,
  ),
  current: StreakRule = CURRENT,
): StreakSchedule {
  const result = StreakRuleSystem.schedule(current, scheduled);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

/** Each fault as `code field` (the code past its dictionary's prefix), in the order they were found. */
function faults(
  definition: StreakRule,
  transition: StreakTransition = StreakTransition.Grandfather,
): string[] {
  const result = StreakRuleSystem.schedule(
    CURRENT,
    waiting(definition, transition),
  );
  return result.ok
    ? []
    : result.error.map(
        (e) =>
          `${e.errorCode.replace(/^ENGAGEMENT_STREAK_(SCHEDULE|DEFINITION)_/, '').toLowerCase()} ${e.field}`,
      );
}

describe('StreakRuleSystem.schedule', () => {
  it('holds the rule in force alone', () => {
    const head = schedule(null);
    expect(head.rules).toHaveLength(1);
    expect(currentOf(head)).toEqual(asCurrent(CURRENT));
    expect(scheduledOf(head)).toBeNull();
  });

  it('holds the rule in force and the one that waits', () => {
    const head = schedule();
    expect(head.rules).toEqual([
      asCurrent(CURRENT),
      asScheduled(NEXT, StreakTransition.Grandfather),
    ]);
    expect(currentOf(head)).toEqual(asCurrent(CURRENT));
    expect(scheduledOf(head)).toEqual(
      asScheduled(NEXT, StreakTransition.Grandfather),
    );
  });

  it.each(['GRANDFATHER', 'RECOMPUTE'] as const)(
    'takes the transition %s',
    (transition) => {
      expect(faults(NEXT, transition)).toEqual([]);
    },
  );

  it.each([3, 2])('refuses version %s after version 3', (version) => {
    const result = StreakRuleSystem.schedule(
      CURRENT,
      waiting(
        rule({ version, effectiveFrom: '2026-10-01' }),
        StreakTransition.Grandfather,
      ),
    );
    expect(!result.ok && result.error).toHaveLength(1);
    expect(!result.ok && result.error[0]).toMatchObject({
      errorCode: 'ENGAGEMENT_STREAK_SCHEDULE_VERSION_NOT_RISING',
      field: 'scheduledVersion',
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
        waiting(
          rule({ version: 4, effectiveFrom }),
          StreakTransition.Grandfather,
        ),
      );
      expect(!result.ok && result.error).toHaveLength(1);
      expect(!result.ok && result.error[0]).toMatchObject({
        errorCode: 'ENGAGEMENT_STREAK_SCHEDULE_SCHEDULED_NOT_AFTER_CURRENT',
        field: 'scheduledEffectiveFromLocalDate',
        value: effectiveFrom,
        currentEffectiveFromLocalDate: '2026-09-01',
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
      errorCode: 'ENGAGEMENT_STREAK_DEFINITION_UNKNOWN_OPTION',
      field: 'scheduledStreakTransition',
      value: 'forget',
      options: 'GRANDFATHER, RECOMPUTE',
    });
  });

  it('reports every fault at once', () => {
    expect(
      faults(
        rule({ version: 1, effectiveFrom: '2026-01-01' }),
        'forget' as string as StreakTransition,
      ),
    ).toEqual([
      'version_not_rising scheduledVersion',
      'scheduled_not_after_current scheduledEffectiveFromLocalDate',
      'unknown_option scheduledStreakTransition',
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
      expect(StreakRuleSystem.inForceOn(head, localDate(today)).version).toBe(
        inForce,
      );
      expect(
        StreakRuleSystem.upcomingOn(head, localDate(today))?.version ?? null,
      ).toBe(upcoming);
    },
  );

  it('hands the waiting rule over with what it does to the runs that exist', () => {
    expect(
      StreakRuleSystem.upcomingOn(
        schedule(waiting(NEXT, StreakTransition.Recompute)),
        localDate('2026-09-29'),
      ),
    ).toEqual(asScheduled(NEXT, StreakTransition.Recompute));
  });

  it('with nothing waiting, the rule in force is the rule on any day', () => {
    const head = schedule(null);
    for (const today of ['2026-09-01', '2026-09-29', '2030-01-01']) {
      expect(StreakRuleSystem.inForceOn(head, localDate(today))).toEqual(
        asCurrent(CURRENT),
      );
      expect(StreakRuleSystem.upcomingOn(head, localDate(today))).toBeNull();
    }
  });

  it('a first rule that has not begun yet is still the only rule there is', () => {
    expect(
      StreakRuleSystem.inForceOn(schedule(null), localDate('2026-08-15')),
    ).toEqual(asCurrent(CURRENT));
  });

  it('hands a rule that is off over as the rule in force: the reader asks it', () => {
    const off = rule({
      version: 4,
      effectiveFrom: '2026-10-01',
      enabled: false,
    });
    const head = schedule(waiting(off, StreakTransition.Grandfather));
    expect(
      StreakRuleSystem.inForceOn(head, localDate('2026-09-30')).enabled,
    ).toBe(true);
    expect(
      StreakRuleSystem.inForceOn(head, localDate('2026-10-01')).enabled,
    ).toBe(false);
  });
});

describe('StreakRuleSystem.earliestEffectiveDay', () => {
  const TODAY = localDate('2026-09-29');
  const change = (direction: StreakRuleDirection): StreakRuleChange => ({
    direction,
    changed: [],
  });
  const unseen = { clientsSeeRhythm: false, noticeDays: 30 };
  const seen = { clientsSeeRhythm: true, noticeDays: 30 };

  it.each<[StreakRuleDirection, typeof seen, string, string]>([
    ['NEUTRAL', unseen, '2026-09-29', 'today'],
    ['NEUTRAL', seen, '2026-09-29', 'today'],
    ['LOOSER', unseen, '2026-09-30', 'tomorrow'],
    ['LOOSER', seen, '2026-09-30', 'tomorrow'],
    ['SWITCH', unseen, '2026-09-30', 'tomorrow'],
    ['SWITCH', seen, '2026-09-30', 'tomorrow'],
    ['STRICTER', unseen, '2026-09-30', 'tomorrow'],
    ['MIXED', unseen, '2026-09-30', 'tomorrow'],
    ['STRICTER', seen, '2026-10-29', 'a notice period ahead'],
    ['MIXED', seen, '2026-10-29', 'a notice period ahead'],
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
          change('STRICTER').direction,
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
    expect(stricter.direction).toBe('STRICTER');
    expect(
      StreakRuleSystem.earliestEffectiveDay(stricter.direction, TODAY, seen),
    ).toBe('2026-10-29');
  });
});

describe('addDays — the civil day count the schedule moves by (LocalDate)', () => {
  const addDays = (day: string, days: number): string =>
    LocalDate.addDays(localDate(day), days);

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
      interval: { streakInterval: 'FIXED', intervalDays: 42 },
      graceDays: 7,
      protections: { maxBanked: 2, earnEvery: 5 },
      shopExcuses: true,
      hold: { maxDaysPastDue: 14 },
      repair: { windowDays: 14 },
      holdsCount: false,
      qualifier: { streakQualifier: 'ANY_VISIT' },
    });
  });

  it('states a personal interval and a list of services as they are', () => {
    const summary = StreakRuleSystem.summary(
      rule({
        interval: PERSONAL,
        qualifier: StreakQualifierRule.services([
          ServiceId.of('svc-fade'),
          ServiceId.of('svc-beard'),
        ]),
      }),
    );
    expect(summary.interval).toEqual(PERSONAL);
    expect(summary.qualifier).toEqual({
      streakQualifier: 'SERVICES',
      qualifierServiceIds: ['svc-fade', 'svc-beard'],
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
      { onBreak: 'HOLD' },
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
      ['SHOP_CLOSURE', 'BARBER_ABSENCE', 'STAFF_CANCELLED'],
      true,
    ],
    ['those and the closed days', [...STREAK_EXCUSES], true],
    [
      'all but the staff’s own cancel',
      ['SHOP_CLOSURE', 'BARBER_ABSENCE'],
      false,
    ],
    ['the closed days alone', ['CLOSED_DAYS'], false],
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
    (summary.interval as { intervalMinDays: number }).intervalMinDays = 14;
    expect(StreakRuleSystem.summary(made).interval).toEqual(PERSONAL);
  });
});

describe('StreakRuleSystem.changeFrom', () => {
  const services = (...serviceIds: string[]): Patch => ({
    qualifier: StreakQualifierRule.services(
      serviceIds.map((id) => ServiceId.of(id)),
    ),
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
    ['nothing', {}, {}, 'NEUTRAL', []],
    [
      'a new version and day alone',
      {},
      { version: 4, effectiveFrom: '2026-10-01' },
      'NEUTRAL',
      [],
    ],
    [
      'the name',
      {},
      { name: { bg: 'Ритъм', en: 'Rhythm' } },
      'NEUTRAL',
      ['NAME'],
    ],
    ['the cue', {}, { riskLeadDays: 14 }, 'NEUTRAL', ['RISK_LEAD_DAYS']],

    ['a longer interval', {}, { interval: fixed(49) }, 'LOOSER', ['INTERVAL']],
    [
      'a shorter interval',
      {},
      { interval: fixed(35) },
      'STRICTER',
      ['INTERVAL'],
    ],
    [
      'more tolerance',
      { interval: PERSONAL },
      { interval: { ...PERSONAL, intervalTolerancePct: 75 } },
      'LOOSER',
      ['INTERVAL'],
    ],
    [
      'less tolerance',
      { interval: PERSONAL },
      { interval: { ...PERSONAL, intervalTolerancePct: 25 } },
      'STRICTER',
      ['INTERVAL'],
    ],
    [
      'a higher floor',
      { interval: PERSONAL },
      { interval: { ...PERSONAL, intervalMinDays: 28 } },
      'LOOSER',
      ['INTERVAL'],
    ],
    [
      'a lower ceiling',
      { interval: PERSONAL },
      { interval: { ...PERSONAL, intervalMaxDays: 56 } },
      'STRICTER',
      ['INTERVAL'],
    ],
    [
      'a longer newcomer’s interval',
      { interval: PERSONAL },
      { interval: { ...PERSONAL, intervalFallbackDays: 49 } },
      'LOOSER',
      ['INTERVAL'],
    ],
    [
      'a higher floor under a lower ceiling',
      { interval: PERSONAL },
      { interval: { ...PERSONAL, intervalMinDays: 28, intervalMaxDays: 56 } },
      'MIXED',
      ['INTERVAL'],
    ],
    [
      'a habit that starts where the fixed one ended',
      {},
      {
        interval: {
          ...PERSONAL,
          intervalMinDays: 42,
          intervalFallbackDays: 42,
        },
      },
      'LOOSER',
      ['INTERVAL'],
    ],
    [
      'a habit that ends where the fixed one stood',
      {},
      { interval: { ...PERSONAL, intervalMaxDays: 42 } },
      'STRICTER',
      ['INTERVAL'],
    ],
    [
      'a habit around the fixed one',
      {},
      { interval: PERSONAL },
      'MIXED',
      ['INTERVAL'],
    ],
    [
      'one number past every habit',
      { interval: PERSONAL },
      { interval: fixed(70) },
      'LOOSER',
      ['INTERVAL'],
    ],
    [
      'one number under every habit',
      { interval: PERSONAL },
      { interval: fixed(21), graceDays: 7 },
      'STRICTER',
      ['INTERVAL'],
    ],
    [
      'one number inside the habits',
      { interval: PERSONAL },
      { interval: fixed(42) },
      'MIXED',
      ['INTERVAL'],
    ],
    [
      'a habit clamped to the one number it replaces',
      {},
      {
        interval: {
          ...PERSONAL,
          intervalMinDays: 42,
          intervalMaxDays: 42,
          intervalFallbackDays: 42,
        },
      },
      'NEUTRAL',
      ['INTERVAL'],
    ],

    ['more grace', {}, { graceDays: 10 }, 'LOOSER', ['GRACE_DAYS']],
    ['less grace', {}, { graceDays: 3 }, 'STRICTER', ['GRACE_DAYS']],
    [
      'a shorter minimum gap',
      {},
      { minGapDays: 3 },
      'LOOSER',
      ['MIN_GAP_DAYS'],
    ],
    [
      'a longer minimum gap',
      {},
      { minGapDays: 10 },
      'STRICTER',
      ['MIN_GAP_DAYS'],
    ],

    [
      'a wider hold',
      {},
      hold({ maxDaysPastDue: 21 }),
      'LOOSER',
      ['BOOKING_HOLD'],
    ],
    [
      'a narrower hold',
      {},
      hold({ maxDaysPastDue: 7 }),
      'STRICTER',
      ['BOOKING_HOLD'],
    ],
    [
      'the hold switched on',
      hold({ enabled: false }),
      {},
      'LOOSER',
      ['BOOKING_HOLD'],
    ],
    [
      'the hold switched off',
      {},
      hold({ enabled: false }),
      'STRICTER',
      ['BOOKING_HOLD'],
    ],
    [
      'a figure of a hold that stays off',
      hold({ enabled: false }),
      hold({ enabled: false, maxDaysPastDue: 28 }),
      'NEUTRAL',
      ['BOOKING_HOLD'],
    ],
    [
      'a hold of no day switched off',
      hold({ maxDaysPastDue: 0 }),
      hold({ enabled: false, maxDaysPastDue: 0 }),
      'NEUTRAL',
      ['BOOKING_HOLD'],
    ],

    [
      'a larger reserve',
      {},
      protections({ maxBanked: 3 }),
      'LOOSER',
      ['PROTECTIONS'],
    ],
    [
      'a smaller reserve',
      {},
      protections({ maxBanked: 1 }),
      'STRICTER',
      ['PROTECTIONS'],
    ],
    [
      'protections earned faster',
      {},
      protections({ earnEvery: 4 }),
      'LOOSER',
      ['PROTECTIONS'],
    ],
    [
      'protections earned slower',
      {},
      protections({ earnEvery: 8 }),
      'STRICTER',
      ['PROTECTIONS'],
    ],
    [
      'a first protection with the first visit',
      {},
      protections({ startWith: 1 }),
      'LOOSER',
      ['PROTECTIONS'],
    ],
    [
      'a larger reserve earned slower',
      {},
      protections({ maxBanked: 3, earnEvery: 8 }),
      'MIXED',
      ['PROTECTIONS'],
    ],
    [
      'protections switched off',
      {},
      protections({ enabled: false }),
      'STRICTER',
      ['PROTECTIONS'],
    ],
    [
      'protections switched on',
      protections({ enabled: false }),
      {},
      'LOOSER',
      ['PROTECTIONS'],
    ],
    [
      'a figure of protections that stay off',
      protections({ enabled: false }),
      protections({ enabled: false, earnEvery: 3 }),
      'NEUTRAL',
      ['PROTECTIONS'],
    ],
    [
      'an empty reserve filled, earned slower',
      protections({ maxBanked: 0 }),
      protections({ maxBanked: 1, earnEvery: 10 }),
      'LOOSER',
      ['PROTECTIONS'],
    ],

    [
      'an excuse added',
      {},
      { excuses: [...STREAK_EXCUSES] },
      'LOOSER',
      ['EXCUSES'],
    ],
    [
      'an excuse removed',
      {},
      { excuses: ['SHOP_CLOSURE', 'BARBER_ABSENCE'] },
      'STRICTER',
      ['EXCUSES'],
    ],
    [
      'one excuse for another',
      {},
      { excuses: ['SHOP_CLOSURE', 'BARBER_ABSENCE', 'CLOSED_DAYS'] },
      'MIXED',
      ['EXCUSES'],
    ],
    [
      'the excuses said in another order',
      {},
      { excuses: ['STAFF_CANCELLED', 'SHOP_CLOSURE', 'BARBER_ABSENCE'] },
      'NEUTRAL',
      [],
    ],

    [
      'the client’s pause switched on',
      {},
      pause({ enabled: true }),
      'LOOSER',
      ['CLIENT_PAUSE'],
    ],
    [
      'the client’s pause switched off',
      pause({ enabled: true }),
      {},
      'STRICTER',
      ['CLIENT_PAUSE'],
    ],
    [
      'a shorter pause',
      pause({ enabled: true }),
      pause({ enabled: true, maxDaysPerYear: 30 }),
      'STRICTER',
      ['CLIENT_PAUSE'],
    ],
    [
      'a figure of a pause that stays off',
      {},
      pause({ maxDaysPerYear: 30 }),
      'NEUTRAL',
      ['CLIENT_PAUSE'],
    ],

    ['a longer way back', {}, repair({ windowDays: 21 }), 'LOOSER', ['REPAIR']],
    [
      'a shorter way back',
      {},
      repair({ windowDays: 7 }),
      'STRICTER',
      ['REPAIR'],
    ],
    ['more ways back a year', {}, repair({ perYear: 2 }), 'LOOSER', ['REPAIR']],
    [
      'a longer way back, fewer a year',
      repair({ perYear: 2 }),
      repair({ windowDays: 30, perYear: 1 }),
      'MIXED',
      ['REPAIR'],
    ],
    [
      'the way back switched off',
      {},
      repair({ enabled: false }),
      'STRICTER',
      ['REPAIR'],
    ],
    [
      'the way back switched on',
      repair({ enabled: false }),
      {},
      'LOOSER',
      ['REPAIR'],
    ],
    [
      'a figure of a way back that stays off',
      repair({ enabled: false }),
      repair({ enabled: false, windowDays: 30 }),
      'NEUTRAL',
      ['REPAIR'],
    ],

    [
      'a miss that holds the count',
      {},
      { onBreak: 'HOLD' },
      'LOOSER',
      ['ON_BREAK'],
    ],
    [
      'a miss that starts over',
      { onBreak: 'HOLD' },
      {},
      'STRICTER',
      ['ON_BREAK'],
    ],
    [
      'a miss that holds the count, the way back gone with it',
      {},
      { onBreak: 'HOLD', ...repair({ enabled: false }) },
      'LOOSER',
      ['REPAIR', 'ON_BREAK'],
    ],
    [
      'a way back under a count that is held',
      { onBreak: 'HOLD' },
      { onBreak: 'HOLD', ...repair({ windowDays: 7 }) },
      'NEUTRAL',
      ['REPAIR'],
    ],

    [
      'any visit narrowed to chosen services',
      {},
      services('svc-fade'),
      'STRICTER',
      ['QUALIFIER'],
    ],
    [
      'chosen services widened to any visit',
      services('svc-fade'),
      {},
      'LOOSER',
      ['QUALIFIER'],
    ],
    [
      'a service added',
      services('svc-fade'),
      services('svc-fade', 'svc-beard'),
      'LOOSER',
      ['QUALIFIER'],
    ],
    [
      'a service removed',
      services('svc-fade', 'svc-beard'),
      services('svc-beard'),
      'STRICTER',
      ['QUALIFIER'],
    ],
    [
      'one service for another',
      services('svc-fade'),
      services('svc-beard'),
      'MIXED',
      ['QUALIFIER'],
    ],
    [
      'services for categories',
      services('svc-fade'),
      {
        qualifier: StreakQualifierRule.categories([
          ServiceCategoryId.of('cat-hair'),
        ]),
      },
      'MIXED',
      ['QUALIFIER'],
    ],
    [
      'the services said in another order',
      services('svc-fade', 'svc-beard'),
      services('svc-beard', 'svc-fade'),
      'NEUTRAL',
      [],
    ],

    [
      'more grace and a shorter interval',
      {},
      { graceDays: 10, interval: fixed(35) },
      'MIXED',
      ['INTERVAL', 'GRACE_DAYS'],
    ],
    [
      'more grace and a longer interval',
      {},
      { graceDays: 10, interval: fixed(49) },
      'LOOSER',
      ['INTERVAL', 'GRACE_DAYS'],
    ],
    [
      'less grace and another cue',
      {},
      { graceDays: 3, riskLeadDays: 3 },
      'STRICTER',
      ['GRACE_DAYS', 'RISK_LEAD_DAYS'],
    ],

    ['the rule switched off', {}, { enabled: false }, 'SWITCH', ['ENABLED']],
    ['the rule switched on', { enabled: false }, {}, 'SWITCH', ['ENABLED']],
    [
      'the rule switched off, whatever moved with it',
      {},
      { enabled: false, graceDays: 0 },
      'SWITCH',
      ['ENABLED', 'GRACE_DAYS'],
    ],
    [
      'a figure of a rule that stays off',
      { enabled: false },
      { enabled: false, graceDays: 10 },
      'LOOSER',
      ['GRACE_DAYS'],
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
      'LOOSER',
    );
    expect(StreakRuleSystem.changeFrom(before, after, false).direction).toBe(
      'STRICTER',
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
          excuses: ['STAFF_CANCELLED', 'BARBER_ABSENCE', 'SHOP_CLOSURE'],
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
      { qualifier: StreakQualifierRule.services([ServiceId.of('svc-fade')]) },
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
    ['another miss', { onBreak: 'HOLD' }],
  ])('differs from %s', (_, patch) => {
    expect(StreakRuleSystem.equals(rule(patch), rule())).toBe(false);
    expect(StreakRuleSystem.equals(rule(), rule(patch))).toBe(false);
  });
});

describe('StreakRuleSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const current = deepFreeze(rule());
    const next = deepFreeze(
      waiting(
        rule({ version: 4, effectiveFrom: '2026-10-01' }),
        StreakTransition.Grandfather,
      ),
    );
    const head = deepFreeze(schedule(next, current));
    const today = localDate('2026-09-29');
    const once = [
      StreakRuleSystem.schedule(current, next),
      StreakRuleSystem.inForceOn(head, today),
      StreakRuleSystem.upcomingOn(head, today),
      StreakRuleSystem.changeFrom(next, current, true),
      StreakRuleSystem.summary(next),
      StreakRuleSystem.earliestEffectiveDay('STRICTER', today, {
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
      StreakRuleSystem.earliestEffectiveDay('STRICTER', today, {
        clientsSeeRhythm: true,
        noticeDays: 30,
      }),
    ];
    expect(twice).toEqual(once);
  });
});
