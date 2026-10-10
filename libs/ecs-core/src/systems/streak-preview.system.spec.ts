import { describe, expect, it } from 'vitest';
import { DayKey } from '../components/day-key.data';
import { StreakRule, type StreakExcuse } from '../components/streak-rule.data';
import type { StreakState } from '../components/streak-state.data';
import { ServiceCategoryId } from '../entities/service-category.entity';
import { ServiceId } from '../entities/service.entity';
import { FIXTURE_TODAY, deepFreeze } from '../testing';
import {
  StreakPreviewSystem,
  type StreakPreview,
} from './streak-preview.system';
import { StreakRuleSystem } from './streak-rule.system';
import { StreakSystem, type StreakFacts as SystemFacts } from './streak.system';
import { ZonedTimeSystem } from './zoned-time.system';

/*
 * The cases of libs/application/engagement/src/lib/use-cases/preview-streak-definition.use-case.spec.ts,
 * COPIED (the legacy spec keeps running against the use case) and
 * re-targeted: the rules are `StreakRule` structs (`revised` is the
 * recommended rule's next version, parsed), the facts are written as the
 * legacy spec wrote them and made strict by `strict`, and `preview.execute`
 * / `projectStreak` are thin helpers over `StreakPreviewSystem.estimate` /
 * `StreakSystem.project`. Every case body is the legacy one but the
 * `changeFrom` call in one assertion message. Plus the system purity case.
 */

const ZONE = 'Europe/Sofia';
const TODAY: string = FIXTURE_TODAY; // 2026-09-28

type StreakDefinition = StreakRule;
type StreakDefinitionProps = StreakRule;

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
    readonly reason: 'pause' | 'clientPause';
  }[];
  readonly grants: readonly { readonly day: string; readonly count: number }[];
};

function strict(facts: StreakFacts): SystemFacts {
  return {
    visits: facts.visits.map((v) => ({
      day: DayKey.of(v.day),
      counted: v.counted,
      atMs: null,
    })),
    excused: facts.excused.map((e) => ({
      day: DayKey.of(e.day),
      reason: e.reason,
    })),
    bookings: facts.bookings.map((b) => ({
      placedOn: DayKey.of(b.placedOn),
      day: DayKey.of(b.day),
      appointmentId: b.appointmentId ?? null,
    })),
    pauses: facts.pauses.map((p) => ({
      from: DayKey.of(p.from),
      until: DayKey.of(p.until),
      reason: p.reason,
    })),
    grants: facts.grants.map((g) => ({
      day: DayKey.of(g.day),
      count: g.count,
    })),
  };
}

const addDays = (day: string, days: number): string =>
  ZonedTimeSystem.addDays(DayKey.of(day), days);

function projectStreak(
  rule: StreakDefinition,
  facts: StreakFacts,
  today: string,
): StreakState | null {
  return StreakSystem.project(
    StreakRule.DEFAULT_DEFINITION_ID,
    rule,
    strict(facts),
    DayKey.of(today),
    ZONE,
  );
}

/** The legacy use case's one method, over the system. */
const preview = {
  execute(input: {
    readonly inForce: StreakDefinition;
    readonly draft: StreakDefinition;
    readonly clients: readonly StreakFacts[];
    readonly today: string;
  }): StreakPreview {
    return StreakPreviewSystem.estimate(
      input.inForce,
      input.draft,
      input.clients.map(strict),
      DayKey.of(input.today),
    );
  },
};

/** The recommended rule: a visit every 42 days, 7 of grace, the cue 7 days ahead. */
const SIX_WEEKS = StreakRule.DEFAULT;

/** The next version of the recommended rule, `patch` over it. */
function revised(patch: Partial<StreakDefinitionProps>): StreakDefinition {
  const rule = StreakRule.parse({
    ...SIX_WEEKS,
    ...patch,
    version: SIX_WEEKS.version + 1,
    effectiveFromDayKey: DayKey.of(addDays(TODAY, 1)),
  });
  if (!rule.ok) throw new Error('fixture: no such rule');
  return rule.value;
}

const EIGHT_WEEKS = revised({ interval: { kind: 'fixed', days: 56 } });
const FOUR_WEEKS = revised({ interval: { kind: 'fixed', days: 28 } });
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
  draft: StreakDefinition,
  clients: readonly StreakFacts[] = SHOP,
  inForce: StreakDefinition = SIX_WEEKS,
): Extract<StreakPreview, { kind: 'estimate' }> {
  const result = preview.execute({ inForce, draft, clients, today: TODAY });
  if (result.kind !== 'estimate') throw new Error('expected an estimate');
  return result;
}

describe('PreviewStreakDefinitionUseCase', () => {
  it('stands on the domain’s projector: the people below are where it says they are', () => {
    const phases = SHOP.map(
      (facts) => projectStreak(SIX_WEEKS, facts, TODAY)?.phase.kind,
    );
    expect(phases).toEqual([
      'active',
      'atRisk',
      'inGrace',
      'broken',
      'broken',
      'active',
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
          reason: 'pause',
        },
      ],
    };
    expect(projectStreak(SIX_WEEKS, paused, TODAY)?.phase.kind).toBe('frozen');
    expect(estimate(SIX_WEEKS, [paused]).before).toEqual({
      inRhythm: 1,
      inGrace: 0,
      broken: 0,
    });
  });

  it('shows what a LONGER interval brings back', () => {
    // Eight weeks: due 56 days after the visit, grace until the 63rd.
    expect(estimate(EIGHT_WEEKS)).toEqual({
      kind: 'estimate',
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
      kind: 'estimate',
      clients: 6,
      before: { inRhythm: 3, inGrace: 1, broken: 2 },
      after: { inRhythm: 2, inGrace: 0, broken: 4 },
      back: 0,
      out: 1,
    });
    expect(projectStreak(FOUR_WEEKS, REGULAR, TODAY)).toMatchObject({
      current: 5,
      phase: { kind: 'active' },
    });
    expect(projectStreak(FOUR_WEEKS, NEAR_DUE, TODAY)?.phase.kind).toBe(
      'broken',
    );
  });

  it('counts from the rule in force, whichever that is', () => {
    // From four weeks, twelve bring back everyone but the long gone.
    expect(
      estimate(
        revised({ interval: { kind: 'fixed', days: 84 } }),
        SHOP,
        FOUR_WEEKS,
      ),
    ).toEqual({
      kind: 'estimate',
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
      protections: { enabled: true, maxBanked: 2, earnEvery: 5, startWith: 1 },
    });
    const bareRule = revised({
      interval: { kind: 'fixed', days: 56 },
      graceDays: 0,
      protections: { enabled: false, maxBanked: 2, earnEvery: 5, startWith: 0 },
    });
    const covered = visited(60); // her protection covered the miss
    const late = visited(45);
    expect(projectStreak(protectedRule, covered, TODAY)?.phase).toMatchObject({
      kind: 'frozen',
      reason: 'freeze',
    });
    expect(projectStreak(bareRule, covered, TODAY)?.phase.kind).toBe('broken');
    expect(projectStreak(protectedRule, late, TODAY)?.phase.kind).toBe(
      'inGrace',
    );
    expect(projectStreak(bareRule, late, TODAY)?.phase.kind).toBe('active');

    expect(estimate(bareRule, [covered, late], protectedRule)).toEqual({
      kind: 'estimate',
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
      revised({ onBreak: 'hold' }),
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
    const standingOf = (rule: StreakDefinition, facts: StreakFacts) => {
      const kind = projectStreak(rule, facts, TODAY)?.phase.kind;
      if (kind === 'inGrace' || kind === 'broken') return kind;
      return kind === undefined ? null : 'inRhythm';
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
        kind: 'estimate',
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
        kind: 'estimate',
        clients: 0,
        before: { inRhythm: 0, inGrace: 0, broken: 0 },
        after: { inRhythm: 0, inGrace: 0, broken: 0 },
        back: 0,
        out: 0,
      });
    });

    it('judges nobody on a day that is no day', () => {
      const result = preview.execute({
        inForce: SIX_WEEKS,
        draft: EIGHT_WEEKS,
        clients: SHOP,
        today: 'tomorrow',
      });
      expect(result).toMatchObject({ kind: 'estimate', clients: 0 });
    });
  });

  describe('the rule going off, or on', () => {
    it('counts nobody under a rule that is off: it judges no one', () => {
      expect(estimate(OFF)).toEqual({
        kind: 'estimate',
        clients: 6,
        before: { inRhythm: 3, inGrace: 1, broken: 2 },
        after: null,
        back: 0,
        out: 0,
      });
    });

    it('counts where people will stand when the rule comes on', () => {
      expect(estimate(SIX_WEEKS, SHOP, OFF)).toEqual({
        kind: 'estimate',
        clients: 6,
        before: null,
        after: { inRhythm: 3, inGrace: 1, broken: 2 },
        back: 0,
        out: 0,
      });
    });
  });

  describe('a rule that counts by a list', () => {
    const BY_SERVICE = revised({
      qualifier: { kind: 'services', serviceIds: [ServiceId.of('svc-fade')] },
    });
    const BY_CATEGORY = revised({
      qualifier: {
        kind: 'categories',
        categoryIds: [ServiceCategoryId.of('cat-hair')],
      },
    });

    it.each([
      ['the draft counts chosen services', SIX_WEEKS, BY_SERVICE],
      ['the draft counts chosen categories', SIX_WEEKS, BY_CATEGORY],
      ['the rule in force counts by a list', BY_SERVICE, SIX_WEEKS],
      ['both do', BY_SERVICE, BY_CATEGORY],
    ])('is not estimated when %s', (_when, inForce, draft) => {
      expect(
        preview.execute({ inForce, draft, clients: SHOP, today: TODAY }),
      ).toEqual({ kind: 'unavailable', reason: 'qualifier' });
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

describe('StreakPreviewSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const clients = deepFreeze(SHOP.map(strict));
    const inForce = deepFreeze(SIX_WEEKS);
    const draft = deepFreeze(EIGHT_WEEKS);
    const today = DayKey.of(TODAY);
    expect(
      StreakPreviewSystem.estimate(inForce, draft, clients, today),
    ).toEqual(StreakPreviewSystem.estimate(inForce, draft, clients, today));
  });
});
