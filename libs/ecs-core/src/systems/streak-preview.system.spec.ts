import { describe, expect, it } from 'vitest';
import {
  FreezeReason,
  type StreakExcuse,
  StreakIntervalRule,
  StreakOnBreak,
  StreakPeriodMark,
  StreakPhase,
  type StreakPreview,
  StreakPreviewOutcome,
  StreakQualifierRule,
  StreakRule,
  type StreakState,
  type VisitFact,
} from '@core/components';
import {
  AppointmentId,
  ServiceCategoryId,
  ServiceId,
  LocalDate,
  UtcEpochMs,
} from '@core/primitives';
import {
  FIXTURE_TIME_ZONE,
  FIXTURE_TODAY,
  deepFreeze,
  localDate,
  minute,
  unwrapOk,
  utcMs,
} from '@core/testing';
import { StreakPreviewSystem } from './streak-preview.system';
import { StreakRuleSystem } from './streak-rule.system';
import { StreakSystem, type StreakFacts as SystemFacts } from './streak.system';
import { ZonedTimeSystem } from './zoned-time.system';

/** An instant a case names: a safe epoch-ms inside the readable years. */
const instant = (ms: number): UtcEpochMs => unwrapOk(UtcEpochMs.of(ms));

/*
 * The cases of the legacy preview use case's spec (flip 3 deleted it and
 * its use case; this file is their one home), COPIED in Phase 2 and
 * re-targeted: the rules are `StreakRule` structs (`revised` is the
 * recommended rule's next version, parsed), the facts are written as the
 * legacy spec wrote them and made strict by `strict`, the preview is
 * `StreakPreviewSystem.estimate` and `projectStreak` a thin helper over
 * `StreakSystem.project`. Every case body is the legacy one but the
 * `changeFrom` call in one assertion message. Plus the system purity case.
 *
 * Flattened: a rule's patch names its flat fields (`intervalDays`,
 * `protectionsStartWith`), a state's phase is `streakPhase` and its tags
 * SCREAMING, the preview's answer is told by `streakPreviewOutcome`. The
 * system reads no zone: `strict` stamps a visit known by its day with the
 * first instant of that shop day (T3), as the page's boundary does.
 */

const TODAY: string = FIXTURE_TODAY; // 2026-09-28

/**
 * A shop day as the facts carry it: a real one is branded, a corrupt one
 * (a stored value nobody guarded) is passed through as it was written —
 * what the system's own day check is there for.
 */
function day(raw: string): LocalDate {
  const parsed = LocalDate.parse(raw);
  return parsed.ok ? parsed.value : (raw as LocalDate);
}

/** «Today» as the boundary hands it: the day, or `null` for one that is no day (nobody is judged). */
function todayOf(raw: string): LocalDate | null {
  const parsed = LocalDate.parse(raw);
  return parsed.ok ? parsed.value : null;
}

/** The first instant of a visit's shop day, or the epoch for a day that is no day. */
function startOf(raw: string): UtcEpochMs {
  const parsed = LocalDate.parse(raw);
  return parsed.ok
    ? ZonedTimeSystem.startOfLocalDay(parsed.value, FIXTURE_TIME_ZONE)
    : instant(0);
}

/** The facts as the legacy spec writes them. */
type StreakFacts = {
  readonly visits: readonly {
    readonly day: string;
    readonly counted: boolean;
  }[];
  readonly excused: readonly {
    readonly day: string;
    readonly reason: StreakExcuse;
  }[];
  readonly bookings: readonly {
    readonly placedOn: string;
    readonly day: string;
    readonly appointmentId?: string;
  }[];
  readonly pauses: readonly {
    readonly from: string;
    readonly until: string;
    readonly reason: 'PAUSE' | 'CLIENT_PAUSE';
  }[];
  readonly grants: readonly { readonly day: string; readonly count: number }[];
};

function strict(facts: StreakFacts): SystemFacts {
  return {
    visits: facts.visits.map((v) => ({
      localDate: day(v.day),
      counted: v.counted,
      utcEpochMs: startOf(v.day),
    })),
    excused: facts.excused.map((e) => ({
      localDate: day(e.day),
      reason: e.reason,
    })),
    bookings: facts.bookings.map((b) => ({
      placedOn: day(b.placedOn),
      localDate: day(b.day),
      appointmentId:
        b.appointmentId === undefined
          ? null
          : AppointmentId.of(b.appointmentId),
    })),
    pauses: facts.pauses.map((p) => ({
      from: day(p.from),
      until: day(p.until),
      reason: p.reason,
    })),
    grants: facts.grants.map((g) => ({
      localDate: day(g.day),
      count: g.count,
    })),
  };
}

const addDays = (on: string, days: number): string =>
  LocalDate.addDays(localDate(on), days);

function projectStreak(
  rule: StreakRule,
  facts: StreakFacts,
  today: string,
): StreakState | null {
  return StreakSystem.project(
    StreakRule.DEFAULT_DEFINITION_ID,
    rule,
    strict(facts),
    day(today),
  );
}

/** The recommended rule: a visit every 42 days, 7 of grace, the cue 7 days ahead. */
const SIX_WEEKS = StreakRule.DEFAULT;

/** The next version of the recommended rule, `patch` over it. */
function revised(patch: Partial<StreakRule>): StreakRule {
  const rule = StreakRule.parse({
    ...SIX_WEEKS,
    ...patch,
    version: SIX_WEEKS.version + 1,
    effectiveFromLocalDate: localDate(addDays(TODAY, 1)),
  } as StreakRule);
  if (!rule.ok) throw new Error('fixture: no such rule');
  return rule.value;
}

const EIGHT_WEEKS = revised({ intervalDays: 56 });
const FOUR_WEEKS = revised({ intervalDays: 28 });
const OFF = revised({ enabled: false });

/** A person whose worked visits were this many days ago; nothing else is known of them. */
function visited(...daysAgo: readonly number[]): StreakFacts {
  return {
    visits: [...daysAgo]
      .sort((a, b) => b - a)
      .map((days) => ({ day: addDays(TODAY, -days), counted: true })),
    excused: [],
    bookings: [],
    pauses: [],
    grants: [],
  };
}

/**
 * Six people, by the day of their last visit. Under six weeks, a period
 * is due 42 days after the visit and its grace ends 7 days later.
 */
const ON_TIME = visited(10); // due in 32 days
const NEAR_DUE = visited(38); // due in 4 days: the staff's cue, still in rhythm
const LATE = visited(45); // due 3 days ago: in grace until the 49th day
const LAPSED = visited(52); // the grace ended: a miss, and no protection to cover it
const LONG_GONE = visited(200);
const REGULAR = visited(10, 45, 80, 115, 150); // five visits, five weeks apart
const SHOP = [ON_TIME, NEAR_DUE, LATE, LAPSED, LONG_GONE, REGULAR];

function estimate(
  draft: StreakRule,
  clients: readonly StreakFacts[] = SHOP,
  inForce: StreakRule = SIX_WEEKS,
): Extract<StreakPreview, { streakPreviewOutcome: 'ESTIMATE' }> {
  const result = StreakPreviewSystem.estimate(
    inForce,
    draft,
    clients.map(strict),
    todayOf(TODAY),
  );
  if (result.streakPreviewOutcome !== 'ESTIMATE') {
    throw new Error('expected an estimate');
  }
  return result;
}

describe('StreakPreviewSystem.estimate — the admin preview', () => {
  it('stands on the domain’s projector: the people below are where it says they are', () => {
    const phases = SHOP.map(
      (facts) => projectStreak(SIX_WEEKS, facts, TODAY)?.streakPhase,
    );
    expect(phases).toEqual([
      'ACTIVE',
      'AT_RISK',
      'IN_GRACE',
      'BROKEN',
      'BROKEN',
      'ACTIVE',
    ]);
  });

  it('counts every person once under each rule', () => {
    const result = estimate(EIGHT_WEEKS);
    expect(result.clients).toBe(6);
    expect(result.before).toEqual({ inRhythm: 3, inGrace: 1, broken: 2 });
    for (const counts of [result.before, result.after]) {
      if (counts === null) throw new Error('expected both rules on');
      expect(counts.inRhythm + counts.inGrace + counts.broken).toBe(
        result.clients,
      );
    }
  });

  it('counts a run close to its due date, and one a protection or a pause holds, as in rhythm', () => {
    expect(estimate(SIX_WEEKS, [NEAR_DUE]).before).toEqual({
      inRhythm: 1,
      inGrace: 0,
      broken: 0,
    });
    // Paused for the month her due date fell in: the clock did not tick.
    const paused: StreakFacts = {
      ...visited(45),
      pauses: [
        {
          from: addDays(TODAY, -20),
          until: addDays(TODAY, 10),
          reason: 'PAUSE',
        },
      ],
    };
    expect(projectStreak(SIX_WEEKS, paused, TODAY)?.streakPhase).toBe('FROZEN');
    expect(estimate(SIX_WEEKS, [paused]).before).toEqual({
      inRhythm: 1,
      inGrace: 0,
      broken: 0,
    });
  });

  it('shows what a LONGER interval brings back', () => {
    // Eight weeks: due 56 days after the visit, grace until the 63rd.
    expect(estimate(EIGHT_WEEKS)).toEqual({
      streakPreviewOutcome: 'ESTIMATE',
      clients: 6,
      before: { inRhythm: 3, inGrace: 1, broken: 2 },
      after: { inRhythm: 5, inGrace: 0, broken: 1 },
      back: 2,
      out: 0,
    });
  });

  it('shows what a SHORTER interval takes away', () => {
    // Four weeks: due 28 days after the visit, grace until the 35th. The
    // regular, five weeks apart, keeps the run on the last day of grace
    // every time; whoever came 38 days ago is out, past the grace too.
    expect(estimate(FOUR_WEEKS)).toEqual({
      streakPreviewOutcome: 'ESTIMATE',
      clients: 6,
      before: { inRhythm: 3, inGrace: 1, broken: 2 },
      after: { inRhythm: 2, inGrace: 0, broken: 4 },
      back: 0,
      out: 1,
    });
    expect(projectStreak(FOUR_WEEKS, REGULAR, TODAY)).toMatchObject({
      current: 5,
      streakPhase: 'ACTIVE',
    });
    expect(projectStreak(FOUR_WEEKS, NEAR_DUE, TODAY)?.streakPhase).toBe(
      'BROKEN',
    );
  });

  it('counts from the rule in force, whichever that is', () => {
    // From four weeks, twelve bring back everyone but the long gone.
    expect(estimate(revised({ intervalDays: 84 }), SHOP, FOUR_WEEKS)).toEqual({
      streakPreviewOutcome: 'ESTIMATE',
      clients: 6,
      before: { inRhythm: 2, inGrace: 0, broken: 4 },
      after: { inRhythm: 5, inGrace: 0, broken: 1 },
      back: 3,
      out: 0,
    });
  });

  it('counts a change that moves people both ways, each way', () => {
    // In force: six weeks, and a protection from the first visit on.
    // Proposed: eight weeks, no grace, no protections.
    const protectedRule = revised({
      protectionsEnabled: true,
      protectionsMaxBanked: 2,
      protectionsEarnEvery: 5,
      protectionsStartWith: 1,
    });
    const bareRule = revised({
      intervalDays: 56,
      graceDays: 0,
      protectionsEnabled: false,
      protectionsMaxBanked: 2,
      protectionsEarnEvery: 5,
      protectionsStartWith: 0,
    });
    const covered = visited(60); // her protection covered the miss
    const late = visited(45);
    expect(projectStreak(protectedRule, covered, TODAY)).toMatchObject({
      streakPhase: 'FROZEN',
      phaseFreezeReason: 'FREEZE',
    });
    expect(projectStreak(bareRule, covered, TODAY)?.streakPhase).toBe('BROKEN');
    expect(projectStreak(protectedRule, late, TODAY)?.streakPhase).toBe(
      'IN_GRACE',
    );
    expect(projectStreak(bareRule, late, TODAY)?.streakPhase).toBe('ACTIVE');

    expect(estimate(bareRule, [covered, late], protectedRule)).toEqual({
      streakPreviewOutcome: 'ESTIMATE',
      clients: 2,
      before: { inRhythm: 1, inGrace: 1, broken: 0 },
      after: { inRhythm: 1, inGrace: 0, broken: 1 },
      // «В ритъм» reads 1 → 1, and still one came back and one went out.
      back: 1,
      out: 1,
    });
  });

  it('keeps the change of «В ритъм» equal to who came back less who went out', () => {
    for (const draft of [
      EIGHT_WEEKS,
      FOUR_WEEKS,
      revised({ graceDays: 0 }),
      revised({ graceDays: 21 }),
      revised({ riskLeadDays: 0 }),
      revised({ onBreak: 'HOLD' }),
    ]) {
      const result = estimate(draft);
      expect(
        (result.after?.inRhythm ?? 0) - (result.before?.inRhythm ?? 0),
        JSON.stringify(StreakRuleSystem.changeFrom(draft, SIX_WEEKS, false)),
      ).toBe(result.back - result.out);
    }
  });

  it('moves nobody between rhythm and grace for a change only the staff sees', () => {
    expect(estimate(revised({ riskLeadDays: 0 }))).toMatchObject({
      before: { inRhythm: 3, inGrace: 1, broken: 2 },
      after: { inRhythm: 3, inGrace: 1, broken: 2 },
      back: 0,
      out: 0,
    });
  });

  it('shows more grace as people in grace, not as people in rhythm', () => {
    // 21 days of grace: the 52nd day is inside it.
    expect(estimate(revised({ graceDays: 21 }))).toMatchObject({
      after: { inRhythm: 3, inGrace: 2, broken: 1 },
      back: 0,
      out: 0,
    });
  });

  it('agrees with the projector, person by person', () => {
    const standingOf = (rule: StreakRule, facts: StreakFacts) => {
      const phase = projectStreak(rule, facts, TODAY)?.streakPhase;
      if (phase === 'IN_GRACE') return 'inGrace';
      if (phase === 'BROKEN') return 'broken';
      return phase === undefined ? null : 'inRhythm';
    };
    for (const draft of [EIGHT_WEEKS, FOUR_WEEKS]) {
      const standings = SHOP.map((facts) => standingOf(draft, facts));
      const count = (standing: string) =>
        standings.filter((one) => one === standing).length;
      expect(estimate(draft).after).toEqual({
        inRhythm: count('inRhythm'),
        inGrace: count('inGrace'),
        broken: count('broken'),
      });
    }
  });

  describe('who is judged', () => {
    it('leaves out whoever has no visit to judge', () => {
      const nobody = visited();
      const ahead: StreakFacts = {
        ...visited(),
        visits: [{ day: addDays(TODAY, 3), counted: true }],
      };
      const uncounted: StreakFacts = {
        ...visited(),
        visits: [{ day: addDays(TODAY, -10), counted: false }],
      };
      const noDay: StreakFacts = {
        ...visited(),
        visits: [{ day: '2026-02-30', counted: true }],
      };
      expect(
        estimate(EIGHT_WEEKS, [nobody, ahead, uncounted, noDay, ON_TIME]),
      ).toEqual({
        streakPreviewOutcome: 'ESTIMATE',
        clients: 1,
        before: { inRhythm: 1, inGrace: 0, broken: 0 },
        after: { inRhythm: 1, inGrace: 0, broken: 0 },
        back: 0,
        out: 0,
      });
    });

    it('judges a visit made today', () => {
      expect(estimate(EIGHT_WEEKS, [visited(0)]).before).toEqual({
        inRhythm: 1,
        inGrace: 0,
        broken: 0,
      });
    });

    it('estimates an empty shop as nobody, not as an error', () => {
      expect(estimate(EIGHT_WEEKS, [])).toEqual({
        streakPreviewOutcome: 'ESTIMATE',
        clients: 0,
        before: { inRhythm: 0, inGrace: 0, broken: 0 },
        after: { inRhythm: 0, inGrace: 0, broken: 0 },
        back: 0,
        out: 0,
      });
    });

    it('judges nobody on a day that is no day', () => {
      const result = StreakPreviewSystem.estimate(
        SIX_WEEKS,
        EIGHT_WEEKS,
        SHOP.map(strict),
        todayOf('tomorrow'),
      );
      expect(result).toMatchObject({
        streakPreviewOutcome: 'ESTIMATE',
        clients: 0,
      });
    });
  });

  describe('the rule going off, or on', () => {
    it('counts nobody under a rule that is off: it judges no one', () => {
      expect(estimate(OFF)).toEqual({
        streakPreviewOutcome: 'ESTIMATE',
        clients: 6,
        before: { inRhythm: 3, inGrace: 1, broken: 2 },
        after: null,
        back: 0,
        out: 0,
      });
    });

    it('counts where people will stand when the rule comes on', () => {
      expect(estimate(SIX_WEEKS, SHOP, OFF)).toEqual({
        streakPreviewOutcome: 'ESTIMATE',
        clients: 6,
        before: null,
        after: { inRhythm: 3, inGrace: 1, broken: 2 },
        back: 0,
        out: 0,
      });
    });
  });

  describe('a rule that counts by a list', () => {
    const BY_SERVICE = revised(
      StreakQualifierRule.services([ServiceId.of('svc-fade')]),
    );
    const BY_CATEGORY = revised(
      StreakQualifierRule.categories([ServiceCategoryId.of('cat-hair')]),
    );

    it.each([
      ['the draft counts chosen services', SIX_WEEKS, BY_SERVICE],
      ['the draft counts chosen categories', SIX_WEEKS, BY_CATEGORY],
      ['the rule in force counts by a list', BY_SERVICE, SIX_WEEKS],
      ['both do', BY_SERVICE, BY_CATEGORY],
    ])('is not estimated when %s', (_when, inForce, draft) => {
      expect(
        StreakPreviewSystem.estimate(
          inForce,
          draft,
          SHOP.map(strict),
          todayOf(TODAY),
        ),
      ).toEqual({ streakPreviewOutcome: 'UNAVAILABLE', reason: 'QUALIFIER' });
    });
  });

  it('is pure: the same question is the same answer, and the facts are left as they were', () => {
    const frozen = SHOP.map((facts) =>
      Object.freeze({
        ...facts,
        visits: Object.freeze(facts.visits.map((v) => Object.freeze(v))),
      }),
    );
    const before = JSON.stringify(frozen);
    const first = estimate(EIGHT_WEEKS, frozen);
    const second = estimate(EIGHT_WEEKS, frozen);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(JSON.stringify(frozen)).toBe(before);
  });

  it('folds a thousand clients without being asked twice', () => {
    const clients = Array.from({ length: 1000 }, (_, i) =>
      visited(i % 90, (i % 90) + 35, (i % 90) + 70),
    );
    const result = estimate(EIGHT_WEEKS, clients);
    expect(result.clients).toBe(1000);
    expect(
      (result.after?.inRhythm ?? 0) +
        (result.after?.inGrace ?? 0) +
        (result.after?.broken ?? 0),
    ).toBe(1000);
    expect(result.out).toBe(0);
    expect(result.back).toBeGreaterThan(0);
  });
});

/*
 * `admin-rhythm.words.spec.ts` `previewWords`, ported (Law
 * 10.2 — law-10-decision-extraction.md R-6): each standing's movement is the
 * system's figure; the page signs and words it.
 */
describe('StreakPreviewSystem.movement — how far each standing moves', () => {
  const before = { inRhythm: 131, inGrace: 12, broken: 71 };
  const after = { inRhythm: 148, inGrace: 9, broken: 57 };

  it('moves each standing by after − before: gains up, losses down', () => {
    expect(StreakPreviewSystem.movement(before, after)).toEqual({
      inRhythm: 17,
      inGrace: -3,
      broken: -14,
    });
    expect(StreakPreviewSystem.movement(after, before)).toEqual({
      inRhythm: -17,
      inGrace: 3,
      broken: 14,
    });
  });

  it('moves nothing between equal counts', () => {
    expect(StreakPreviewSystem.movement(before, before)).toEqual({
      inRhythm: 0,
      inGrace: 0,
      broken: 0,
    });
  });

  it('states no movement while either rule is off', () => {
    expect(StreakPreviewSystem.movement(before, null)).toBeNull();
    expect(StreakPreviewSystem.movement(null, after)).toBeNull();
    expect(StreakPreviewSystem.movement(null, null)).toBeNull();
  });

  it('agrees with the estimate: the in-rhythm movement is back − out', () => {
    const preview = estimate(EIGHT_WEEKS);
    if (preview.before === null || preview.after === null) {
      throw new Error('both rules are on');
    }
    expect(
      StreakPreviewSystem.movement(preview.before, preview.after)?.inRhythm,
    ).toBe(preview.back - preview.out);
  });
});

describe('StreakPreviewSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const clients = deepFreeze(SHOP.map(strict));
    const inForce = deepFreeze(SIX_WEEKS);
    const draft = deepFreeze(EIGHT_WEEKS);
    const today = localDate(TODAY);
    expect(
      StreakPreviewSystem.estimate(inForce, draft, clients, today),
    ).toEqual(StreakPreviewSystem.estimate(inForce, draft, clients, today));
    const before = deepFreeze({ inRhythm: 131, inGrace: 12, broken: 71 });
    const after = deepFreeze({ inRhythm: 148, inGrace: 9, broken: 57 });
    expect(StreakPreviewSystem.movement(before, after)).toEqual(
      StreakPreviewSystem.movement(before, after),
    );
  });
});

// ── The preview's facts and the rule card's sample run (pass C R-13, R-14, R-15) ──
// The cases of `admin-rhythm.preview.spec.ts` (`streakFactsReader`,
// `rhythmPreviewReadsFacts`, the sample run), restated on branded days and
// the boundary's day-start reader.

/** The first instant of a Sofia day — the reader the page binds to the shop's zone. */
const sofiaDayStart = (on: LocalDate): UtcEpochMs =>
  ZonedTimeSystem.startOfLocalDay(on, FIXTURE_TIME_ZONE);

/** A statistic's visit on the shop's wall clock, read ONCE in the shop's zone. */
function workedAt(isoWithOffset: string, index: number): VisitFact {
  const wall = ZonedTimeSystem.toLocal(utcMs(isoWithOffset), FIXTURE_TIME_ZONE);
  return {
    appointmentId: AppointmentId.of(`appt-${index}`),
    localDate: wall.localDate,
    startMinutes: wall.minute,
  };
}

function workedDaysAgo(days: number, index: number): VisitFact {
  return {
    appointmentId: AppointmentId.of(`appt-${index}`),
    localDate: LocalDate.addDays(localDate(TODAY), -days),
    startMinutes: minute(12 * 60),
  };
}

/** The recommended rule, revised from tomorrow — any option figure, the interval or the qualifier whole. */
function ruleOf(
  patch: Partial<StreakRule.Options> & {
    readonly interval?: StreakIntervalRule;
    readonly qualifier?: StreakQualifierRule;
  } = {},
): StreakRule {
  const { interval, qualifier, ...options } = patch;
  const rule = StreakRule.parse({
    ...SIX_WEEKS,
    ...options,
    ...(interval ?? StreakIntervalRule.of(SIX_WEEKS)),
    ...(qualifier ?? StreakQualifierRule.of(SIX_WEEKS)),
    version: SIX_WEEKS.version + 1,
    effectiveFromLocalDate: localDate(addDays(TODAY, 1)),
  });
  if (!rule.ok) throw new Error('fixture: no such rule');
  return rule.value;
}

const fadeOnly = (): StreakQualifierRule =>
  StreakQualifierRule.services([ServiceId.of('svc-fade')]);

const sampleMarks = (rule: StreakRule): readonly string[] =>
  StreakPreviewSystem.sampleRun(
    rule,
    localDate(TODAY),
    sofiaDayStart,
  )?.periods.map((period) => period.streakPeriodMark) ?? [];

describe('StreakPreviewSystem.readsFacts — can visit days alone preview the change', () => {
  it('reads the statistics while both rules count every visit', () => {
    expect(
      StreakPreviewSystem.readsFacts(ruleOf(), ruleOf({ graceDays: 10 })),
    ).toBe(true);
  });

  it('reads nothing when either rule counts by a list — services or categories', () => {
    const listed = ruleOf({ qualifier: fadeOnly() });
    const byCategory = ruleOf({
      qualifier: StreakQualifierRule.categories([
        ServiceCategoryId.of('cat-hair'),
      ]),
    });

    expect(StreakPreviewSystem.readsFacts(ruleOf(), listed)).toBe(false);
    expect(StreakPreviewSystem.readsFacts(listed, ruleOf())).toBe(false);
    expect(StreakPreviewSystem.readsFacts(byCategory, ruleOf())).toBe(false);
    expect(StreakPreviewSystem.readsFacts(listed, byCategory)).toBe(false);
  });

  it('is the check the estimate makes: unavailable exactly where it reads nothing', () => {
    const listed = ruleOf({ qualifier: fadeOnly() });
    for (const [inForce, draft] of [
      [ruleOf(), listed],
      [listed, ruleOf()],
      [ruleOf(), ruleOf({ graceDays: 10 })],
    ] as const) {
      const preview = StreakPreviewSystem.estimate(
        inForce,
        draft,
        [],
        localDate(TODAY),
      );
      expect(
        preview.streakPreviewOutcome === StreakPreviewOutcome.Unavailable,
      ).toBe(!StreakPreviewSystem.readsFacts(inForce, draft));
    }
  });
});

describe('StreakPreviewSystem.factsOfStats — a statistic as the projector’s facts', () => {
  it('counts every worked visit of the last year, on its day in Sofia', () => {
    const facts = StreakPreviewSystem.factsOfStats(
      {
        last365VisitsCompleted: [
          workedAt('2026-06-10T09:00:00+00:00', 0),
          // 01:30 on the 28th in Sofia: the visit's day is the shop's, not UTC's.
          workedAt('2026-09-27T22:30:00+00:00', 1),
        ],
      },
      sofiaDayStart,
    );

    expect(facts.visits).toEqual([
      {
        localDate: '2026-06-10',
        counted: true,
        utcEpochMs: sofiaDayStart(localDate('2026-06-10')),
      },
      {
        localDate: '2026-09-28',
        counted: true,
        utcEpochMs: sofiaDayStart(localDate('2026-09-28')),
      },
    ]);
  });

  it('knows nothing the statistics do not hold', () => {
    const facts = StreakPreviewSystem.factsOfStats(
      { last365VisitsCompleted: [workedDaysAgo(3, 0)] },
      sofiaDayStart,
    );

    expect(facts.excused).toEqual([]);
    expect(facts.bookings).toEqual([]);
    expect(facts.pauses).toEqual([]);
    expect(facts.grants).toEqual([]);
  });

  it('hands a client who never came no visit', () => {
    expect(
      StreakPreviewSystem.factsOfStats(
        { last365VisitsCompleted: [] },
        sofiaDayStart,
      ),
    ).toEqual(StreakPreviewSystem.NO_FACTS);
  });

  it('asks the reader once per visit, for the visit’s own day', () => {
    const asked: LocalDate[] = [];
    StreakPreviewSystem.factsOfStats(
      {
        last365VisitsCompleted: [workedDaysAgo(10, 0), workedDaysAgo(3, 1)],
      },
      (on) => {
        asked.push(on);
        return sofiaDayStart(on);
      },
    );
    expect(asked).toEqual(['2026-09-18', '2026-09-25']);
  });
});

describe('StreakPreviewSystem.sampleFacts / sampleRun — the rule card’s invented client', () => {
  const today = localDate(TODAY);

  it('ends yesterday, seven visits long', () => {
    const { visits } = StreakPreviewSystem.sampleFacts(
      ruleOf(),
      today,
      sofiaDayStart,
    );

    expect(visits).toHaveLength(7);
    expect(visits.at(-1)).toEqual({
      localDate: '2026-09-27',
      counted: true,
      utcEpochMs: sofiaDayStart(localDate('2026-09-27')),
    });
    expect(visits.every((visit) => visit.counted)).toBe(true);
  });

  it('comes on time six times, then misses one due date by a whole period', () => {
    const days = StreakPreviewSystem.sampleFacts(
      ruleOf(),
      today,
      sofiaDayStart,
    ).visits.map((visit) => visit.localDate);
    const gaps = days
      .slice(1)
      .map((on, index) => LocalDate.daysBetween(days.at(index) ?? on, on));

    expect(gaps).toEqual([42, 42, 42, 42, 42, 84]);
  });

  it('shows the recommended rule covering the miss with a protection', () => {
    const run = StreakPreviewSystem.sampleRun(ruleOf(), today, sofiaDayStart);

    expect(sampleMarks(ruleOf())).toEqual([
      StreakPeriodMark.Kept,
      StreakPeriodMark.Kept,
      StreakPeriodMark.Kept,
      StreakPeriodMark.Kept,
      StreakPeriodMark.Kept,
      StreakPeriodMark.Kept,
      StreakPeriodMark.Protected,
      StreakPeriodMark.Kept,
    ]);
    expect(run?.periods.at(-2)).toEqual({
      streakPeriodMark: StreakPeriodMark.Protected,
      on: '2026-08-16',
      periodReason: FreezeReason.Freeze,
    });
    expect(run?.streakPhase).toBe(StreakPhase.Active);
    expect(run?.current).toBe(7);
    expect(run?.best).toBe(7);
    expect(run?.freezesBanked).toBe(0);
    expect(run?.dueBy).toBe('2026-11-08');
  });

  it('shows the miss itself where nothing covers it, and the count starting over', () => {
    const bare = ruleOf({
      protectionsEnabled: false,
      protectionsMaxBanked: 2,
      protectionsEarnEvery: 5,
      protectionsStartWith: 0,
    });
    const run = StreakPreviewSystem.sampleRun(bare, today, sofiaDayStart);

    expect(sampleMarks(bare).slice(-5)).toEqual([
      StreakPeriodMark.Kept,
      StreakPeriodMark.Kept,
      StreakPeriodMark.Kept,
      StreakPeriodMark.Missed,
      StreakPeriodMark.Kept,
    ]);
    expect(run?.current).toBe(1);
    expect(run?.best).toBe(6);
  });

  it('keeps the count across the miss under a rule that holds it', () => {
    const holding = ruleOf({
      protectionsEnabled: false,
      protectionsMaxBanked: 2,
      protectionsEarnEvery: 5,
      protectionsStartWith: 0,
      onBreak: StreakOnBreak.Hold,
    });

    expect(sampleMarks(holding)).toContain(StreakPeriodMark.Missed);
    expect(
      StreakPreviewSystem.sampleRun(holding, today, sofiaDayStart)?.current,
    ).toBe(7);
  });

  it('is on time under a personal interval too: only the one due date is missed', () => {
    const personal = ruleOf({
      interval: StreakIntervalRule.personal(50, 21, 70, 42),
    });

    expect(
      sampleMarks(personal).filter((mark) => mark !== StreakPeriodMark.Kept),
    ).toEqual([StreakPeriodMark.Protected]);
    expect(
      StreakPreviewSystem.sampleRun(personal, today, sofiaDayStart)
        ?.streakPhase,
    ).toBe(StreakPhase.Active);
  });

  it.each([14, 28, 42, 91, 182])(
    'misses exactly one due date under an interval of %i days',
    (days) => {
      const marks = sampleMarks(
        ruleOf({
          interval: StreakIntervalRule.fixed(days),
          graceDays: Math.min(7, days - 1),
          riskLeadDays: Math.min(7, days - 1),
          minGapDays: Math.min(7, days - 1),
        }),
      );

      expect(marks.filter((mark) => mark !== StreakPeriodMark.Kept)).toEqual([
        StreakPeriodMark.Protected,
      ]);
    },
  );

  it('draws nothing under a rule that is off', () => {
    expect(
      StreakPreviewSystem.sampleRun(
        ruleOf({ enabled: false }),
        today,
        sofiaDayStart,
      ),
    ).toBeNull();
  });
});

describe('StreakPreviewSystem purity — readsFacts, factsOfStats, sampleFacts, sampleRun', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const rule = deepFreeze(ruleOf());
    const listed = deepFreeze(ruleOf({ qualifier: fadeOnly() }));
    const record = deepFreeze({
      last365VisitsCompleted: [workedDaysAgo(10, 0), workedDaysAgo(3, 1)],
    });
    const today = localDate(TODAY);
    const run = () => [
      StreakPreviewSystem.readsFacts(rule, listed),
      StreakPreviewSystem.factsOfStats(record, sofiaDayStart),
      StreakPreviewSystem.sampleFacts(rule, today, sofiaDayStart),
      StreakPreviewSystem.sampleRun(rule, today, sofiaDayStart),
    ];
    expect(run()).toEqual(run());
    expect(record.last365VisitsCompleted).toHaveLength(2);
    expect(StreakPreviewSystem.NO_FACTS).toEqual({
      visits: [],
      excused: [],
      bookings: [],
      pauses: [],
      grants: [],
    });
  });
});
