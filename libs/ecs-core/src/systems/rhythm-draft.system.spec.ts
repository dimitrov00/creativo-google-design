import { describe, expect, it } from 'vitest';
import {
  StreakInterval,
  StreakIntervalRule,
  StreakQualifier,
  StreakQualifierRule,
  StreakExcuse,
  StreakOnBreak,
  StreakRule,
} from '@core/components';
import { ServiceCategoryId, ServiceId } from '@core/primitives';
import { deepFreeze } from '@core/testing';
import {
  RhythmDraftSystem,
  type RememberedIntervals,
  type RhythmIntervalPatch,
  type RhythmPatch,
} from './rhythm-draft.system';

/*
 * The pure cases of libs/features/admin/loyalty/src/lib/admin-rhythm.store.spec.ts,
 * COPIED (the store's spec keeps running against its shim): every case of
 * `patchedRhythmDraft` (→ `RhythmDraftSystem.clamp`) and `rhythmBoundsOf`
 * (→ `bounds`). Re-targeted: the draft is the FLAT `StreakRule` (a
 * version's id and name are the head's, not the draft's — the identity case
 * checks `version` and `effectiveFromLocalDate`), a change is written as a
 * page writes it (each part's figures together) and made strict and flat by
 * `strict` (absent is `null`), and the cue's menu is handed in. The parts
 * are read back off the flat rule by the projections below, so every
 * expectation keeps its shape. The other 94 cases of that spec are the
 * store's own behaviour (TestBed: reads, saves, the preview's timer, the
 * words) and stay with it. After them: `diff` (the store's `touchedOf`),
 * `weeksOf`/`daysOf` (admin-rhythm.words.ts) and the purity case.
 */

/** The page's menu for the cue (`ADMIN_RHYTHM_CHOICES.riskLeadDays`). */
const RISK_LEAD_CHOICES = [0, 3, 7, 14] as const;

type LooseInterval =
  | {
      readonly streakInterval: typeof StreakInterval.Fixed;
      readonly intervalDays?: number;
    }
  | {
      readonly streakInterval: typeof StreakInterval.Personal;
      readonly intervalTolerancePct?: number;
      readonly intervalMinDays?: number;
      readonly intervalMaxDays?: number;
      readonly intervalFallbackDays?: number;
    };

/** A change as the page writes one: only what moves, each part's figures together. */
type AdminRhythmPatch = {
  readonly enabled?: boolean;
  readonly qualifier?: StreakQualifierRule;
  readonly minGapDays?: number;
  readonly bookingHold?: {
    readonly enabled?: boolean;
    readonly maxDaysPastDue?: number;
  };
  readonly interval?: LooseInterval;
  readonly graceDays?: number;
  readonly riskLeadDays?: number;
  readonly protections?: {
    readonly enabled?: boolean;
    readonly maxBanked?: number;
    readonly earnEvery?: number;
    readonly startWith?: number;
  };
  readonly excuses?: readonly StreakExcuse[];
  readonly clientPause?: {
    readonly enabled?: boolean;
    readonly maxDaysPerYear?: number;
  };
  readonly repair?: {
    readonly enabled?: boolean;
    readonly windowDays?: number;
    readonly perYear?: number;
  };
  readonly onBreak?: StreakOnBreak;
};

function intervalPatch(interval: LooseInterval): RhythmIntervalPatch {
  return interval.streakInterval === StreakInterval.Fixed
    ? {
        streakInterval: StreakInterval.Fixed,
        intervalDays: interval.intervalDays ?? null,
      }
    : {
        streakInterval: StreakInterval.Personal,
        intervalTolerancePct: interval.intervalTolerancePct ?? null,
        intervalMinDays: interval.intervalMinDays ?? null,
        intervalMaxDays: interval.intervalMaxDays ?? null,
        intervalFallbackDays: interval.intervalFallbackDays ?? null,
      };
}

/** Every field present and flat: what the system reads. */
function strict(patch: AdminRhythmPatch): RhythmPatch {
  return {
    enabled: patch.enabled ?? null,
    qualifier: patch.qualifier ?? null,
    minGapDays: patch.minGapDays ?? null,
    bookingHoldEnabled: patch.bookingHold?.enabled ?? null,
    bookingHoldMaxDaysPastDue: patch.bookingHold?.maxDaysPastDue ?? null,
    interval:
      patch.interval === undefined ? null : intervalPatch(patch.interval),
    graceDays: patch.graceDays ?? null,
    riskLeadDays: patch.riskLeadDays ?? null,
    protectionsEnabled: patch.protections?.enabled ?? null,
    protectionsMaxBanked: patch.protections?.maxBanked ?? null,
    protectionsEarnEvery: patch.protections?.earnEvery ?? null,
    protectionsStartWith: patch.protections?.startWith ?? null,
    excuses: patch.excuses ?? null,
    clientPauseEnabled: patch.clientPause?.enabled ?? null,
    clientPauseMaxDaysPerYear: patch.clientPause?.maxDaysPerYear ?? null,
    repairEnabled: patch.repair?.enabled ?? null,
    repairWindowDays: patch.repair?.windowDays ?? null,
    repairPerYear: patch.repair?.perYear ?? null,
    onBreak: patch.onBreak ?? null,
  };
}

/** The legacy `patchedRhythmDraft`, re-targeted. */
function patchedRhythmDraft(
  draft: StreakRule,
  patch: AdminRhythmPatch,
  remembered: Partial<RememberedIntervals> = {},
): StreakRule {
  return RhythmDraftSystem.clamp(
    draft,
    strict(patch),
    {
      fixed: remembered.fixed ?? null,
      personal: remembered.personal ?? null,
    },
    RISK_LEAD_CHOICES,
  );
}

const rhythmBoundsOf = RhythmDraftSystem.bounds;

const fixed = (intervalDays: number): LooseInterval => ({
  streakInterval: StreakInterval.Fixed,
  intervalDays,
});
const personal = (
  figures: Omit<
    Extract<LooseInterval, { streakInterval: 'PERSONAL' }>,
    'streakInterval'
  > = {},
): LooseInterval => ({ streakInterval: StreakInterval.Personal, ...figures });

/* The rule's parts, read back off the flat rule — the shapes the cases assert. */
const intervalOf = (rule: StreakRule) => StreakIntervalRule.of(rule);
const qualifierOf = (rule: StreakRule) => StreakQualifierRule.of(rule);
const holdOf = (rule: StreakRule) => ({
  enabled: rule.bookingHoldEnabled,
  maxDaysPastDue: rule.bookingHoldMaxDaysPastDue,
});
const protectionsOf = (rule: StreakRule) => ({
  enabled: rule.protectionsEnabled,
  maxBanked: rule.protectionsMaxBanked,
  earnEvery: rule.protectionsEarnEvery,
  startWith: rule.protectionsStartWith,
});
const pauseOf = (rule: StreakRule) => ({
  enabled: rule.clientPauseEnabled,
  maxDaysPerYear: rule.clientPauseMaxDaysPerYear,
});
const repairOf = (rule: StreakRule) => ({
  enabled: rule.repairEnabled,
  windowDays: rule.repairWindowDays,
  perYear: rule.repairPerYear,
});

const RECOMMENDED = StreakRule.DEFAULT;
const LONG: AdminRhythmPatch = { interval: fixed(84) };

describe('RhythmDraftSystem.clamp (admin-rhythm.store.spec.ts `patchedRhythmDraft`)', () => {
  const patched = (patch: AdminRhythmPatch, draft: StreakRule = RECOMMENDED) =>
    patchedRhythmDraft(draft, patch);

  it('answers a new draft and leaves the one in hand as it was', () => {
    const before = structuredClone(RECOMMENDED);
    const next = patched({ graceDays: 10 });

    expect(next).not.toBe(RECOMMENDED);
    expect(next.graceDays).toBe(10);
    expect(RECOMMENDED).toEqual(before);
  });

  it('keeps every figure it is not handed', () => {
    expect(patched({})).toEqual(RECOMMENDED);
    expect(patched({ graceDays: 10 })).toEqual({
      ...RECOMMENDED,
      graceDays: 10,
    });
  });

  it('never moves a version’s identity', () => {
    const next = patched({ enabled: false, graceDays: 3 });

    expect(next.version).toBe(RECOMMENDED.version);
    expect(next.effectiveFromLocalDate).toBe(
      RECOMMENDED.effectiveFromLocalDate,
    );
  });

  it.each([
    ['the interval, under two weeks', { interval: fixed(1) }, 14],
    ['the interval, over half a year', { interval: fixed(999) }, 182],
    ['the interval, a fraction', { interval: fixed(42.4) }, 42],
    ['the interval, no number', { interval: fixed(Number.NaN) }, 42],
  ] as const)('clamps %s', (_, patch, days) => {
    expect(intervalOf(patched(patch))).toEqual({
      streakInterval: 'FIXED',
      intervalDays: days,
    });
  });

  it.each([
    ['grace over its range', { graceDays: 30 }, { graceDays: 21 }],
    ['grace under it', { graceDays: -4 }, { graceDays: 0 }],
    ['grace, a fraction', { graceDays: 6.6 }, { graceDays: 7 }],
    [
      'grace, no number',
      { graceDays: Number.POSITIVE_INFINITY },
      { graceDays: 7 },
    ],
    ['the cue under its range', { riskLeadDays: -1 }, { riskLeadDays: 0 }],
    ['the minimum gap over its range', { minGapDays: 99 }, { minGapDays: 14 }],
    ['the minimum gap under it', { minGapDays: -1 }, { minGapDays: 0 }],
  ] as const)('clamps %s', (_, patch, kept) => {
    expect(patched(patch)).toEqual({ ...RECOMMENDED, ...kept });
  });

  it('clamps each part’s figures to the domain’s range', () => {
    expect(holdOf(patched({ bookingHold: { maxDaysPastDue: 99 } }))).toEqual({
      enabled: true,
      maxDaysPastDue: 28,
    });
    expect(holdOf(patched({ bookingHold: { maxDaysPastDue: -5 } }))).toEqual({
      enabled: true,
      maxDaysPastDue: 0,
    });
    expect(
      protectionsOf(patched({ protections: { maxBanked: 9, earnEvery: 0 } })),
    ).toEqual({ enabled: true, maxBanked: 5, earnEvery: 1, startWith: 0 });
    expect(protectionsOf(patched({ protections: { earnEvery: 99 } }))).toEqual({
      enabled: true,
      maxBanked: 2,
      earnEvery: 24,
      startWith: 0,
    });
    expect(
      pauseOf(patched({ clientPause: { enabled: true, maxDaysPerYear: 999 } })),
    ).toEqual({ enabled: true, maxDaysPerYear: 180 });
    expect(
      repairOf(patched({ repair: { windowDays: 0, perYear: 9 } })),
    ).toEqual({
      enabled: true,
      windowDays: 1,
      perYear: 4,
    });
  });

  it('changes one figure of a part and keeps the rest of it', () => {
    expect(holdOf(patched({ bookingHold: { enabled: false } }))).toEqual({
      enabled: false,
      maxDaysPastDue: 14,
    });
    expect(repairOf(patched({ repair: { windowDays: 21 } }))).toEqual({
      enabled: true,
      windowDays: 21,
      perYear: 1,
    });
  });

  it('pulls grace, the cue and the minimum gap under a shorter interval', () => {
    const long = patched({ graceDays: 21, riskLeadDays: 14, minGapDays: 14 });
    const short = patched({ interval: fixed(14) }, long);

    expect(intervalOf(short)).toEqual({
      streakInterval: 'FIXED',
      intervalDays: 14,
    });
    expect(short.graceDays).toBe(13);
    expect(short.minGapDays).toBe(13);
    // The cue is a menu: the longest it offers that fits, never «13 дни».
    expect(short.riskLeadDays).toBe(7);
    expect(RISK_LEAD_CHOICES).toContain(short.riskLeadDays);
  });

  it('leaves them alone under an interval they already fit', () => {
    const next = patched({ interval: fixed(28) });

    expect(next.graceDays).toBe(7);
    expect(next.riskLeadDays).toBe(7);
    expect(next.minGapDays).toBe(7);
  });

  it('holds what a run starts with to what the reserve holds', () => {
    expect(
      patched({ protections: { startWith: 4 } }).protectionsStartWith,
    ).toBe(2);
    const one = patched({ protections: { startWith: 1 } });
    expect(one.protectionsStartWith).toBe(1);
    expect(
      protectionsOf(patched({ protections: { maxBanked: 0 } }, one)),
    ).toEqual({ enabled: true, maxBanked: 0, earnEvery: 5, startWith: 0 });
  });

  it('opens a personal interval on the recommended figures, around the interval it had', () => {
    expect(intervalOf(patched({ interval: personal() }))).toEqual({
      streakInterval: 'PERSONAL',
      intervalTolerancePct: 50,
      intervalMinDays: 21,
      intervalMaxDays: 70,
      intervalFallbackDays: 42,
    });
    // A fixed interval outside the recommended clamp lands on its edge.
    expect(
      intervalOf(patched({ interval: personal() }, patched(LONG))),
    ).toMatchObject({
      intervalMinDays: 21,
      intervalMaxDays: 70,
      intervalFallbackDays: 70,
    });
  });

  it('lets the figure in hand win over the other end of the clamp', () => {
    const open = patched({ interval: personal() });

    expect(
      intervalOf(
        patched({ interval: personal({ intervalMinDays: 84 }) }, open),
      ),
    ).toEqual({
      streakInterval: 'PERSONAL',
      intervalTolerancePct: 50,
      intervalMinDays: 84,
      intervalMaxDays: 84,
      intervalFallbackDays: 84,
    });
    expect(
      intervalOf(
        patched({ interval: personal({ intervalMaxDays: 14 }) }, open),
      ),
    ).toEqual({
      streakInterval: 'PERSONAL',
      intervalTolerancePct: 50,
      intervalMinDays: 14,
      intervalMaxDays: 14,
      intervalFallbackDays: 14,
    });
  });

  it('keeps the newcomer’s interval inside the clamp', () => {
    const open = patched({ interval: personal() });

    expect(
      intervalOf(
        patched({ interval: personal({ intervalFallbackDays: 7 }) }, open),
      ),
    ).toMatchObject({
      intervalMinDays: 21,
      intervalMaxDays: 70,
      intervalFallbackDays: 21,
    });
    expect(
      intervalOf(
        patched({ interval: personal({ intervalFallbackDays: 120 }) }, open),
      ),
    ).toMatchObject({
      intervalMinDays: 21,
      intervalMaxDays: 70,
      intervalFallbackDays: 70,
    });
    expect(
      intervalOf(
        patched({ interval: personal({ intervalTolerancePct: 140 }) }, open),
      ),
    ).toMatchObject({ intervalTolerancePct: 100 });
  });

  it('holds grace under the personal interval’s FLOOR, the shortest period it opens', () => {
    const open = patched({
      interval: personal({ intervalMinDays: 14 }),
      graceDays: 21,
    });

    expect(open.graceDays).toBe(13);
  });

  it('goes back to a fixed interval on the newcomer’s, or on the one it remembers', () => {
    const open = patched({
      interval: personal({ intervalFallbackDays: 56 }),
    });

    expect(
      intervalOf(
        patched({ interval: { streakInterval: StreakInterval.Fixed } }, open),
      ),
    ).toEqual({ streakInterval: 'FIXED', intervalDays: 56 });
    expect(
      intervalOf(
        patchedRhythmDraft(
          open,
          { interval: { streakInterval: StreakInterval.Fixed } },
          { fixed: StreakIntervalRule.fixed(35) },
        ),
      ),
    ).toEqual({ streakInterval: 'FIXED', intervalDays: 35 });
  });

  it('holds the excuses to the rule’s vocabulary, in its order, each once', () => {
    expect(
      patched({
        excuses: [
          StreakExcuse.ClosedDays,
          StreakExcuse.ShopClosure,
          StreakExcuse.ClosedDays,
          'HOLIDAY' as never,
        ],
      }).excuses,
    ).toEqual(['SHOP_CLOSURE', 'CLOSED_DAYS']);
    expect(patched({ excuses: [] }).excuses).toEqual([]);
  });

  it('takes the choice of what counts as it is handed, in a list of its own', () => {
    const serviceIds = [ServiceId.of('svc-fade'), ServiceId.of('svc-beard')];
    const next = patched({
      qualifier: StreakQualifierRule.services(serviceIds),
    });

    expect(qualifierOf(next)).toEqual({
      streakQualifier: 'SERVICES',
      qualifierServiceIds: serviceIds,
    });
    expect(
      next.streakQualifier === StreakQualifier.Services &&
        next.qualifierServiceIds,
    ).not.toBe(serviceIds);
  });

  it('never leaves a rule the domain refuses, whatever figures it is handed', () => {
    // A long walk of wild changes, each over the draft the last one left.
    let seed = 20260928;
    const random = (): number => {
      seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296;
      return seed / 4_294_967_296;
    };
    const wild = (): number => Math.round(random() * 450 - 50) / 2;
    const flip = (): boolean => random() < 0.5;
    const changes: (() => AdminRhythmPatch)[] = [
      () => ({ interval: fixed(wild()) }),
      () => ({ interval: personal({ intervalMinDays: wild() }) }),
      () => ({ interval: personal({ intervalMaxDays: wild() }) }),
      () => ({ interval: personal({ intervalFallbackDays: wild() }) }),
      () => ({ interval: personal({ intervalTolerancePct: wild() }) }),
      () => ({
        interval: flip()
          ? { streakInterval: StreakInterval.Fixed }
          : personal(),
      }),
      () => ({ graceDays: wild(), riskLeadDays: wild() }),
      () => ({ minGapDays: wild() }),
      () => ({ bookingHold: { enabled: flip(), maxDaysPastDue: wild() } }),
      () => ({ protections: { maxBanked: wild(), startWith: wild() } }),
      () => ({ protections: { enabled: flip(), earnEvery: wild() } }),
      () => ({ clientPause: { enabled: flip(), maxDaysPerYear: wild() } }),
      () => ({ repair: { windowDays: wild(), perYear: wild() } }),
      () => ({
        onBreak: flip() ? StreakOnBreak.Hold : StreakOnBreak.Restart,
        enabled: flip(),
      }),
    ];

    let draft: StreakRule = RECOMMENDED;
    for (let step = 0; step < 600; step += 1) {
      const change = changes.at(Math.floor(random() * changes.length));
      if (change === undefined) continue;
      const patch = change();
      draft = patchedRhythmDraft(draft, patch);
      const rule = StreakRule.parse(draft);
      expect(
        rule.ok ? [] : rule.error.map((error) => error.errorCode),
        `step ${step}: ${JSON.stringify(patch)}`,
      ).toEqual([]);
    }
  });
});

describe('RhythmDraftSystem.bounds (admin-rhythm.store.spec.ts `rhythmBoundsOf`)', () => {
  it('holds grace, the cue and the minimum gap under the interval', () => {
    expect(rhythmBoundsOf(RECOMMENDED)).toEqual({
      graceDays: { min: 0, max: 21 },
      riskLeadDays: { min: 0, max: 21 },
      minGapDays: { min: 0, max: 14 },
      startWith: { min: 0, max: 2 },
      fallbackDays: StreakRule.LIMITS.intervalDays,
    });
    expect(
      rhythmBoundsOf(patchedRhythmDraft(RECOMMENDED, { interval: fixed(14) })),
    ).toMatchObject({
      graceDays: { min: 0, max: 13 },
      riskLeadDays: { min: 0, max: 13 },
      minGapDays: { min: 0, max: 13 },
    });
  });

  it('holds the newcomer’s interval inside a personal clamp', () => {
    expect(
      rhythmBoundsOf(patchedRhythmDraft(RECOMMENDED, { interval: personal() })),
    ).toMatchObject({
      graceDays: { min: 0, max: 20 },
      fallbackDays: { min: 21, max: 70 },
    });
  });
});

describe('RhythmDraftSystem.diff (the store’s `touchedOf`)', () => {
  it('names nothing for a draft that is the rule', () => {
    expect(RhythmDraftSystem.diff(RECOMMENDED, RECOMMENDED)).toEqual(
      RhythmDraftSystem.NO_CHANGE,
    );
  });

  it('names each part the admin moved, whole, and nothing else', () => {
    const draft = patchedRhythmDraft(RECOMMENDED, {
      graceDays: 10,
      repair: { windowDays: 21 },
      interval: personal(),
      qualifier: StreakQualifierRule.services([ServiceId.of('svc-fade')]),
      excuses: [StreakExcuse.ShopClosure],
      enabled: false,
      onBreak: StreakOnBreak.Hold,
      minGapDays: 3,
      riskLeadDays: 3,
      bookingHold: { enabled: false },
      protections: { startWith: 1 },
      clientPause: { enabled: true },
    });
    expect(RhythmDraftSystem.diff(draft, RECOMMENDED)).toEqual({
      enabled: false,
      qualifier: {
        streakQualifier: 'SERVICES',
        qualifierServiceIds: ['svc-fade'],
      },
      minGapDays: 3,
      bookingHoldEnabled: false,
      bookingHoldMaxDaysPastDue: 14,
      interval: {
        streakInterval: 'PERSONAL',
        intervalTolerancePct: 50,
        intervalMinDays: 21,
        intervalMaxDays: 70,
        intervalFallbackDays: 42,
      },
      graceDays: 10,
      riskLeadDays: 3,
      protectionsEnabled: true,
      protectionsMaxBanked: 2,
      protectionsEarnEvery: 5,
      protectionsStartWith: 1,
      excuses: ['SHOP_CLOSURE'],
      clientPauseEnabled: true,
      clientPauseMaxDaysPerYear: 90,
      repairEnabled: true,
      repairWindowDays: 21,
      repairPerYear: 1,
      onBreak: 'HOLD',
    });
  });

  it('carries the admin’s changes over another rule: the diff, clamped onto it', () => {
    const draft = patchedRhythmDraft(RECOMMENDED, { graceDays: 10 });
    const moved = patchedRhythmDraft(RECOMMENDED, { interval: fixed(35) });
    const carried = RhythmDraftSystem.clamp(
      moved,
      RhythmDraftSystem.diff(draft, RECOMMENDED),
      RhythmDraftSystem.NOTHING_REMEMBERED,
      RISK_LEAD_CHOICES,
    );
    expect(carried).toMatchObject({
      graceDays: 10,
      streakInterval: 'FIXED',
      intervalDays: 35,
    });
  });

  it('tells a fixed interval moved, and two lists in another order apart', () => {
    expect(
      RhythmDraftSystem.diff(
        patchedRhythmDraft(RECOMMENDED, { interval: fixed(35) }),
        RECOMMENDED,
      ).interval,
    ).toEqual({ streakInterval: 'FIXED', intervalDays: 35 });
    const two = patchedRhythmDraft(RECOMMENDED, {
      qualifier: StreakQualifierRule.categories([
        ServiceCategoryId.of('a'),
        ServiceCategoryId.of('b'),
      ]),
    });
    const swapped = patchedRhythmDraft(RECOMMENDED, {
      qualifier: StreakQualifierRule.categories([
        ServiceCategoryId.of('b'),
        ServiceCategoryId.of('a'),
      ]),
    });
    expect(RhythmDraftSystem.diff(two, swapped).qualifier).toEqual(
      qualifierOf(two),
    );
    expect(RhythmDraftSystem.diff(two, two).qualifier).toBeNull();
    expect(
      RhythmDraftSystem.diff(
        patchedRhythmDraft(RECOMMENDED, {
          qualifier: StreakQualifierRule.services([ServiceId.of('a')]),
        }),
        RECOMMENDED,
      ).qualifier,
    ).toEqual({ streakQualifier: 'SERVICES', qualifierServiceIds: ['a'] });
  });
});

describe('RhythmDraftSystem.weeksOf and daysOf (admin-rhythm.words.ts)', () => {
  it('shows days as the nearest whole number of weeks, and weeks as days', () => {
    expect(RhythmDraftSystem.weeksOf(42)).toBe(6);
    expect(RhythmDraftSystem.weeksOf(45)).toBe(6);
    expect(RhythmDraftSystem.weeksOf(46)).toBe(7);
    expect(RhythmDraftSystem.daysOf(6)).toBe(42);
  });
});

describe('RhythmDraftSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const draft = deepFreeze(
      patchedRhythmDraft(RECOMMENDED, { interval: personal() }),
    );
    const patch = deepFreeze(strict({ interval: fixed(14), graceDays: 30 }));
    const remembered = deepFreeze({
      fixed: StreakIntervalRule.fixed(35),
      personal: null,
    });
    const run = () => [
      RhythmDraftSystem.clamp(draft, patch, remembered, RISK_LEAD_CHOICES),
      RhythmDraftSystem.bounds(draft),
      RhythmDraftSystem.diff(draft, RECOMMENDED),
    ];
    expect(run()).toEqual(run());
  });
});
