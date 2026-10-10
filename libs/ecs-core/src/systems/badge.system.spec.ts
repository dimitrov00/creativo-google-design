import { describe, expect, it } from 'vitest';
import type { BadgeLevel } from '../components/badge-level.data';
import { BadgeCategoryId } from '../entities/badge-category.entity';
import type { BadgeProgressEntity } from '../entities/badge-progress.entity';
import {
  SeriesId,
  type BadgeSeriesEntity,
} from '../entities/badge-series.entity';
import { ServiceId } from '../entities/service.entity';
import { deepFreeze } from '../testing';
import { BadgeSystem } from './badge.system';

/*
 * The cases of libs/domain/engagement/src/lib/loyalty/badge-series.spec.ts,
 * COPIED (the legacy spec keeps running against `BadgeSeries`' shim) and
 * re-targeted to the plain `BadgeSeriesEntity`: `standing`, the family's
 * own questions, and the rows of `BadgeSeries.create`'s refusal table that
 * are the family's rules (`BadgeSystem.validate`). Not copied: the rows of
 * an empty subject, narrowing or category id and a one-locale title, and
 * the case that types every id — those are the edge guards' (`XId.of`
 * after a guard, `LocalizedText.parse`), not the family's.
 */

const text = (bg: string, en = bg) => ({ bg, en });

function levels(
  targets: readonly (number | null)[],
  ruleStem = 'rule-fade',
): BadgeLevel[] {
  return targets.map((target, i) => ({
    level: i + 1,
    ruleId: `${ruleStem}-${i + 1}`,
    target,
    requirement: text(`${target ?? 'веднъж'} посещения с фейд`),
    awards: [],
  }));
}

/** «Фейд» I…V, the mastery shelf's service family. */
const fade: BadgeSeriesEntity = {
  id: SeriesId.of('series-svc-fade'),
  categoryId: BadgeCategoryId.of('cat-mastery'),
  seasonId: null,
  title: text('Фейд', 'Fade'),
  requirement: text('Посещения с фейд', 'Visits with a fade'),
  emblem: 'service',
  subject: { kind: 'service', serviceId: ServiceId.of('svc-fade') },
  metric: {
    metric: 'client.visits.completed',
    window: null,
    where: {
      serviceId: ServiceId.of('svc-fade'),
      barberId: null,
      locationId: null,
    },
  },
  art: null,
  levels: levels([3, 10, 25, 50, 100]),
  repeatable: false,
  order: 7,
  retiredAtMs: null,
  version: 1,
};

function build(series: BadgeSeriesEntity): BadgeSeriesEntity {
  const result = BadgeSystem.validate(series);
  if (!result.ok) {
    throw new Error(result.error.map((e) => e.code).join(', '));
  }
  return result.value;
}

function codes(series: BadgeSeriesEntity): string[] {
  const result = BadgeSystem.validate(series);
  return result.ok ? [] : result.error.map((e) => e.code).sort();
}

const progress = (
  value: number,
  earned: readonly number[] = [],
): BadgeProgressEntity => ({
  id: SeriesId.of('series-svc-fade'),
  value,
  earned: earned.map((level) => ({
    level,
    earnedAtMs: Date.parse('2026-06-01T07:00:00.000Z'),
    via: 'rule' as const,
    count: 1,
  })),
});

describe('BadgeSystem.validate', () => {
  it('takes the rhythm family: no metric, rising targets', () => {
    expect(
      codes({
        ...fade,
        id: SeriesId.of('series-rhythm'),
        subject: null,
        metric: null,
        levels: levels([3, 6, 12, 24]),
      }),
    ).toEqual([]);
  });

  it('takes a one-off act and a yearly family, each with one level', () => {
    expect(codes({ ...fade, metric: null, levels: levels([null]) })).toEqual(
      [],
    );
    expect(
      codes({
        ...fade,
        metric: null,
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
        seasonId: 'season-2026-autumn' as BadgeSeriesEntity['seasonId'],
      }),
    ).toEqual([]);
  });

  it.each<[string, Partial<BadgeSeriesEntity>, string[]]>([
    ['no levels', { levels: [] }, ['engagement.badge_series.no_levels']],
    [
      'a gap in the levels',
      {
        levels: levels([3, 10, 25]).map((l, i) =>
          i === 2 ? { ...l, level: 4 } : l,
        ),
      },
      ['engagement.badge_series.level_gap'],
    ],
    [
      'targets that fall',
      { levels: levels([3, 10, 10]) },
      ['engagement.badge_series.targets_not_rising'],
    ],
    [
      'a zero target',
      { levels: levels([0, 10]) },
      ['engagement.badge_series.targets_not_rising'],
    ],
    [
      'a fractional target',
      { levels: levels([2.5, 10]) },
      ['engagement.badge_series.targets_not_rising'],
    ],
    [
      'no home',
      { categoryId: null, seasonId: null },
      ['engagement.badge_series.homeless'],
    ],
    [
      'a one-off act among several levels',
      { levels: levels([null, 5]) },
      ['engagement.badge_series.one_off_with_several_levels'],
    ],
    [
      'a yearly family with several levels',
      { repeatable: true },
      ['engagement.badge_series.repeatable_with_several_levels'],
    ],
    [
      'a level without its rule',
      { levels: levels([3]).map((l) => ({ ...l, ruleId: ' ' })) },
      ['engagement.badge_series.level_without_rule'],
    ],
    [
      'a level paying nothing',
      {
        levels: levels([3]).map((l) => ({
          ...l,
          awards: [{ kind: 'points' as const, points: 0 }],
        })),
      },
      ['engagement.badge_series.award_not_positive'],
    ],
  ])('refuses %s', (_case, override, expected) => {
    expect(codes({ ...fade, ...override })).toEqual(expected);
  });

  it('reports every problem at once', () => {
    expect(codes({ ...fade, categoryId: null, levels: [] })).toEqual([
      'engagement.badge_series.homeless',
      'engagement.badge_series.no_levels',
    ]);
  });

  it('names what it refused: the levels, the targets, the level and what it paid', () => {
    const result = BadgeSystem.validate({
      ...fade,
      levels: [
        {
          ...(levels([3])[0] as BadgeLevel),
          awards: [{ kind: 'freeze', count: 0 }],
        },
        { ...(levels([3, 2])[1] as BadgeLevel), level: 3 },
      ],
    });
    expect(!result.ok && result.error).toEqual([
      {
        code: 'engagement.badge_series.award_not_positive',
        level: 1,
        kind: 'freeze',
      },
      { code: 'engagement.badge_series.level_gap', levels: '1, 3' },
      { code: 'engagement.badge_series.targets_not_rising', targets: '3, 2' },
    ]);
  });
});

describe('BadgeSystem.standing', () => {
  const series = build(fade);

  it('is not started without a progress document', () => {
    expect(BadgeSystem.standing(series, null)).toEqual({
      state: 'notStarted',
      highestLevel: 0,
      next: BadgeSystem.levelAt(series, 1),
      value: 0,
      target: 3,
    });
  });

  it('is in progress with a value and no level yet', () => {
    expect(BadgeSystem.standing(series, progress(2))).toMatchObject({
      state: 'inProgress',
      highestLevel: 0,
      value: 2,
      target: 3,
    });
  });

  it('is earned from the first level, aiming at the next', () => {
    const standing = BadgeSystem.standing(series, progress(24, [1, 2]));
    expect(standing.state).toBe('earned');
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
      id: SeriesId.of('series-birthday'),
      metric: null,
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
          retiredAtMs: Date.parse('2026-01-01T00:00:00.000Z'),
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
          id: SeriesId.of('series-tenure'),
          subject: null,
          metric: { metric: 'client.tenure.days', window: null, where: null },
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
