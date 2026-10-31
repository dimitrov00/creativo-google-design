import { describe, expect, it } from 'vitest';
import {
  EarnedVia,
  MedalState,
  type BadgeLevel,
  type EarnedLevel,
  BadgeEmblem,
  BadgeSubjectSlot,
  LadderRung,
  MedalCaption,
  MedalDetailState,
  MedalMeter,
  MedalProgressCard,
  MedalRingState,
  Metric,
  MetricRef,
  PersonalRecord,
  PersonalRecordKind,
  SeasonPhase,
  type SeriesStanding,
} from '@core/components';
import type { BadgeProgress, BadgeSeries } from '@core/entities';
import {
  AchievementRuleId,
  BadgeCategoryId,
  BadgeSeriesId,
  type LocalDate,
  ServiceId,
} from '@core/primitives';
import {
  type LoyaltyClientFixture,
  deepFreeze,
  localDate,
  loyaltyAccountFixtures,
  loyaltyCatalogFixture,
  unwrapOk,
  utcMs,
} from '@core/testing';
import { BadgeSystem } from './badge.system';
import { LoyaltyCatalogSystem } from './loyalty-catalog.system';
import { SeasonSystem } from './season.system';

/*
 * The cases of the legacy engagement `badge-series.spec.ts` (deleted in Phase
 * 4b; ledger `docs/architecture/flips/phase-4b-delete.md` §11.1), COPIED while
 * it still ran against `BadgeSeries`' shim, and re-targeted to the flat
 * `BadgeSeries` (the `MetricRef` and `BadgeSubjectSlot` slices at its root):
 * `standing` and the family's own questions.
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

describe('BadgeSystem.standing', () => {
  const series = fade;

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
    const birthday: BadgeSeries = {
      ...fade,
      id: BadgeSeriesId.of('series-birthday'),
      ...UNCOUNTED,
      repeatable: true,
      levels: levels([null]),
    };
    expect(BadgeSystem.standing(birthday, progress(0, [1])).next).toBeNull();
    expect(BadgeSystem.standing(birthday, null).target).toBeNull();
  });
});

describe('BadgeSystem — the family’s own questions', () => {
  it('is retired once it has a retirement date', () => {
    expect(BadgeSystem.isRetired(fade)).toBe(false);
    const retired: BadgeSeries = {
      ...fade,
      retiredAtUtcMs: utcMs('2026-01-01T00:00:00.000Z'),
      retiredLocalDate: localDate('2026-01-01'),
    };
    expect(BadgeSystem.isRetired(retired)).toBe(true);
  });

  it('is calendar-driven (`MetricRef.isCalendarDriven`) on tenure alone', () => {
    expect(MetricRef.isCalendarDriven(fade)).toBe(false);
    const tenure: BadgeSeries = {
      ...fade,
      id: BadgeSeriesId.of('series-tenure'),
      ...counting(Metric.TenureDays),
      levels: levels([365, 730]),
    };
    expect(MetricRef.isCalendarDriven(tenure)).toBe(true);
  });

  it('finds a level by number', () => {
    const series = fade;
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
      BadgeSystem.standing(series, held),
      BadgeSystem.levelAt(series, 2),
    ];
    const twice = [
      BadgeSystem.standing(series, held),
      BadgeSystem.levelAt(series, 2),
    ];
    expect(twice).toEqual(once);
  });
});

/*
 * THE DECISIONS A MEDAL'S WORDS STAND ON (Law 10.2, the decision-extraction
 * pass §2.4: M-2, M-3, M-5, M-7, M-9, M-10, M-23, M-29, M-33, M-34, M-35,
 * M-37, M-38) — the cases of `achievements.presenter.spec.ts`,
 * `medals.presenter.spec.ts` and `medal-detail.presenter.spec.ts` that pin
 * each decision, re-stated as the value or tag the presenter now words, on
 * the same data: the published catalogue and Георги's and Мартин's
 * progress as the dev seed stamps them, on the card's today (28.09.2026).
 */

const CATALOG = unwrapOk(
  LoyaltyCatalogSystem.validate(loyaltyCatalogFixture()),
);
const TODAY = localDate('2026-09-28');
const GEORGI = loyaltyAccountFixtures.georgi;
const MARTIN = loyaltyAccountFixtures.martin;

function family(id: string): BadgeSeries {
  const found = LoyaltyCatalogSystem.series(CATALOG, BadgeSeriesId.of(id));
  if (found === null) throw new Error(`no family ${id}`);
  return found;
}

function progressOf(
  holder: LoyaltyClientFixture,
  id: string,
): BadgeProgress | null {
  return holder.badgeProgress.find((held) => held.id === id) ?? null;
}

/** A holder's progress on one family, as the seed stamps it unless `value`/`earned` say otherwise. */
function progressWith(
  id: string,
  value: number,
  earned: readonly (readonly [level: number, on: string, count?: number])[],
): BadgeProgress {
  return {
    id: BadgeSeriesId.of(id),
    value,
    earned: earned.map(([level, on, count = 1]) => ({
      level,
      earnedAtUtcMs: utcMs(`${on}T08:00:00.000Z`),
      earnedLocalDate: localDate(on),
      earnedVia: EarnedVia.Rule,
      count,
    })),
  };
}

function standingOf(holder: LoyaltyClientFixture, id: string): SeriesStanding {
  return BadgeSystem.standing(family(id), progressOf(holder, id));
}

/** The family's season or event ended on the card's today. */
function endedOf(series: BadgeSeries): boolean {
  if (series.seasonId === null) return false;
  const season = LoyaltyCatalogSystem.season(CATALOG, series.seasonId);
  return (
    season !== null && SeasonSystem.phaseOn(season, TODAY) === SeasonPhase.Ended
  );
}

const firstVisitOf = (holder: LoyaltyClientFixture): LocalDate | null =>
  PersonalRecord.find(holder.account.records, PersonalRecordKind.FirstVisit)
    ?.on ?? null;

const RETIRED = {
  retiredAtUtcMs: utcMs('2026-09-01T00:00:00.000Z'),
  retiredLocalDate: localDate('2026-09-01'),
};

describe('BadgeSystem — the family’s shape (M-3, M-35)', () => {
  it('tells a single act from a family of one level, and both from a ladder', () => {
    for (const id of ['series-welcome', 'series-birthday', 'series-profile']) {
      expect([id, BadgeSystem.isOneOff(family(id))]).toEqual([id, true]);
      expect([id, BadgeSystem.isSingleLevel(family(id))]).toEqual([id, true]);
    }
    // One counted level: single, yet no one-off — it has a threshold.
    for (const id of ['series-2026-autumn-early', 'series-both-shops']) {
      expect([id, BadgeSystem.isOneOff(family(id))]).toEqual([id, false]);
      expect([id, BadgeSystem.isSingleLevel(family(id))]).toEqual([id, true]);
    }
    expect(BadgeSystem.isOneOff(family('series-svc-fade'))).toBe(false);
    expect(BadgeSystem.isSingleLevel(family('series-svc-fade'))).toBe(false);
    expect(BadgeSystem.isOneOff({ levels: [] })).toBe(false);
  });

  it('counts in visits a kind of visit and the rhythm’s run — never a single act, a distinct count or days', () => {
    for (const id of [
      'series-visits',
      'series-svc-fade',
      'series-early-bird',
      'series-weekend',
      'series-on-time',
      'series-party',
      'series-rhythm',
    ]) {
      expect([id, BadgeSystem.countsInVisits(family(id))]).toEqual([id, true]);
    }
    for (const id of [
      'series-welcome',
      'series-explorer',
      'series-tenure',
      'series-self-service',
      'series-referrals',
    ]) {
      expect([id, BadgeSystem.countsInVisits(family(id))]).toEqual([id, false]);
    }
  });
});

describe('BadgeSystem — the earned levels (M-2)', () => {
  it('reads the latest stamp, the highest level and a level’s day off the progress', () => {
    const fade = progressOf(GEORGI, 'series-svc-fade');
    expect(BadgeSystem.latestEarned(fade)?.level).toBe(2);
    expect(BadgeSystem.topEarned(fade)?.level).toBe(2);
    expect(BadgeSystem.earnedOn(fade, 1)).toBe('2025-04-21');
    expect(BadgeSystem.earnedOn(fade, 2)).toBe('2025-09-22');
    expect(BadgeSystem.earnedOn(fade, 3)).toBeNull();
  });

  it('answers none for a family not started, or started with nothing earned', () => {
    expect(BadgeSystem.latestEarned(null)).toBeNull();
    expect(BadgeSystem.topEarned(null)).toBeNull();
    expect(BadgeSystem.earnedOn(null, 1)).toBeNull();
    const weekend = progressOf(GEORGI, 'series-weekend');
    expect(BadgeSystem.latestEarned(weekend)).toBeNull();
    expect(BadgeSystem.topEarned(weekend)).toBeNull();
  });

  it('tells the latest stamp from the highest level, and keeps the first of a tie', () => {
    const moved = progressWith('series-svc-fade', 12, [
      [2, '2026-01-10'],
      [1, '2026-06-01'],
    ]);
    expect(BadgeSystem.latestEarned(moved)?.level).toBe(1);
    expect(BadgeSystem.topEarned(moved)?.level).toBe(2);
    const tied = progressWith('series-svc-fade', 12, [
      [1, '2026-06-01'],
      [2, '2026-06-01'],
    ]);
    expect(BadgeSystem.latestEarned(tied)?.level).toBe(1);
    const twice: BadgeProgress = {
      ...tied,
      earned: [
        ...tied.earned,
        { ...(tied.earned[1] as EarnedLevel), count: 2 },
      ],
    };
    expect(BadgeSystem.topEarned(twice)?.count).toBe(1);
  });
});

describe('BadgeSystem.toNext / nextLevelNumber / levelsShown (M-9, M-37)', () => {
  it('draws towards the next level: the count, its threshold, the level', () => {
    expect(
      BadgeSystem.toNext(standingOf(GEORGI, 'series-svc-fade'), false),
    ).toEqual({
      value: 24,
      target: 25,
      level: 3,
    });
    expect(
      BadgeSystem.toNext(standingOf(GEORGI, 'series-svc-classic-cut'), false),
    ).toEqual({ value: 0, target: 3, level: 1 });
  });

  it('draws towards nothing once complete, for a single act, or once its season ended', () => {
    expect(
      BadgeSystem.toNext(standingOf(GEORGI, 'series-rhythm'), false),
    ).toBeNull();
    expect(
      BadgeSystem.toNext(standingOf(GEORGI, 'series-profile'), false),
    ).toBeNull();
    const summer = family('series-2026-summer-track');
    expect(endedOf(summer)).toBe(true);
    const stopped = standingOf(GEORGI, 'series-2026-summer-track');
    expect(stopped.next?.level).toBe(4);
    expect(BadgeSystem.toNext(stopped, true)).toBeNull();
  });

  it('heads for the next level, else the one after the highest', () => {
    expect(
      BadgeSystem.nextLevelNumber(standingOf(GEORGI, 'series-svc-fade')),
    ).toBe(3);
    expect(
      BadgeSystem.nextLevelNumber(standingOf(GEORGI, 'series-svc-classic-cut')),
    ).toBe(1);
    expect(
      BadgeSystem.nextLevelNumber(standingOf(GEORGI, 'series-rhythm')),
    ).toBe(6);
    expect(
      BadgeSystem.nextLevelNumber(standingOf(GEORGI, 'series-welcome')),
    ).toBe(2);
  });

  it('keeps an ended season’s levels to the ones it reached, every level otherwise', () => {
    const summer = family('series-2026-summer-track');
    const stopped = standingOf(GEORGI, 'series-2026-summer-track');
    expect(
      BadgeSystem.levelsShown(summer, stopped, true).map((l) => l.level),
    ).toEqual([1, 2, 3]);
    expect(BadgeSystem.levelsShown(summer, stopped, false)).toBe(summer.levels);
    // An ended season nothing was earned in keeps no level.
    expect(
      BadgeSystem.levelsShown(summer, BadgeSystem.standing(summer, null), true),
    ).toEqual([]);
  });
});

describe('BadgeSystem.landsOn — the day a calendar-driven level lands (M-5)', () => {
  const tenure = family('series-tenure');

  it('lands tenure’s next level on the anniversary of the first visit', () => {
    // «Години с нас» II on the second anniversary of 6.03.2025.
    expect(
      BadgeSystem.landsOn(
        tenure,
        standingOf(GEORGI, 'series-tenure'),
        firstVisitOf(GEORGI),
        TODAY,
      ),
    ).toBe('2027-03-06');
  });

  it('counts the days still missing from today without a first visit', () => {
    expect(
      BadgeSystem.landsOn(tenure, { value: 700, target: 730 }, null, TODAY),
    ).toBe('2026-10-28');
    // Past due: today, never a day gone by.
    expect(
      BadgeSystem.landsOn(tenure, { value: 731, target: 730 }, null, TODAY),
    ).toBe('2026-09-28');
  });

  it('never lands before today: a level due and not yet stamped lands today', () => {
    expect(
      BadgeSystem.landsOn(
        tenure,
        { value: 999, target: 730 },
        localDate('2024-01-01'),
        TODAY,
      ),
    ).toBe('2026-09-28');
  });

  it('lands nothing for any other family, nor for one with no target left', () => {
    expect(
      BadgeSystem.landsOn(
        family('series-svc-fade'),
        standingOf(GEORGI, 'series-svc-fade'),
        firstVisitOf(GEORGI),
        TODAY,
      ),
    ).toBeNull();
    expect(
      BadgeSystem.landsOn(
        tenure,
        { value: 3650, target: null },
        firstVisitOf(GEORGI),
        TODAY,
      ),
    ).toBeNull();
  });
});

describe('BadgeSystem — the meter, the face and the ring (M-10, M-23)', () => {
  it('stands the meter where the visit takes it, else at the honest fraction, else nowhere', () => {
    const fade = standingOf(GEORGI, 'series-svc-fade');
    const toNext = BadgeSystem.toNext(fade, false);
    expect(BadgeSystem.meterOf(fade, toNext, true)).toEqual({
      medalMeter: MedalMeter.Pending,
      fraction: 0,
    });
    expect(BadgeSystem.meterOf(fade, toNext, false)).toEqual({
      medalMeter: MedalMeter.Fraction,
      fraction: 24 / 25,
    });
    // Not started: no meter, though a level lies ahead.
    const cut = standingOf(GEORGI, 'series-svc-classic-cut');
    expect(
      BadgeSystem.meterOf(cut, BadgeSystem.toNext(cut, false), false),
    ).toEqual({ medalMeter: MedalMeter.None, fraction: 0 });
    // Complete, or ended: nothing to draw towards.
    const rhythm = standingOf(GEORGI, 'series-rhythm');
    expect(BadgeSystem.meterOf(rhythm, null, false).medalMeter).toBe(
      MedalMeter.None,
    );
    // Never past full.
    const over = BadgeSystem.standing(
      family('series-svc-fade'),
      progressWith('series-svc-fade', 26, [
        [1, '2025-04-21'],
        [2, '2025-09-22'],
      ]),
    );
    expect(
      BadgeSystem.meterOf(over, BadgeSystem.toNext(over, false), false)
        .fraction,
    ).toBe(1);
  });

  it('never draws a level this visit completes as the dullest medal', () => {
    const cut = standingOf(GEORGI, 'series-svc-classic-cut');
    expect(BadgeSystem.faceState(cut, false)).toBe(MedalState.NotStarted);
    expect(BadgeSystem.faceState(cut, true)).toBe(MedalState.InProgress);
    const fade = standingOf(GEORGI, 'series-svc-fade');
    expect(BadgeSystem.faceState(fade, true)).toBe(MedalState.Earned);
    const weekend = standingOf(GEORGI, 'series-weekend');
    expect(BadgeSystem.faceState(weekend, false)).toBe(MedalState.InProgress);
  });

  it('closes the ring for a family with every level earned, and only then', () => {
    expect(
      BadgeSystem.ringState(standingOf(GEORGI, 'series-rhythm'), false),
    ).toBe(MedalRingState.Complete);
    expect(
      BadgeSystem.ringState(standingOf(GEORGI, 'series-rhythm'), true),
    ).toBe(MedalRingState.Complete);
    // A single act done is complete too.
    expect(
      BadgeSystem.ringState(standingOf(GEORGI, 'series-welcome'), false),
    ).toBe(MedalRingState.Complete);
    expect(
      BadgeSystem.ringState(standingOf(GEORGI, 'series-svc-fade'), true),
    ).toBe(MedalRingState.Earned);
    expect(
      BadgeSystem.ringState(standingOf(GEORGI, 'series-weekend'), false),
    ).toBe(MedalRingState.InProgress);
    const cut = standingOf(GEORGI, 'series-svc-classic-cut');
    expect(BadgeSystem.ringState(cut, false)).toBe(MedalRingState.NotStarted);
    expect(BadgeSystem.ringState(cut, true)).toBe(MedalRingState.InProgress);
  });

  it('draws the arc from the last threshold won to the next, not from nought', () => {
    // «Фейд» at 24 with II = 10 and III = 25: 14 of 15.
    const fade = family('series-svc-fade');
    expect(
      BadgeSystem.ringFraction(fade, standingOf(GEORGI, 'series-svc-fade')),
    ).toBeCloseTo(14 / 15);
    const at23 = BadgeSystem.standing(
      fade,
      progressWith('series-svc-fade', 23, [
        [1, '2025-04-21'],
        [2, '2025-09-22'],
      ]),
    );
    expect(BadgeSystem.ringFraction(fade, at23)).toBeCloseTo(13 / 15);
  });

  it('draws the way to the first level from nought', () => {
    expect(
      BadgeSystem.ringFraction(
        family('series-weekend'),
        standingOf(GEORGI, 'series-weekend'),
      ),
    ).toBeCloseTo(2 / 3);
  });

  it('is empty on the day a level is won, and never negative when a windowed count fell', () => {
    expect(
      BadgeSystem.ringFraction(
        family('series-explorer'),
        standingOf(GEORGI, 'series-explorer'),
      ),
    ).toBe(0);
    const year = family('series-twelve-months');
    const fallen = BadgeSystem.standing(
      year,
      progressWith('series-twelve-months', 6, [
        [1, '2025-06-04'],
        [2, '2025-10-15'],
      ]),
    );
    expect(BadgeSystem.ringFraction(year, fallen)).toBe(0);
  });

  it('never runs past full', () => {
    const fade = family('series-svc-fade');
    const over = BadgeSystem.standing(
      fade,
      progressWith('series-svc-fade', 26, [
        [1, '2025-04-21'],
        [2, '2025-09-22'],
      ]),
    );
    expect(BadgeSystem.ringFraction(fade, over)).toBe(1);
  });

  it('draws no arc with no next threshold, nor over a span of nothing', () => {
    expect(
      BadgeSystem.ringFraction(
        family('series-rhythm'),
        standingOf(GEORGI, 'series-rhythm'),
      ),
    ).toBeNull();
    expect(
      BadgeSystem.ringFraction(
        family('series-profile'),
        standingOf(GEORGI, 'series-profile'),
      ),
    ).toBeNull();
    const flat = { levels: levels([5, 5]) };
    const standing = BadgeSystem.standing(flat, progress(5, [1]));
    expect(standing.target).toBe(5);
    expect(BadgeSystem.ringFraction(flat, standing)).toBeNull();
  });
});

describe('BadgeSystem.captionOf — the numeral rule (M-7)', () => {
  const caption = (
    holder: LoyaltyClientFixture,
    id: string,
    pending = false,
  ): MedalCaption => {
    const series = family(id);
    const standing = standingOf(holder, id);
    return BadgeSystem.captionOf(
      series,
      standing,
      BadgeSystem.latestEarned(progressOf(holder, id)),
      endedOf(series),
      pending,
      BadgeSystem.landsOn(series, standing, firstVisitOf(holder), TODAY),
    );
  };

  it('says «с това посещение» first, whatever else holds', () => {
    expect(caption(GEORGI, 'series-svc-fade', true)).toBe(
      MedalCaption.WithThisVisit,
    );
    expect(caption(GEORGI, 'series-rhythm', true)).toBe(
      MedalCaption.WithThisVisit,
    );
  });

  it('words the next level by its count, by the day it lands, or as a single act not yet done', () => {
    expect(caption(GEORGI, 'series-svc-fade')).toBe(MedalCaption.ToLevel);
    expect(caption(GEORGI, 'series-svc-classic-cut')).toBe(
      MedalCaption.ToLevel,
    );
    expect(caption(GEORGI, 'series-tenure')).toBe(MedalCaption.LandsOn);
    expect(caption(GEORGI, 'series-profile')).toBe(MedalCaption.NotYet);
  });

  it('says nothing for an ended season’s family that stopped where it stopped', () => {
    expect(caption(GEORGI, 'series-2026-summer-track')).toBe(MedalCaption.None);
  });

  it('takes the UNGATED day a level lands, even on an ended family the meter draws nothing for', () => {
    const summer = family('series-2026-summer-track');
    const untouched = BadgeSystem.standing(summer, null);
    const lands = localDate('2026-10-01');
    expect(BadgeSystem.toNext(untouched, true)).toBeNull();
    expect(
      BadgeSystem.captionOf(summer, untouched, null, true, false, lands),
    ).toBe(MedalCaption.LandsOn);
    expect(
      BadgeSystem.captionOf(summer, untouched, null, true, false, null),
    ).toBe(MedalCaption.ToLevel);
  });

  it('dates a single level or a yearly act once earned, and says the rest are complete', () => {
    expect(caption(GEORGI, 'series-welcome')).toBe(MedalCaption.OnDay);
    expect(caption(GEORGI, 'series-2026-autumn-early')).toBe(
      MedalCaption.OnDay,
    );
    const birthday = family('series-birthday');
    const once = progressWith('series-birthday', 1, [[1, '2025-09-28']]);
    expect(
      BadgeSystem.captionOf(
        birthday,
        BadgeSystem.standing(birthday, once),
        BadgeSystem.latestEarned(once),
        false,
        false,
        null,
      ),
    ).toBe(MedalCaption.OnDay);
    expect(caption(GEORGI, 'series-rhythm')).toBe(MedalCaption.Complete);
  });
});

describe('BadgeSystem.canStillMove (M-29)', () => {
  it('moves while awarded, a level is left and its season has not ended', () => {
    const can = (holder: LoyaltyClientFixture, id: string, retired = false) => {
      const series = retired ? { ...family(id), ...RETIRED } : family(id);
      return BadgeSystem.canStillMove(
        series,
        standingOf(holder, id),
        endedOf(series),
      );
    };
    expect(can(GEORGI, 'series-svc-fade')).toBe(true);
    expect(can(GEORGI, 'series-profile')).toBe(true);
    expect(can(GEORGI, 'series-2026-autumn-track')).toBe(true);
    expect(can(GEORGI, 'series-svc-fade', true)).toBe(false);
    expect(can(GEORGI, 'series-rhythm')).toBe(false);
    expect(can(GEORGI, 'series-welcome')).toBe(false);
    expect(can(GEORGI, 'series-2026-summer-track')).toBe(false);
  });
});

describe('BadgeSystem.ladder — the rungs of a detail page (M-38)', () => {
  const rungs = (holder: LoyaltyClientFixture, id: string, retired = false) => {
    const series = retired ? { ...family(id), ...RETIRED } : family(id);
    const standing = standingOf(holder, id);
    const ended = endedOf(series);
    return BadgeSystem.ladder(
      series,
      standing,
      progressOf(holder, id),
      BadgeSystem.canStillMove(series, standing, ended),
      ended,
    ).map((step) => [
      step.level.level,
      step.ladderRung,
      step.earned?.earnedLocalDate ?? null,
    ]);
  };

  it('passes the levels earned, with their days, marks the next and leaves the rest for later', () => {
    expect(rungs(GEORGI, 'series-svc-fade')).toEqual([
      [1, LadderRung.Passed, '2025-04-21'],
      [2, LadderRung.Passed, '2025-09-22'],
      [3, LadderRung.Next, null],
      [4, LadderRung.Later, null],
      [5, LadderRung.Later, null],
    ]);
  });

  it('marks the first level next on a family not started', () => {
    expect(rungs(GEORGI, 'series-svc-classic-cut').slice(0, 2)).toEqual([
      [1, LadderRung.Next, null],
      [2, LadderRung.Later, null],
    ]);
  });

  it('marks nothing next on a ladder climbed to its top', () => {
    const steps = rungs(GEORGI, 'series-rhythm');
    expect(steps).toHaveLength(5);
    expect(steps.every(([, rung]) => rung === LadderRung.Passed)).toBe(true);
  });

  it('sets a single act as one rung, passed once done', () => {
    expect(rungs(GEORGI, 'series-welcome')).toEqual([
      [1, LadderRung.Passed, '2025-03-06'],
    ]);
    expect(rungs(GEORGI, 'series-profile')).toEqual([
      [1, LadderRung.Next, null],
    ]);
  });

  it('keeps an ended season’s ladder to the levels it reached', () => {
    expect(rungs(GEORGI, 'series-2026-summer-track')).toEqual([
      [1, LadderRung.Passed, '2026-06-15'],
      [2, LadderRung.Passed, '2026-07-13'],
      [3, LadderRung.Passed, '2026-08-06'],
    ]);
  });

  it('marks nothing next on a family that is no longer awarded', () => {
    expect(
      rungs(GEORGI, 'series-svc-fade', true).map(([, rung]) => rung),
    ).toEqual([
      LadderRung.Passed,
      LadderRung.Passed,
      LadderRung.Later,
      LadderRung.Later,
      LadderRung.Later,
    ]);
  });
});

describe('BadgeSystem.detailState — the state line (M-33)', () => {
  const stateOf = (
    holder: LoyaltyClientFixture,
    id: string,
    progress: BadgeProgress | null = progressOf(holder, id),
    retired = false,
  ) => {
    const series = family(id);
    return BadgeSystem.detailState(
      series,
      BadgeSystem.standing(series, progress),
      progress,
      endedOf(series),
      retired,
    );
  };

  it('names the level the medal wears and the day it was earned', () => {
    expect(stateOf(GEORGI, 'series-svc-fade')).toEqual({
      medalDetailState: MedalDetailState.LevelSince,
      day: '2025-09-22',
      level: 2,
      count: 1,
    });
    expect(stateOf(GEORGI, 'series-tenure')).toMatchObject({
      medalDetailState: MedalDetailState.LevelSince,
      day: '2026-03-06',
      level: 1,
    });
    expect(stateOf(GEORGI, 'series-2026-autumn-track')).toMatchObject({
      medalDetailState: MedalDetailState.LevelSince,
      day: '2026-09-28',
      level: 2,
    });
  });

  it('says a family nothing moved yet has not been started', () => {
    expect(stateOf(GEORGI, 'series-svc-classic-cut').medalDetailState).toBe(
      MedalDetailState.NotStarted,
    );
  });

  it('says a family under way holds no level yet', () => {
    expect(stateOf(GEORGI, 'series-weekend')).toEqual({
      medalDetailState: MedalDetailState.UnderWay,
      day: null,
      level: 0,
      count: 0,
    });
  });

  it('dates the last level of a ladder climbed to its top', () => {
    expect(stateOf(GEORGI, 'series-rhythm')).toMatchObject({
      medalDetailState: MedalDetailState.CompleteSince,
      day: '2026-09-28',
      level: 5,
    });
    // No level on record reads as under way before anything else (the
    // presenter's order): a highest level always has a latest one, so
    // `COMPLETE` without a day is the line's last resort, never reached
    // from a progress document.
    expect(
      BadgeSystem.detailState(
        family('series-svc-fade'),
        { medalState: MedalState.Earned, next: null },
        null,
        false,
        false,
      ).medalDetailState,
    ).toBe(MedalDetailState.UnderWay);
  });

  it('dates a single act by its day, earned or not — one counted level, earned, too', () => {
    expect(stateOf(GEORGI, 'series-welcome')).toMatchObject({
      medalDetailState: MedalDetailState.OneOffEarned,
      day: '2025-03-06',
    });
    expect(stateOf(GEORGI, 'series-profile')).toMatchObject({
      medalDetailState: MedalDetailState.OneOffNotYet,
      day: null,
    });
    expect(stateOf(GEORGI, 'series-2026-autumn-early')).toMatchObject({
      medalDetailState: MedalDetailState.OneOffEarned,
      day: '2026-09-28',
    });
  });

  it('counts a yearly act’s times, and dates the last', () => {
    const once = progressWith('series-birthday', 1, [[1, '2025-09-28']]);
    expect(stateOf(MARTIN, 'series-birthday', once)).toEqual({
      medalDetailState: MedalDetailState.OneOffEarned,
      day: '2025-09-28',
      level: 1,
      count: 1,
    });
    const thrice = progressWith('series-birthday', 3, [[1, '2025-09-28', 3]]);
    expect(stateOf(MARTIN, 'series-birthday', thrice)).toEqual({
      medalDetailState: MedalDetailState.Repeated,
      day: '2025-09-28',
      level: 1,
      count: 3,
    });
    expect(stateOf(MARTIN, 'series-birthday').medalDetailState).toBe(
      MedalDetailState.OneOffNotYet,
    );
  });

  it('says an ended season’s family closed', () => {
    expect(stateOf(GEORGI, 'series-2026-summer-track')).toMatchObject({
      medalDetailState: MedalDetailState.SeasonEnded,
      day: null,
    });
  });

  it('says only that a retired family is no longer awarded', () => {
    expect(
      stateOf(
        GEORGI,
        'series-svc-fade',
        progressOf(GEORGI, 'series-svc-fade'),
        true,
      ),
    ).toMatchObject({ medalDetailState: MedalDetailState.Retired, day: null });
  });
});

describe('BadgeSystem.progressCard — the only place for the count (M-34)', () => {
  const cardOf = (
    holder: LoyaltyClientFixture,
    id: string,
    options: {
      readonly progress?: BadgeProgress | null;
      readonly retired?: boolean;
      readonly draftCounts?: boolean;
    } = {},
  ) => {
    const series = options.retired ? { ...family(id), ...RETIRED } : family(id);
    const progress =
      options.progress === undefined
        ? progressOf(holder, id)
        : options.progress;
    const standing = BadgeSystem.standing(series, progress);
    return BadgeSystem.progressCard(
      series,
      standing,
      progress,
      BadgeSystem.canStillMove(series, standing, endedOf(series)),
      BadgeSystem.landsOn(series, standing, firstVisitOf(holder), TODAY),
      options.draftCounts ?? false,
    );
  };

  it('counts towards the next level: the figure, its threshold, what is left', () => {
    expect(cardOf(GEORGI, 'series-svc-beard')).toEqual({
      medalProgressCard: MedalProgressCard.ToNext,
      value: 6,
      target: 10,
      remaining: 4,
      projected: null,
      unitShown: true,
    });
    expect(cardOf(GEORGI, 'series-svc-classic-cut')).toEqual({
      medalProgressCard: MedalProgressCard.ToNext,
      value: 0,
      target: 3,
      remaining: 3,
      projected: null,
      unitShown: true,
    });
    expect(cardOf(GEORGI, 'series-referrals')).toMatchObject({
      value: 0,
      target: 1,
    });
  });

  it('says where the visit takes the count while its draft counts, never past the threshold', () => {
    expect(cardOf(GEORGI, 'series-svc-fade', { draftCounts: true })).toEqual({
      medalProgressCard: MedalProgressCard.ToNext,
      value: 24,
      target: 25,
      remaining: 1,
      projected: 25,
      unitShown: true,
    });
    expect(
      cardOf(MARTIN, 'series-svc-classic-cut', { draftCounts: true }).projected,
    ).toBe(14);
    expect(
      cardOf(GEORGI, 'series-weekend', { draftCounts: true }).projected,
    ).toBe(3);
  });

  it('shows a ladder climbed to its top by its last threshold', () => {
    expect(cardOf(GEORGI, 'series-rhythm', { draftCounts: true })).toEqual({
      medalProgressCard: MedalProgressCard.Complete,
      value: 24,
      target: null,
      remaining: null,
      projected: null,
      unitShown: false,
    });
    const past = progressWith('series-twelve-months', 17, [
      [1, '2025-06-04'],
      [2, '2025-10-15'],
      [3, '2026-02-26'],
    ]);
    expect(
      cardOf(GEORGI, 'series-twelve-months', { progress: past }),
    ).toMatchObject({
      medalProgressCard: MedalProgressCard.Complete,
      value: 12,
    });
    // One counted level, earned.
    expect(cardOf(GEORGI, 'series-2026-autumn-early')).toMatchObject({
      medalProgressCard: MedalProgressCard.Complete,
      value: 2,
      unitShown: false,
    });
  });

  it('shows a single act done, and «0 от 1» until then', () => {
    expect(cardOf(GEORGI, 'series-welcome')).toEqual({
      medalProgressCard: MedalProgressCard.OneOff,
      value: 1,
      target: 1,
      remaining: null,
      projected: null,
      unitShown: false,
    });
    expect(cardOf(MARTIN, 'series-birthday')).toEqual({
      medalProgressCard: MedalProgressCard.OneOff,
      value: 0,
      target: 1,
      remaining: null,
      projected: null,
      unitShown: true,
    });
    expect(cardOf(GEORGI, 'series-profile')).toMatchObject({
      value: 0,
      unitShown: true,
    });
    // A yearly act earned before: done, no «от 1».
    const lastYear = progressWith('series-birthday', 1, [[1, '2025-09-28']]);
    expect(
      cardOf(MARTIN, 'series-birthday', { progress: lastYear }),
    ).toMatchObject({ value: 1, unitShown: false });
  });

  it('words tenure by the day its next level lands, never by days left', () => {
    expect(cardOf(GEORGI, 'series-tenure')).toEqual({
      medalProgressCard: MedalProgressCard.ToNext,
      value: 571,
      target: 730,
      remaining: null,
      projected: null,
      unitShown: true,
    });
  });

  it('reads nothing as progress where the family can no longer move', () => {
    const stopped = {
      medalProgressCard: MedalProgressCard.Stopped,
      target: null,
      remaining: null,
      projected: null,
      unitShown: false,
    };
    expect(
      cardOf(GEORGI, 'series-2026-summer-track', { draftCounts: true }),
    ).toEqual({
      ...stopped,
      value: 3,
    });
    expect(
      cardOf(GEORGI, 'series-svc-fade', { retired: true, draftCounts: true }),
    ).toEqual({ ...stopped, value: 24 });
  });

  it('says nothing is left once a level is due and not yet stamped', () => {
    const due = progressWith('series-svc-fade', 25, [
      [1, '2025-04-21'],
      [2, '2025-09-22'],
    ]);
    expect(cardOf(GEORGI, 'series-svc-fade', { progress: due })).toMatchObject({
      value: 25,
      target: 25,
      remaining: null,
      unitShown: true,
    });
  });
});

describe('BadgeSystem purity — the medal decisions', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const fade = deepFreeze({ ...family('series-svc-fade') });
    const tenure = deepFreeze({ ...family('series-tenure') });
    const held = deepFreeze(
      progressWith('series-svc-fade', 24, [
        [1, '2025-04-21'],
        [2, '2025-09-22'],
      ]),
    );
    const all = () => {
      const standing = BadgeSystem.standing(fade, held);
      const toNext = BadgeSystem.toNext(standing, false);
      return [
        BadgeSystem.isOneOff(fade),
        BadgeSystem.isSingleLevel(fade),
        BadgeSystem.countsInVisits(fade),
        BadgeSystem.latestEarned(held),
        BadgeSystem.topEarned(held),
        BadgeSystem.earnedOn(held, 2),
        BadgeSystem.landsOn(tenure, standing, localDate('2025-03-06'), TODAY),
        toNext,
        BadgeSystem.nextLevelNumber(standing),
        BadgeSystem.levelsShown(fade, standing, true),
        BadgeSystem.meterOf(standing, toNext, false),
        BadgeSystem.faceState(standing, true),
        BadgeSystem.ringState(standing, false),
        BadgeSystem.ringFraction(fade, standing),
        BadgeSystem.captionOf(fade, standing, null, false, false, null),
        BadgeSystem.canStillMove(fade, standing, false),
        BadgeSystem.ladder(fade, standing, held, true, false),
        BadgeSystem.detailState(fade, standing, held, false, false),
        BadgeSystem.progressCard(fade, standing, held, true, null, true),
      ];
    };
    expect(all()).toEqual(all());
  });
});
