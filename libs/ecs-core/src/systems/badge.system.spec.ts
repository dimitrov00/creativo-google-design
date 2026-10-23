import { describe, expect, it } from 'vitest';
import {
  EarnedVia,
  MedalState,
  type BadgeLevel,
  AwardSummary,
  BadgeEmblem,
  BadgeSubjectSlot,
  Metric,
  MetricRef,
} from '@core/components';
import type { BadgeProgress, BadgeSeries } from '@core/entities';
import {
  AchievementRuleId,
  BadgeCategoryId,
  BadgeSeriesId,
  SeasonId,
  ServiceId,
} from '@core/primitives';
import { deepFreeze, localDate, utcMs } from '@core/testing';
import { BadgeSystem } from './badge.system';

/*
 * The cases of the legacy engagement `badge-series.spec.ts` (deleted in Phase
 * 4b; ledger `docs/architecture/flips/phase-4b-delete.md` §11.1), COPIED while
 * it still ran against `BadgeSeries`' shim, and re-targeted to the flat
 * `BadgeSeries` (the `MetricRef` and `BadgeSubjectSlot` slices at its root):
 * `standing`, the family's own questions, and the rows of
 * `BadgeSeries.create`'s refusal table that are the family's rules
 * (`BadgeSystem.validate`). Not copied: the rows of an empty subject, narrowing
 * or category id and a one-locale title, and the case that types every id —
 * those are the edge guards' (`XId.of` after a guard, `LocalizedText.parse`),
 * not the family's.
 */

const text = (bg: string, en = bg) => ({ bg, en });

function levels(
  targets: readonly (number | null)[],
  ruleStem = 'rule-fade',
): BadgeLevel[] {
  return targets.map((target, i) => ({
    level: i + 1,
    ruleId: AchievementRuleId.of(`${ruleStem}-${i + 1}`),
    target,
    requirement: text(`${target ?? 'веднъж'} посещения с фейд`),
    awards: [],
  }));
}

/** «Фейд» I…V, the mastery shelf's service family. */
const fade: BadgeSeries = {
  id: BadgeSeriesId.of('series-svc-fade'),
  categoryId: BadgeCategoryId.of('cat-mastery'),
  seasonId: null,
  title: text('Фейд', 'Fade'),
  requirement: text('Посещения с фейд', 'Visits with a fade'),
  emblem: BadgeEmblem.Service,
  ...BadgeSubjectSlot.service(ServiceId.of('svc-fade')),
  ...MetricRef.of(Metric.VisitsCompleted),
  metricScopeServiceId: ServiceId.of('svc-fade'),
  artPath: null,
  levels: levels([3, 10, 25, 50, 100]),
  repeatable: false,
  order: 7,
  retiredAtUtcMs: null,
  retiredLocalDate: null,
  version: 1,
};

/** A family that counts nothing and is about nothing (today's `subject: null`, `metric: null`). */
const UNCOUNTED = { ...BadgeSubjectSlot.none(), ...MetricRef.none() };

/** A family about nothing that counts `metric`, everywhere. */
const counting = (metric: Metric) => ({
  ...BadgeSubjectSlot.none(),
  ...MetricRef.of(metric),
});

function build(series: BadgeSeries): BadgeSeries {
  const result = BadgeSystem.validate(series);
  if (!result.ok) {
    throw new Error(result.error.map((e) => e.errorCode).join(', '));
  }
  return result.value;
}

function codes(series: BadgeSeries): string[] {
  const result = BadgeSystem.validate(series);
  return result.ok ? [] : result.error.map((e) => e.errorCode).sort();
}

const progress = (
  value: number,
  earned: readonly number[] = [],
): BadgeProgress => ({
  id: BadgeSeriesId.of('series-svc-fade'),
  value,
  earned: earned.map((level) => ({
    level,
    earnedAtUtcMs: utcMs('2026-06-01T07:00:00.000Z'),
    earnedLocalDate: localDate('2026-06-01'),
    earnedVia: EarnedVia.Rule,
    count: 1,
  })),
});

describe('BadgeSystem.validate', () => {
  it('takes the rhythm family: no metric, rising targets', () => {
    expect(
      codes({
        ...fade,
        id: BadgeSeriesId.of('series-rhythm'),
        ...UNCOUNTED,
        levels: levels([3, 6, 12, 24]),
      }),
    ).toEqual([]);
  });

  it('takes a one-off act and a yearly family, each with one level', () => {
    expect(codes({ ...fade, ...UNCOUNTED, levels: levels([null]) })).toEqual(
      [],
    );
    expect(
      codes({
        ...fade,
        ...UNCOUNTED,
        repeatable: true,
        levels: levels([null]),
      }),
    ).toEqual([]);
  });

  it('lives in a season instead of a category', () => {
    expect(
      codes({
        ...fade,
        categoryId: null,
        seasonId: SeasonId.of('season-2026-autumn'),
      }),
    ).toEqual([]);
  });

  it.each<[string, Partial<BadgeSeries>, string[]]>([
    ['no levels', { levels: [] }, ['ENGAGEMENT_BADGE_SERIES_NO_LEVELS']],
    [
      'a gap in the levels',
      {
        levels: levels([3, 10, 25]).map((l, i) =>
          i === 2 ? { ...l, level: 4 } : l,
        ),
      },
      ['ENGAGEMENT_BADGE_SERIES_LEVEL_GAP'],
    ],
    [
      'targets that fall',
      { levels: levels([3, 10, 10]) },
      ['ENGAGEMENT_BADGE_SERIES_TARGETS_NOT_RISING'],
    ],
    [
      'a zero target',
      { levels: levels([0, 10]) },
      ['ENGAGEMENT_BADGE_SERIES_TARGETS_NOT_RISING'],
    ],
    [
      'a fractional target',
      { levels: levels([2.5, 10]) },
      ['ENGAGEMENT_BADGE_SERIES_TARGETS_NOT_RISING'],
    ],
    [
      'no home',
      { categoryId: null, seasonId: null },
      ['ENGAGEMENT_BADGE_SERIES_HOMELESS'],
    ],
    [
      'a one-off act among several levels',
      { levels: levels([null, 5]) },
      ['ENGAGEMENT_BADGE_SERIES_ONE_OFF_WITH_SEVERAL_LEVELS'],
    ],
    [
      'a yearly family with several levels',
      { repeatable: true },
      ['ENGAGEMENT_BADGE_SERIES_REPEATABLE_WITH_SEVERAL_LEVELS'],
    ],
    [
      'a level without its rule',
      {
        levels: levels([3]).map((l) => ({
          ...l,
          ruleId: AchievementRuleId.of(' '),
        })),
      },
      ['ENGAGEMENT_BADGE_SERIES_LEVEL_WITHOUT_RULE'],
    ],
    [
      'a level paying nothing',
      {
        levels: levels([3]).map((l) => ({
          ...l,
          awards: [AwardSummary.points(0)],
        })),
      },
      ['ENGAGEMENT_BADGE_SERIES_AWARD_NOT_POSITIVE'],
    ],
  ])('refuses %s', (_case, override, expected) => {
    expect(codes({ ...fade, ...override } as BadgeSeries)).toEqual(expected);
  });

  it('reports every problem at once', () => {
    expect(codes({ ...fade, categoryId: null, levels: [] })).toEqual([
      'ENGAGEMENT_BADGE_SERIES_HOMELESS',
      'ENGAGEMENT_BADGE_SERIES_NO_LEVELS',
    ]);
  });

  it('names what it refused: the levels, the targets, the level and what it paid', () => {
    const result = BadgeSystem.validate({
      ...fade,
      levels: [
        {
          ...(levels([3])[0] as BadgeLevel),
          awards: [AwardSummary.freeze(0)],
        },
        { ...(levels([3, 2])[1] as BadgeLevel), level: 3 },
      ],
    });
    expect(!result.ok && result.error).toEqual([
      {
        errorCode: 'ENGAGEMENT_BADGE_SERIES_AWARD_NOT_POSITIVE',
        level: 1,
        awardKind: 'FREEZE',
      },
      { errorCode: 'ENGAGEMENT_BADGE_SERIES_LEVEL_GAP', levels: '1, 3' },
      {
        errorCode: 'ENGAGEMENT_BADGE_SERIES_TARGETS_NOT_RISING',
        targets: '3, 2',
      },
    ]);
  });
});

describe('BadgeSystem.standing', () => {
  const series = build(fade);

  it('is not started without a progress document', () => {
    expect(BadgeSystem.standing(series, null)).toEqual({
      medalState: MedalState.NotStarted,
      highestLevel: 0,
      next: BadgeSystem.levelAt(series, 1),
      value: 0,
      target: 3,
    });
  });

  it('is in progress with a value and no level yet', () => {
    expect(BadgeSystem.standing(series, progress(2))).toMatchObject({
      medalState: MedalState.InProgress,
      highestLevel: 0,
      value: 2,
      target: 3,
    });
  });

  it('is earned from the first level, aiming at the next', () => {
    const standing = BadgeSystem.standing(series, progress(24, [1, 2]));
    expect(standing.medalState).toBe(MedalState.Earned);
    expect(standing.highestLevel).toBe(2);
    expect(standing.next?.level).toBe(3);
    expect(standing.target).toBe(25);
    expect(standing.value).toBe(24);
  });

  it('has no next level once complete', () => {
    const standing = BadgeSystem.standing(
      series,
      progress(120, [1, 2, 3, 4, 5]),
    );
    expect(standing.next).toBeNull();
    expect(standing.target).toBeNull();
    expect(standing.highestLevel).toBe(5);
  });

  it('completes a yearly family once earned', () => {
    const birthday = build({
      ...fade,
      id: BadgeSeriesId.of('series-birthday'),
      ...UNCOUNTED,
      repeatable: true,
      levels: levels([null]),
    });
    expect(BadgeSystem.standing(birthday, progress(0, [1])).next).toBeNull();
    expect(BadgeSystem.standing(birthday, null).target).toBeNull();
  });
});

describe('BadgeSystem — the family’s own questions', () => {
  it('is retired once it has a retirement date', () => {
    expect(BadgeSystem.isRetired(build(fade))).toBe(false);
    expect(
      BadgeSystem.isRetired(
        build({
          ...fade,
          retiredAtUtcMs: utcMs('2026-01-01T00:00:00.000Z'),
          retiredLocalDate: localDate('2026-01-01'),
        }),
      ),
    ).toBe(true);
  });

  it('is calendar-driven on tenure alone', () => {
    expect(BadgeSystem.isCalendarDriven(build(fade))).toBe(false);
    expect(
      BadgeSystem.isCalendarDriven(
        build({
          ...fade,
          id: BadgeSeriesId.of('series-tenure'),
          ...counting(Metric.TenureDays),
          levels: levels([365, 730]),
        }),
      ),
    ).toBe(true);
  });

  it('finds a level by number', () => {
    const series = build(fade);
    expect(BadgeSystem.levelAt(series, 3)?.target).toBe(25);
    expect(BadgeSystem.levelAt(series, 6)).toBeNull();
    expect(BadgeSystem.levelAt(series, 0)).toBeNull();
  });
});

describe('BadgeSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const series = deepFreeze({ ...fade, levels: levels([3, 10, 10]) });
    const held = deepFreeze(progress(24, [1, 2]));
    const once = [
      BadgeSystem.validate(series),
      BadgeSystem.standing(series, held),
      BadgeSystem.levelAt(series, 2),
    ];
    const twice = [
      BadgeSystem.validate(series),
      BadgeSystem.standing(series, held),
      BadgeSystem.levelAt(series, 2),
    ];
    expect(twice).toEqual(once);
  });
});
