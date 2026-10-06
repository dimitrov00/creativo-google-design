import { describe, expect, it } from 'vitest';
import { BadgeLevelProps, BadgeSeries, BadgeSeriesProps } from './badge-series';
import type { BadgeProgress } from './projections';

const text = (bg: string, en = bg) => ({ bg, en });

function levels(
  targets: readonly (number | null)[],
  ruleStem = 'rule-fade',
): BadgeLevelProps[] {
  return targets.map((target, i) => ({
    level: i + 1,
    ruleId: `${ruleStem}-${i + 1}`,
    target,
    requirement: text(`${target ?? 'веднъж'} посещения с фейд`),
    awards: [],
  }));
}

/** «Фейд» I…V, the mastery shelf's service family. */
const fade: BadgeSeriesProps = {
  id: 'series-svc-fade',
  categoryId: 'cat-mastery',
  seasonId: null,
  title: text('Фейд', 'Fade'),
  requirement: text('Посещения с фейд', 'Visits with a fade'),
  emblem: 'service',
  subject: { kind: 'service', serviceId: 'svc-fade' },
  metric: {
    metric: 'client.visits.completed',
    where: { serviceId: 'svc-fade' },
  },
  art: null,
  levels: levels([3, 10, 25, 50, 100]),
  repeatable: false,
  order: 7,
  retiredAt: null,
  version: 1,
};

function build(props: BadgeSeriesProps): BadgeSeries {
  const result = BadgeSeries.create(props);
  if (result.isFailure()) {
    throw new Error(result.error.map((e) => e.code).join(', '));
  }
  return result.value;
}

function codes(props: BadgeSeriesProps): string[] {
  const result = BadgeSeries.create(props);
  return result.isFailure() ? result.error.map((e) => e.code).sort() : [];
}

const progress = (
  value: number,
  earned: readonly number[] = [],
): BadgeProgress => ({
  seriesId: 'series-svc-fade',
  value,
  earned: earned.map((level) => ({
    level,
    earnedAt: new Date('2026-06-01T07:00:00.000Z'),
    via: 'rule' as const,
    count: 1,
  })),
});

describe('BadgeSeries.create', () => {
  it('types every id, the subject and the metric’s narrowing', () => {
    const series = build(fade);
    expect(series.id.value).toBe('series-svc-fade');
    expect(series.categoryId?.value).toBe('cat-mastery');
    expect(series.seasonId).toBeNull();
    expect(series.subject).toEqual({
      kind: 'service',
      serviceId: expect.objectContaining({ value: 'svc-fade' }),
    });
    expect(series.metric?.where?.serviceId?.value).toBe('svc-fade');
    expect(series.metric?.window).toBeUndefined();
    expect(series.title.get('en')).toBe('Fade');
    expect(series.levels.map((l) => l.target)).toEqual([3, 10, 25, 50, 100]);
    expect(series.levels[0]?.requirement.get('bg')).toBe('3 посещения с фейд');
  });

  it('keeps a windowed metric, and barber and location narrowing', () => {
    const series = build({
      ...fade,
      id: 'series-barber-ivan',
      subject: { kind: 'barber', barberId: 'ivan' },
      metric: {
        metric: 'client.visits.completed',
        window: { lastDays: 365 },
        where: { barberId: 'ivan', locationId: 'loc-center' },
      },
    });
    expect(series.metric?.window).toEqual({ lastDays: 365 });
    expect(series.metric?.where?.barberId?.value).toBe('ivan');
    expect(series.metric?.where?.locationId?.value).toBe('loc-center');
  });

  it('summarises what each level pays', () => {
    const series = build({
      ...fade,
      levels: levels([3]).map((level) => ({
        ...level,
        awards: [
          { kind: 'points', points: 20 },
          { kind: 'coupon', title: text('Безплатна брада', 'Free beard') },
          { kind: 'freeze', count: 1 },
          { kind: 'perk', perkId: 'perk.priorityWaitlist', forDays: null },
        ],
      })),
    });
    const awards = series.levelAt(1)?.awards ?? [];
    expect(awards.map((a) => a.kind)).toEqual([
      'points',
      'coupon',
      'freeze',
      'perk',
    ]);
    const coupon = awards[1];
    expect(coupon?.kind === 'coupon' && coupon.title.get('en')).toBe(
      'Free beard',
    );
  });

  // The rhythm family counts the cadence streak's best run, not a registry
  // metric: no metric, and still numbered targets.
  it('takes the rhythm family: no metric, rising targets', () => {
    const rhythm = build({
      ...fade,
      id: 'series-rhythm',
      categoryId: 'cat-rhythm',
      subject: null,
      metric: null,
      emblem: 'streak',
      levels: levels([3, 6, 12, 18, 24], 'rule-rhythm'),
    });
    expect(rhythm.metric).toBeNull();
    expect(rhythm.levels).toHaveLength(5);
  });

  it('takes a one-off act and a yearly family, each with one level', () => {
    expect(
      build({
        ...fade,
        id: 'series-welcome',
        metric: null,
        levels: levels([null]),
      }).levels,
    ).toHaveLength(1);
    expect(
      build({
        ...fade,
        id: 'series-birthday',
        metric: null,
        repeatable: true,
        levels: levels([null]),
      }).repeatable,
    ).toBe(true);
  });

  it('lives in a season instead of a category', () => {
    const track = build({
      ...fade,
      id: 'series-2026-autumn-track',
      categoryId: null,
      seasonId: 'season-2026-autumn',
    });
    expect(track.seasonId?.value).toBe('season-2026-autumn');
  });

  it.each<[string, Partial<BadgeSeriesProps>, string[]]>([
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
    [
      'an empty subject id',
      { subject: { kind: 'service', serviceId: '' } },
      ['catalog.id.empty'],
    ],
    [
      'an empty narrowing id',
      {
        metric: { metric: 'client.visits.completed', where: { barberId: '' } },
      },
      ['catalog.id.empty'],
    ],
    ['an empty category id', { categoryId: '' }, ['engagement.id.empty']],
    [
      'a title with one locale',
      { title: { bg: 'Фейд', en: ' ' } },
      ['catalog.localized_text.field_empty'],
    ],
  ])('refuses %s', (_case, override, expected) => {
    expect(codes({ ...fade, ...override })).toEqual(expected);
  });

  it('reports every problem at once', () => {
    expect(codes({ ...fade, id: '', categoryId: null, levels: [] })).toEqual([
      'engagement.badge_series.homeless',
      'engagement.badge_series.no_levels',
      'engagement.id.empty',
    ]);
  });
});

describe('BadgeSeries.standing', () => {
  const series = build(fade);

  it('is not started without a progress document', () => {
    expect(series.standing(null)).toEqual({
      state: 'notStarted',
      highestLevel: 0,
      next: series.levelAt(1),
      value: 0,
      target: 3,
    });
  });

  it('is in progress with a value and no level yet', () => {
    expect(series.standing(progress(2))).toMatchObject({
      state: 'inProgress',
      highestLevel: 0,
      value: 2,
      target: 3,
    });
  });

  it('is earned from the first level, aiming at the next', () => {
    const standing = series.standing(progress(24, [1, 2]));
    expect(standing.state).toBe('earned');
    expect(standing.highestLevel).toBe(2);
    expect(standing.next?.level).toBe(3);
    expect(standing.target).toBe(25);
    expect(standing.value).toBe(24);
  });

  it('has no next level once complete', () => {
    const standing = series.standing(progress(120, [1, 2, 3, 4, 5]));
    expect(standing.next).toBeNull();
    expect(standing.target).toBeNull();
    expect(standing.highestLevel).toBe(5);
  });

  it('completes a yearly family once earned', () => {
    const birthday = build({
      ...fade,
      id: 'series-birthday',
      metric: null,
      repeatable: true,
      levels: levels([null]),
    });
    expect(birthday.standing(progress(0, [1])).next).toBeNull();
    expect(birthday.standing(null).target).toBeNull();
  });
});

describe('BadgeSeries — the family’s own questions', () => {
  it('is retired once it has a retirement date', () => {
    expect(build(fade).isRetired()).toBe(false);
    expect(
      build({
        ...fade,
        retiredAt: new Date('2026-01-01T00:00:00.000Z'),
      }).isRetired(),
    ).toBe(true);
  });

  it('is calendar-driven on tenure alone', () => {
    expect(build(fade).isCalendarDriven()).toBe(false);
    expect(
      build({
        ...fade,
        id: 'series-tenure',
        subject: null,
        metric: { metric: 'client.tenure.days' },
        levels: levels([365, 730]),
      }).isCalendarDriven(),
    ).toBe(true);
  });

  it('finds a level by number', () => {
    const series = build(fade);
    expect(series.levelAt(3)?.target).toBe(25);
    expect(series.levelAt(6)).toBeNull();
    expect(series.levelAt(0)).toBeNull();
  });
});
