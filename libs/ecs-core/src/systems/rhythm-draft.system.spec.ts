import { describe, expect, it } from 'vitest';
import { StreakInterval } from '../components/streak-interval.data';
import type { StreakQualifier } from '../components/streak-qualifier.data';
import { StreakRule, type StreakExcuse } from '../components/streak-rule.data';
import { deepFreeze } from '../testing';
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
 * (→ `bounds`). Re-targeted: the draft is the plain `StreakRule` (a
 * version's id and name are the head's, not the draft's — the identity case
 * checks `version` and `effectiveFromDayKey`), a change is written as the
 * store's page writes it and made strict by `strict` (absent is `null`),
 * and the cue's menu is handed in. The other 94 cases of that spec are the
 * store's own behaviour (TestBed: reads, saves, the preview's timer, the
 * words) and stay with it. After them: `diff` (the store's `touchedOf`),
 * `weeksOf`/`daysOf` (admin-rhythm.words.ts) and the purity case.
 */

/** The page's menu for the cue (`ADMIN_RHYTHM_CHOICES.riskLeadDays`). */
const RISK_LEAD_CHOICES = [0, 3, 7, 14] as const;

type LooseInterval =
  | { readonly kind: 'fixed'; readonly days?: number }
  | {
      readonly kind: 'personal';
      readonly tolerancePct?: number;
      readonly minDays?: number;
      readonly maxDays?: number;
      readonly fallbackDays?: number;
    };

/** A change as the page writes one: only what moves. */
type AdminRhythmPatch = {
  readonly enabled?: boolean;
  readonly qualifier?:
    | { readonly kind: 'anyVisit' }
    | { readonly kind: 'services'; readonly serviceIds: readonly string[] }
    | { readonly kind: 'categories'; readonly categoryIds: readonly string[] };
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
  readonly onBreak?: 'restart' | 'hold';
};

function intervalPatch(interval: LooseInterval): RhythmIntervalPatch {
  return interval.kind === 'fixed'
    ? { kind: 'fixed', days: interval.days ?? null }
    : {
        kind: 'personal',
        tolerancePct: interval.tolerancePct ?? null,
        minDays: interval.minDays ?? null,
        maxDays: interval.maxDays ?? null,
        fallbackDays: interval.fallbackDays ?? null,
      };
}

/** Every part present: what the system reads. */
function strict(patch: AdminRhythmPatch): RhythmPatch {
  return {
    enabled: patch.enabled ?? null,
    qualifier: (patch.qualifier as StreakQualifier | undefined) ?? null,
    minGapDays: patch.minGapDays ?? null,
    bookingHold:
      patch.bookingHold === undefined
        ? null
        : {
            enabled: patch.bookingHold.enabled ?? null,
            maxDaysPastDue: patch.bookingHold.maxDaysPastDue ?? null,
          },
    interval:
      patch.interval === undefined ? null : intervalPatch(patch.interval),
    graceDays: patch.graceDays ?? null,
    riskLeadDays: patch.riskLeadDays ?? null,
    protections:
      patch.protections === undefined
        ? null
        : {
            enabled: patch.protections.enabled ?? null,
            maxBanked: patch.protections.maxBanked ?? null,
            earnEvery: patch.protections.earnEvery ?? null,
            startWith: patch.protections.startWith ?? null,
          },
    excuses: patch.excuses ?? null,
    clientPause:
      patch.clientPause === undefined
        ? null
        : {
            enabled: patch.clientPause.enabled ?? null,
            maxDaysPerYear: patch.clientPause.maxDaysPerYear ?? null,
          },
    repair:
      patch.repair === undefined
        ? null
        : {
            enabled: patch.repair.enabled ?? null,
            windowDays: patch.repair.windowDays ?? null,
            perYear: patch.repair.perYear ?? null,
          },
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

const fixed = (days: number): LooseInterval => ({ kind: 'fixed', days });

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
    expect(next.effectiveFromDayKey).toBe(RECOMMENDED.effectiveFromDayKey);
  });

  it.each([
    ['the interval, under two weeks', { interval: fixed(1) }, 14],
    ['the interval, over half a year', { interval: fixed(999) }, 182],
    ['the interval, a fraction', { interval: fixed(42.4) }, 42],
    ['the interval, no number', { interval: fixed(Number.NaN) }, 42],
  ] as const)('clamps %s', (_, patch, days) => {
    expect(patched(patch).interval).toEqual({ kind: 'fixed', days });
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
    expect(
      patched({ bookingHold: { maxDaysPastDue: 99 } }).bookingHold,
    ).toEqual({ enabled: true, maxDaysPastDue: 28 });
    expect(
      patched({ bookingHold: { maxDaysPastDue: -5 } }).bookingHold,
    ).toEqual({ enabled: true, maxDaysPastDue: 0 });
    expect(
      patched({ protections: { maxBanked: 9, earnEvery: 0 } }).protections,
    ).toEqual({ enabled: true, maxBanked: 5, earnEvery: 1, startWith: 0 });
    expect(patched({ protections: { earnEvery: 99 } }).protections).toEqual({
      enabled: true,
      maxBanked: 2,
      earnEvery: 24,
      startWith: 0,
    });
    expect(
      patched({ clientPause: { enabled: true, maxDaysPerYear: 999 } })
        .clientPause,
    ).toEqual({ enabled: true, maxDaysPerYear: 180 });
    expect(patched({ repair: { windowDays: 0, perYear: 9 } }).repair).toEqual({
      enabled: true,
      windowDays: 1,
      perYear: 4,
    });
  });

  it('changes one figure of a part and keeps the rest of it', () => {
    expect(patched({ bookingHold: { enabled: false } }).bookingHold).toEqual({
      enabled: false,
      maxDaysPastDue: 14,
    });
    expect(patched({ repair: { windowDays: 21 } }).repair).toEqual({
      enabled: true,
      windowDays: 21,
      perYear: 1,
    });
  });

  it('pulls grace, the cue and the minimum gap under a shorter interval', () => {
    const long = patched({ graceDays: 21, riskLeadDays: 14, minGapDays: 14 });
    const short = patched({ interval: fixed(14) }, long);

    expect(short.interval).toEqual({ kind: 'fixed', days: 14 });
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
      patched({ protections: { startWith: 4 } }).protections.startWith,
    ).toBe(2);
    const one = patched({ protections: { startWith: 1 } });
    expect(one.protections.startWith).toBe(1);
    expect(patched({ protections: { maxBanked: 0 } }, one).protections).toEqual(
      { enabled: true, maxBanked: 0, earnEvery: 5, startWith: 0 },
    );
  });

  it('opens a personal interval on the recommended figures, around the interval it had', () => {
    expect(patched({ interval: { kind: 'personal' } }).interval).toEqual({
      kind: 'personal',
      tolerancePct: 50,
      minDays: 21,
      maxDays: 70,
      fallbackDays: 42,
    });
    // A fixed interval outside the recommended clamp lands on its edge.
    expect(
      patched({ interval: { kind: 'personal' } }, patched(LONG)).interval,
    ).toMatchObject({ minDays: 21, maxDays: 70, fallbackDays: 70 });
  });

  it('lets the figure in hand win over the other end of the clamp', () => {
    const personal = patched({ interval: { kind: 'personal' } });

    expect(
      patched({ interval: { kind: 'personal', minDays: 84 } }, personal)
        .interval,
    ).toEqual({
      kind: 'personal',
      tolerancePct: 50,
      minDays: 84,
      maxDays: 84,
      fallbackDays: 84,
    });
    expect(
      patched({ interval: { kind: 'personal', maxDays: 14 } }, personal)
        .interval,
    ).toEqual({
      kind: 'personal',
      tolerancePct: 50,
      minDays: 14,
      maxDays: 14,
      fallbackDays: 14,
    });
  });

  it('keeps the newcomer’s interval inside the clamp', () => {
    const personal = patched({ interval: { kind: 'personal' } });

    expect(
      patched({ interval: { kind: 'personal', fallbackDays: 7 } }, personal)
        .interval,
    ).toMatchObject({ minDays: 21, maxDays: 70, fallbackDays: 21 });
    expect(
      patched({ interval: { kind: 'personal', fallbackDays: 120 } }, personal)
        .interval,
    ).toMatchObject({ minDays: 21, maxDays: 70, fallbackDays: 70 });
    expect(
      patched({ interval: { kind: 'personal', tolerancePct: 140 } }, personal)
        .interval,
    ).toMatchObject({ tolerancePct: 100 });
  });

  it('holds grace under the personal interval’s FLOOR, the shortest period it opens', () => {
    const personal = patched({
      interval: { kind: 'personal', minDays: 14 },
      graceDays: 21,
    });

    expect(personal.graceDays).toBe(13);
  });

  it('goes back to a fixed interval on the newcomer’s, or on the one it remembers', () => {
    const personal = patched({
      interval: { kind: 'personal', fallbackDays: 56 },
    });

    expect(patched({ interval: { kind: 'fixed' } }, personal).interval).toEqual(
      { kind: 'fixed', days: 56 },
    );
    expect(
      patchedRhythmDraft(
        personal,
        { interval: { kind: 'fixed' } },
        { fixed: { kind: 'fixed', days: 35 } },
      ).interval,
    ).toEqual({ kind: 'fixed', days: 35 });
  });

  it('holds the excuses to the rule’s vocabulary, in its order, each once', () => {
    expect(
      patched({
        excuses: [
          'closedDays',
          'shopClosure',
          'closedDays',
          'holiday' as never,
        ],
      }).excuses,
    ).toEqual(['shopClosure', 'closedDays']);
    expect(patched({ excuses: [] }).excuses).toEqual([]);
  });

  it('takes the choice of what counts as it is handed, in a list of its own', () => {
    const serviceIds = ['svc-fade', 'svc-beard'];
    const next = patched({ qualifier: { kind: 'services', serviceIds } });

    expect(next.qualifier).toEqual({ kind: 'services', serviceIds });
    expect(
      next.qualifier.kind === 'services' && next.qualifier.serviceIds,
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
      () => ({ interval: { kind: 'personal', minDays: wild() } }),
      () => ({ interval: { kind: 'personal', maxDays: wild() } }),
      () => ({ interval: { kind: 'personal', fallbackDays: wild() } }),
      () => ({ interval: { kind: 'personal', tolerancePct: wild() } }),
      () => ({ interval: { kind: flip() ? 'fixed' : 'personal' } }),
      () => ({ graceDays: wild(), riskLeadDays: wild() }),
      () => ({ minGapDays: wild() }),
      () => ({ bookingHold: { enabled: flip(), maxDaysPastDue: wild() } }),
      () => ({ protections: { maxBanked: wild(), startWith: wild() } }),
      () => ({ protections: { enabled: flip(), earnEvery: wild() } }),
      () => ({ clientPause: { enabled: flip(), maxDaysPerYear: wild() } }),
      () => ({ repair: { windowDays: wild(), perYear: wild() } }),
      () => ({ onBreak: flip() ? 'hold' : 'restart', enabled: flip() }),
    ];

    let draft = RECOMMENDED;
    for (let step = 0; step < 600; step += 1) {
      const change = changes.at(Math.floor(random() * changes.length));
      if (change === undefined) continue;
      const patch = change();
      draft = patchedRhythmDraft(draft, patch);
      const rule = StreakRule.parse(draft);
      expect(
        rule.ok ? [] : rule.error.map((error) => error.code),
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
      fallbackDays: StreakRule.LIMITS.interval.days,
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
      rhythmBoundsOf(
        patchedRhythmDraft(RECOMMENDED, { interval: { kind: 'personal' } }),
      ),
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
      interval: { kind: 'personal' },
      qualifier: { kind: 'services', serviceIds: ['svc-fade'] },
      excuses: ['shopClosure'],
      enabled: false,
      onBreak: 'hold',
      minGapDays: 3,
      riskLeadDays: 3,
      bookingHold: { enabled: false },
      protections: { startWith: 1 },
      clientPause: { enabled: true },
    });
    expect(RhythmDraftSystem.diff(draft, RECOMMENDED)).toEqual({
      enabled: false,
      qualifier: { kind: 'services', serviceIds: ['svc-fade'] },
      minGapDays: 3,
      bookingHold: { enabled: false, maxDaysPastDue: 14 },
      interval: {
        kind: 'personal',
        tolerancePct: 50,
        minDays: 21,
        maxDays: 70,
        fallbackDays: 42,
      },
      graceDays: 10,
      riskLeadDays: 3,
      protections: { enabled: true, maxBanked: 2, earnEvery: 5, startWith: 1 },
      excuses: ['shopClosure'],
      clientPause: { enabled: true, maxDaysPerYear: 90 },
      repair: { enabled: true, windowDays: 21, perYear: 1 },
      onBreak: 'hold',
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
      interval: { kind: 'fixed', days: 35 },
    });
  });

  it('tells a fixed interval moved, and two lists in another order apart', () => {
    expect(
      RhythmDraftSystem.diff(
        patchedRhythmDraft(RECOMMENDED, { interval: fixed(35) }),
        RECOMMENDED,
      ).interval,
    ).toEqual({ kind: 'fixed', days: 35 });
    const two = patchedRhythmDraft(RECOMMENDED, {
      qualifier: { kind: 'categories', categoryIds: ['a', 'b'] },
    });
    const swapped = patchedRhythmDraft(RECOMMENDED, {
      qualifier: { kind: 'categories', categoryIds: ['b', 'a'] },
    });
    expect(RhythmDraftSystem.diff(two, swapped).qualifier).toEqual(
      two.qualifier,
    );
    expect(RhythmDraftSystem.diff(two, two).qualifier).toBeNull();
    expect(
      RhythmDraftSystem.diff(
        patchedRhythmDraft(RECOMMENDED, {
          qualifier: { kind: 'services', serviceIds: ['a'] },
        }),
        RECOMMENDED,
      ).qualifier,
    ).toEqual({ kind: 'services', serviceIds: ['a'] });
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
      patchedRhythmDraft(RECOMMENDED, { interval: { kind: 'personal' } }),
    );
    const patch = deepFreeze(strict({ interval: fixed(14), graceDays: 30 }));
    const remembered = deepFreeze({
      fixed: StreakInterval.fixed(35),
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
