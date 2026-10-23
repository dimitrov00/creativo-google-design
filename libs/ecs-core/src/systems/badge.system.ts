import {
  type AwardSummary,
  BadgeLevel,
  Gamification,
  LadderRung,
  MedalCaption,
  MedalDetailState,
  MedalMeter,
  MedalProgressCard,
  MedalRingState,
  MedalState,
  type EarnedLevel,
  type SeriesStanding,
} from '@core/components';
import { LocalDate, Result, UtcEpochMs } from '@core/primitives';
import { EngagementError } from '@core/errors';
import type { BadgeProgress, BadgeSeries } from '@core/entities';

/*
 * ONE MEDAL FAMILY (client-card-redesign §4.2, `badge-series.ts:57-381`):
 * where a family stands for one client — derived from that client's
 * progress document, absent = not started — so the glance, the shelves
 * and the detail page can never disagree about it; and the rules its
 * levels keep together. Ids, titles and a coupon's words are guarded at
 * the edge, not here.
 */

/** What a family's own rules refuse. */
export type BadgeSeriesError =
  | EngagementError.BadgeSeriesNoLevels
  | EngagementError.BadgeSeriesLevelGap
  | EngagementError.BadgeSeriesTargetsNotRising
  | EngagementError.BadgeSeriesHomeless
  | EngagementError.BadgeSeriesOneOffWithSeveralLevels
  | EngagementError.BadgeSeriesRepeatableWithSeveralLevels
  | EngagementError.BadgeSeriesLevelWithoutRule
  | EngagementError.BadgeSeriesAwardNotPositive;

/** The parts of a family its rules read. */
export type BadgeSeriesShape = Pick<
  BadgeSeries,
  'categoryId' | 'seasonId' | 'levels' | 'repeatable'
>;

/** The one client's progress a standing reads; `null` = not started. */
export type BadgeProgressShape = Pick<BadgeProgress, 'value' | 'earned'>;

/** The earned levels of one client's progress — what the earned readings scan. */
export type EarnedLevels = Pick<BadgeProgress, 'earned'>;

/**
 * The next level a family can still be drawn towards — `toNext`'s answer:
 * the count, its threshold and the level's number.
 */
export type ToNextLevel = {
  readonly value: number;
  readonly target: number;
  readonly level: number;
};

/** The thin meter of a medal — `meterOf`'s answer; `fraction` is 0 but for `FRACTION`. */
export type MedalMeterReading = {
  readonly medalMeter: MedalMeter;
  readonly fraction: number;
};

/** One rung of a detail page's ladder — `ladder`'s answer, per level shown. */
export type MedalLadderStep = {
  readonly level: BadgeLevel;
  /** The level's earned entry, `null` = not earned. */
  readonly earned: EarnedLevel | null;
  readonly ladderRung: LadderRung;
};

/**
 * A detail page's state line — `detailState`'s answer: the state, the day
 * it names (`null` where it names none), the highest earned level (0 =
 * none) and how often the latest level was earned (0 = none).
 */
export type MedalDetailReading = {
  readonly medalDetailState: MedalDetailState;
  readonly day: LocalDate | null;
  readonly level: number;
  readonly count: number;
};

/**
 * A detail page's progress card — `progressCard`'s answer: the figure, its
 * threshold, what is left to the next level (`null` = nothing to say, or
 * the day it lands says it), where the visit on screen takes the count
 * (`null` = its draft holds nothing that counts) and whether the threshold
 * is shown beside the figure («23 от 25»).
 */
export type MedalProgressReading = {
  readonly medalProgressCard: MedalProgressCard;
  readonly value: number;
  readonly target: number | null;
  readonly remaining: number | null;
  readonly projected: number | null;
  readonly unitShown: boolean;
};

/** The earned entry of one level, or `null` — the first one, as stored. */
function earnedAt(
  progress: EarnedLevels | null,
  level: number,
): EarnedLevel | null {
  if (progress === null) return null;
  for (let i = 0; i < progress.earned.length; i++) {
    const earned = progress.earned[i] as EarnedLevel;
    if (earned.level === level) return earned;
  }
  return null;
}

/** 0 … 1; anything not finite is 0. */
function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

export const BadgeSystem = {
  /**
   * Where a family stands for one client. A complete family has no `next`;
   * a yearly one is complete once earned. The rim numeral is
   * `highestLevel` (0 = none), the caption `value` / `target`.
   */
  standing(
    series: Pick<BadgeSeries, 'levels'>,
    progress: BadgeProgressShape | null,
  ): SeriesStanding {
    let highestLevel = 0;
    if (progress !== null) {
      for (let i = 0; i < progress.earned.length; i++) {
        const earned = progress.earned[i] as EarnedLevel;
        if (earned.level > highestLevel) highestLevel = earned.level;
      }
    }
    let next: BadgeLevel | null = null;
    for (let i = 0; i < series.levels.length; i++) {
      const level = series.levels[i] as BadgeLevel;
      if (level.level > highestLevel) {
        next = level;
        break;
      }
    }
    return {
      medalState:
        highestLevel > 0
          ? MedalState.Earned
          : progress !== null
            ? MedalState.InProgress
            : MedalState.NotStarted,
      highestLevel,
      next,
      value: progress?.value ?? 0,
      target: next?.target ?? null,
    };
  },

  /** A level by its number, or `null`. */
  levelAt(
    series: Pick<BadgeSeries, 'levels'>,
    level: number,
  ): BadgeLevel | null {
    for (let i = 0; i < series.levels.length; i++) {
      const candidate = series.levels[i] as BadgeLevel;
      if (candidate.level === level) return candidate;
    }
    return null;
  },

  /**
   * The levels a family draws: all of them — but a family whose season or
   * event has ended keeps only the levels it reached (`ended`; the ladder
   * of a detail page, a season's track; `achievements.presenter.ts:1122`,
   * `medal-detail.presenter.ts:942`).
   */
  levelsShown(
    series: Pick<BadgeSeries, 'levels'>,
    standing: Pick<SeriesStanding, 'highestLevel'>,
    ended: boolean,
  ): readonly BadgeLevel[] {
    if (!ended) return series.levels;
    const out: BadgeLevel[] = [];
    for (let i = 0; i < series.levels.length; i++) {
      const level = series.levels[i] as BadgeLevel;
      if (level.level <= standing.highestLevel) out.push(level);
    }
    return out;
  },

  /**
   * The next level the family is drawn towards — the count, its threshold
   * and the level — while there is one with a threshold and the family's
   * season has not ended (`ended`: an ended family has no next level to be
   * drawn towards). `null` otherwise: complete, a single act, ended.
   */
  toNext(standing: SeriesStanding, ended: boolean): ToNextLevel | null {
    if (standing.next === null || standing.target === null || ended) {
      return null;
    }
    return {
      value: standing.value,
      target: standing.target,
      level: standing.next.level,
    };
  },

  /** The number of the level the family is heading for: its next one, else the one after its highest. */
  nextLevelNumber(
    standing: Pick<SeriesStanding, 'next' | 'highestLevel'>,
  ): number {
    return standing.next?.level ?? standing.highestLevel + 1;
  },

  /**
   * A single act: one level with no target («Добре дошъл», «Рожден ден в
   * салона») — the family's one level is a one-off (`BadgeLevel.isOneOff`).
   */
  isOneOff(series: Pick<BadgeSeries, 'levels'>): boolean {
    const first = series.levels[0];
    return (
      series.levels.length === 1 &&
      first !== undefined &&
      BadgeLevel.isOneOff(first)
    );
  },

  /**
   * A family of ONE level, counted or not («Есенно утро», «Добре дошъл»):
   * earning it is the whole family, so once earned it is a single act.
   */
  isSingleLevel(series: Pick<BadgeSeries, 'levels'>): boolean {
    return series.levels.length === 1;
  },

  /**
   * The family's count is a count of VISITS: a kind of visit
   * (`Gamification.isVisitKind`), or the rhythm's run — no metric, with
   * targets (a single act counts nothing).
   */
  countsInVisits(series: Pick<BadgeSeries, 'metric' | 'levels'>): boolean {
    return series.metric === null
      ? !BadgeSystem.isOneOff(series)
      : Gamification.isVisitKind(series.metric);
  },

  /** The level earned most recently — the latest stamp; the first one wins a tie. `null` = none. */
  latestEarned(progress: EarnedLevels | null): EarnedLevel | null {
    if (progress === null) return null;
    let latest: EarnedLevel | null = null;
    for (let i = 0; i < progress.earned.length; i++) {
      const earned = progress.earned[i] as EarnedLevel;
      if (
        latest === null ||
        UtcEpochMs.compare(earned.earnedAtUtcMs, latest.earnedAtUtcMs) > 0
      ) {
        latest = earned;
      }
    }
    return latest;
  },

  /** The highest level earned — the one the medal wears; the first one wins a tie. `null` = none. */
  topEarned(progress: EarnedLevels | null): EarnedLevel | null {
    if (progress === null) return null;
    let top: EarnedLevel | null = null;
    for (let i = 0; i < progress.earned.length; i++) {
      const earned = progress.earned[i] as EarnedLevel;
      if (top === null || earned.level > top.level) top = earned;
    }
    return top;
  },

  /** The stored shop day a level was earned on (a yearly one keeps its latest, T5); `null` = not earned. */
  earnedOn(progress: EarnedLevels | null, level: number): LocalDate | null {
    return earnedAt(progress, level)?.earnedLocalDate ?? null;
  },

  /**
   * The day a calendar-driven family's next level lands — tenure's: the
   * first worked visit and the level's days. Without a first visit, today
   * and the days still missing. Never before today: a level due and not
   * yet stamped lands today. `null` for every other family, and for one
   * with no target left.
   */
  landsOn(
    series: Pick<BadgeSeries, 'metric'>,
    standing: Pick<SeriesStanding, 'value' | 'target'>,
    firstVisitOn: LocalDate | null,
    today: LocalDate,
  ): LocalDate | null {
    if (!Gamification.isCalendarDriven(series) || standing.target === null) {
      return null;
    }
    const day =
      firstVisitOn === null
        ? LocalDate.addDays(
            today,
            Math.max(0, standing.target - standing.value),
          )
        : LocalDate.addDays(firstVisitOn, standing.target);
    return LocalDate.compare(day, today) < 0 ? today : day;
  },

  /**
   * The thin meter: `PENDING` while the visit on screen completes the
   * level; else the fraction of the way to the next level (clamped to
   * 0 … 1) for a family under way with a next level (`toNext`, the gated
   * reading); else `NONE`. `fraction` is 0 but for `FRACTION`.
   */
  meterOf(
    standing: Pick<SeriesStanding, 'medalState'>,
    toNext: ToNextLevel | null,
    pending: boolean,
  ): MedalMeterReading {
    if (pending) return { medalMeter: MedalMeter.Pending, fraction: 0 };
    if (standing.medalState !== MedalState.NotStarted && toNext !== null) {
      return {
        medalMeter: MedalMeter.Fraction,
        fraction: Math.min(1, Math.max(0, toNext.value / toNext.target)),
      };
    }
    return { medalMeter: MedalMeter.None, fraction: 0 };
  },

  /**
   * The state a medal's face is drawn in: a level the visit on screen
   * completes is never drawn as the dullest medal — short of started it is
   * in progress; otherwise the standing's own.
   */
  faceState(
    standing: Pick<SeriesStanding, 'medalState'>,
    pending: boolean,
  ): MedalState {
    return pending && standing.medalState === MedalState.NotStarted
      ? MedalState.InProgress
      : standing.medalState;
  },

  /**
   * The state of a medal in its ring (revision 3 §3.8): `COMPLETE` once
   * every level is earned, else the face's state.
   */
  ringState(
    standing: Pick<SeriesStanding, 'medalState' | 'next'>,
    pending: boolean,
  ): MedalRingState {
    if (standing.medalState === MedalState.Earned && standing.next === null) {
      return MedalRingState.Complete;
    }
    switch (BadgeSystem.faceState(standing, pending)) {
      case MedalState.NotStarted:
        return MedalRingState.NotStarted;
      case MedalState.InProgress:
        return MedalRingState.InProgress;
      case MedalState.Earned:
        return MedalRingState.Earned;
    }
  },

  /**
   * The ring's arc, 0 … 1 from the last threshold won to the next («Фейд»
   * at 23 with II = 10 and III = 25 draws 13 of 15). `null` where there is
   * no next threshold — a single act, every level won — or no span to
   * draw. A windowed count that fell under the level it once reached draws
   * an empty arc, never a negative one.
   */
  ringFraction(
    series: Pick<BadgeSeries, 'levels'>,
    standing: Pick<
      SeriesStanding,
      'next' | 'target' | 'highestLevel' | 'value'
    >,
  ): number | null {
    if (standing.next === null || standing.target === null) return null;
    const from =
      BadgeSystem.levelAt(series, standing.highestLevel)?.target ?? 0;
    const span = standing.target - from;
    return span > 0 ? clamp01((standing.value - from) / span) : null;
  },

  /**
   * The caption a medal wears on a rail or a grid, by the numeral rule —
   * first match wins: the visit on screen completes it (`pending`); an
   * ended season's family with a level and a next one says nothing; a next
   * level is worded by the day it lands (`landsOn` — the UNGATED reading,
   * never the meter's), else a single act not yet done, else the count
   * towards it; a single level or a yearly act, earned, by its day; else
   * complete.
   */
  captionOf(
    series: Pick<BadgeSeries, 'levels' | 'repeatable'>,
    standing: Pick<SeriesStanding, 'next' | 'target'>,
    latest: EarnedLevel | null,
    ended: boolean,
    pending: boolean,
    landsOn: LocalDate | null,
  ): MedalCaption {
    if (pending) return MedalCaption.WithThisVisit;
    if (standing.next !== null && latest !== null && ended) {
      return MedalCaption.None;
    }
    if (standing.next !== null) {
      if (landsOn !== null) return MedalCaption.LandsOn;
      return standing.target === null
        ? MedalCaption.NotYet
        : MedalCaption.ToLevel;
    }
    if (
      (BadgeSystem.isSingleLevel(series) || series.repeatable) &&
      latest !== null
    ) {
      return MedalCaption.OnDay;
    }
    return MedalCaption.Complete;
  },

  /**
   * The family can still move: it is awarded, a level is left to earn and
   * its season (if it has one) has not ended. What cannot move offers no
   * verb and counts no visit.
   */
  canStillMove(
    series: Pick<BadgeSeries, 'retiredAtUtcMs'>,
    standing: Pick<SeriesStanding, 'next'>,
    ended: boolean,
  ): boolean {
    return !BadgeSystem.isRetired(series) && standing.next !== null && !ended;
  },

  /**
   * A detail page's ladder: every level shown (`levelsShown`) with its
   * earned entry — `PASSED` once earned, `NEXT` for the next level of a
   * family that can still move (`canMove`), `LATER` otherwise.
   */
  ladder(
    series: Pick<BadgeSeries, 'levels'>,
    standing: Pick<SeriesStanding, 'next' | 'highestLevel'>,
    progress: EarnedLevels | null,
    canMove: boolean,
    ended: boolean,
  ): readonly MedalLadderStep[] {
    const levels = BadgeSystem.levelsShown(series, standing, ended);
    const out: MedalLadderStep[] = [];
    for (let i = 0; i < levels.length; i++) {
      const level = levels[i] as BadgeLevel;
      const earned = earnedAt(progress, level.level);
      out.push({
        level,
        earned,
        ladderRung:
          earned !== null
            ? LadderRung.Passed
            : canMove && standing.next?.level === level.level
              ? LadderRung.Next
              : LadderRung.Later,
      });
    }
    return out;
  },

  /**
   * A detail page's state line, first match wins: no longer awarded
   * (`retired`); a yearly act earned — how often, and when last; an ended
   * season's family with a level left; a single act (or one level, done) —
   * its day, or not yet; not started; under way with no level yet; every
   * level earned — since the last one's day; else at its highest level
   * since that level's day.
   */
  detailState(
    series: Pick<BadgeSeries, 'levels' | 'repeatable'>,
    standing: Pick<SeriesStanding, 'medalState' | 'next'>,
    progress: EarnedLevels | null,
    ended: boolean,
    retired: boolean,
  ): MedalDetailReading {
    const last = BadgeSystem.latestEarned(progress);
    const top = BadgeSystem.topEarned(progress);
    const level = top?.level ?? 0;
    const count = last?.count ?? 0;
    const said = (
      medalDetailState: MedalDetailState,
      day: LocalDate | null,
    ): MedalDetailReading => ({ medalDetailState, day, level, count });
    if (retired) return said(MedalDetailState.Retired, null);
    if (series.repeatable && last !== null) {
      return said(
        last.count > 1
          ? MedalDetailState.Repeated
          : MedalDetailState.OneOffEarned,
        last.earnedLocalDate,
      );
    }
    if (standing.next !== null && ended) {
      return said(MedalDetailState.SeasonEnded, null);
    }
    if (
      BadgeSystem.isOneOff(series) ||
      (BadgeSystem.isSingleLevel(series) && standing.next === null)
    ) {
      return last === null
        ? said(MedalDetailState.OneOffNotYet, null)
        : said(MedalDetailState.OneOffEarned, last.earnedLocalDate);
    }
    if (standing.medalState === MedalState.NotStarted) {
      return said(MedalDetailState.NotStarted, null);
    }
    if (top === null) return said(MedalDetailState.UnderWay, null);
    if (standing.next === null) {
      return last === null
        ? said(MedalDetailState.Complete, null)
        : said(MedalDetailState.CompleteSince, last.earnedLocalDate);
    }
    return said(MedalDetailState.LevelSince, top.earnedLocalDate);
  },

  /**
   * A detail page's progress card — the ONLY place for the count:
   *
   * - a single act: «0 от 1» until done (the threshold shown while it can
   *   still move), its day once done (`value` 1);
   * - a ladder climbed to its top: its last threshold;
   * - a family that can no longer move (`canMove`), or with no threshold:
   *   where it stopped, nothing reads as progress;
   * - else towards the next level: the figure and its threshold, what is
   *   left (none once the level is due, and none for a family worded by the
   *   day its level lands — `landsOn`), and where the visit on screen takes
   *   the count when its draft counts (`draftCounts`), never past the
   *   threshold.
   */
  progressCard(
    series: Pick<BadgeSeries, 'levels'>,
    standing: Pick<SeriesStanding, 'next' | 'target' | 'value'>,
    progress: EarnedLevels | null,
    canMove: boolean,
    landsOn: LocalDate | null,
    draftCounts: boolean,
  ): MedalProgressReading {
    if (BadgeSystem.isOneOff(series)) {
      const done = BadgeSystem.latestEarned(progress) !== null;
      return {
        medalProgressCard: MedalProgressCard.OneOff,
        value: done ? 1 : 0,
        target: 1,
        remaining: null,
        projected: null,
        unitShown: !done && canMove,
      };
    }
    if (standing.next === null) {
      const last = series.levels[series.levels.length - 1];
      return {
        medalProgressCard: MedalProgressCard.Complete,
        value: last?.target ?? standing.value,
        target: null,
        remaining: null,
        projected: null,
        unitShown: false,
      };
    }
    const target = standing.target;
    if (target === null || !canMove) {
      return {
        medalProgressCard: MedalProgressCard.Stopped,
        value: standing.value,
        target: null,
        remaining: null,
        projected: null,
        unitShown: false,
      };
    }
    const left = target - standing.value;
    return {
      medalProgressCard: MedalProgressCard.ToNext,
      value: standing.value,
      target,
      remaining: landsOn !== null ? null : left > 0 ? left : null,
      projected: draftCounts ? Math.min(standing.value + 1, target) : null,
      unitShown: true,
    };
  },

  /** Withdrawn from the catalogue: shown only where a client already started it. */
  isRetired(series: Pick<BadgeSeries, 'retiredAtUtcMs'>): boolean {
    return series.retiredAtUtcMs !== null;
  },

  /** Tenure: nothing a visit does moves it, so it never sits in «Скоро». */
  isCalendarDriven(series: Pick<BadgeSeries, 'metric'>): boolean {
    return Gamification.isCalendarDriven(series);
  },

  /**
   * One level's own rules: it names its rule, and pays positive figures
   * (`Gamification.isAwardPositive`; a coupon's words are the edge's).
   */
  levelProblems(level: BadgeLevel): readonly BadgeSeriesError[] {
    const errors: BadgeSeriesError[] = [];
    if (level.ruleId.trim().length === 0) {
      errors.push(EngagementError.badgeSeriesLevelWithoutRule(level.level));
    }
    for (let k = 0; k < level.awards.length; k++) {
      const award = level.awards[k] as AwardSummary;
      if (!Gamification.isAwardPositive(award)) {
        errors.push(
          EngagementError.badgeSeriesAwardNotPositive(
            level.level,
            award.awardKind,
          ),
        );
      }
    }
    return errors;
  },

  /**
   * The family's levels checked together, and its home: it has levels,
   * numbered 1, 2, 3 … with positive whole targets that rise, lives in a
   * category or a season, and has one level when it is a one-off act or
   * yearly (`badge-series.ts` `shapeProblems`).
   */
  shapeProblems(series: BadgeSeriesShape): readonly BadgeSeriesError[] {
    const errors: BadgeSeriesError[] = [];
    const { levels } = series;
    if (levels.length === 0) errors.push(EngagementError.badgeSeriesNoLevels());
    const numbers: number[] = [];
    const targets: number[] = [];
    let gap = false;
    let oneOff = false;
    for (let i = 0; i < levels.length; i++) {
      const level = levels[i] as BadgeLevel;
      numbers.push(level.level);
      if (level.level !== i + 1) gap = true;
      if (level.target === null) oneOff = true;
      else targets.push(level.target);
    }
    if (gap) errors.push(EngagementError.badgeSeriesLevelGap(numbers));
    let rising = true;
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i] as number;
      if (
        !Number.isInteger(target) ||
        target <= 0 ||
        (i > 0 && target <= (targets[i - 1] as number))
      ) {
        rising = false;
      }
    }
    if (!rising) {
      errors.push(EngagementError.badgeSeriesTargetsNotRising(targets));
    }
    if (series.categoryId === null && series.seasonId === null) {
      errors.push(EngagementError.badgeSeriesHomeless());
    }
    if (levels.length > 1 && oneOff) {
      errors.push(EngagementError.badgeSeriesOneOffWithSeveralLevels());
    }
    if (series.repeatable && levels.length > 1) {
      errors.push(EngagementError.badgeSeriesRepeatableWithSeveralLevels());
    }
    return errors;
  },

  /**
   * Every fault of the family at once — each level's own rules, in level
   * order, then the levels together and the home. The family comes back as
   * it was handed in.
   */
  validate<S extends BadgeSeriesShape>(
    series: S,
  ): Result<S, readonly BadgeSeriesError[]> {
    const errors: BadgeSeriesError[] = [];
    for (let i = 0; i < series.levels.length; i++) {
      const problems = BadgeSystem.levelProblems(
        series.levels[i] as BadgeLevel,
      );
      for (let k = 0; k < problems.length; k++) {
        errors.push(problems[k] as BadgeSeriesError);
      }
    }
    const shape = BadgeSystem.shapeProblems(series);
    for (let i = 0; i < shape.length; i++) {
      errors.push(shape[i] as BadgeSeriesError);
    }
    return errors.length > 0 ? Result.err(errors) : Result.ok(series);
  },
} as const;
