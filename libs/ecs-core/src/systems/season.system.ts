import { LocalDate } from '@core/primitives';
import {
  type BadgeLevel,
  SeasonPhase,
  SeasonTrackState,
  type SeasonWindow,
  type SeriesStanding,
} from '@core/components';
import type { BadgeSeries } from '@core/entities';
import { BadgeSystem } from './badge.system';

/*
 * A SEASON'S WINDOW (client-card-redesign §4.1, `season.ts:62-131`): where
 * a named, dated window stands on a shop day, which families it holds, the
 * archive's years and the track's outlook. Shop days only (T5).
 */

/**
 * How a season's track reads — `trackOutlook`'s answer: the state its
 * sentence says, the levels its steps draw, the gauge's top (`max`, the
 * last level's threshold, 1 with no level), where the gauge stands
 * (`drawn`), what is left to the next level (`remaining`, at least 1; 0
 * with no next level), whether the steps are checked to their end
 * (`finished`), the level the season's progress stamped (`level`, 0 =
 * none) and whether the sentence opens on the level won (`fromLevel`).
 */
export type SeasonTrackOutlook = {
  readonly seasonTrackState: SeasonTrackState;
  readonly levels: readonly BadgeLevel[];
  readonly max: number;
  readonly drawn: number;
  readonly remaining: number;
  readonly finished: boolean;
  readonly level: number;
  readonly fromLevel: boolean;
};

export const SeasonSystem = {
  /** Where the window stands on a shop day, both ends inclusive. */
  phaseOn(window: SeasonWindow, today: LocalDate): SeasonPhase {
    if (today < window.windowFrom) return SeasonPhase.Announced;
    return today > window.windowUntil ? SeasonPhase.Ended : SeasonPhase.Open;
  },

  /** Every family the window holds: the track first, then the rest in order. */
  familyIds<I>(season: {
    readonly trackSeriesId: I | null;
    readonly seriesIds: readonly I[];
  }): readonly I[] {
    if (season.trackSeriesId === null) return season.seriesIds;
    const ids: I[] = [season.trackSeriesId];
    for (let i = 0; i < season.seriesIds.length; i++) {
      ids.push(season.seriesIds[i] as I);
    }
    return ids;
  },

  /**
   * The archive's grouping: windows by the year their last day falls in,
   * the newest year first; within a year, the order they came in.
   */
  byClosingYear<N extends { readonly windowUntil: LocalDate }>(
    seasons: readonly N[],
  ): readonly { readonly year: number; readonly seasons: readonly N[] }[] {
    const byYear = new Map<number, N[]>();
    for (let i = 0; i < seasons.length; i++) {
      const season = seasons[i] as N;
      const year = LocalDate.parts(season.windowUntil).year;
      const held = byYear.get(year);
      if (held === undefined) byYear.set(year, [season]);
      else held.push(season);
    }
    const out: { readonly year: number; readonly seasons: readonly N[] }[] = [];
    for (const [year, held] of byYear) out.push({ year, seasons: held });
    return out.sort((a, b) => b.year - a.year);
  },

  /**
   * How a season's track reads on its phase. The count is the season's
   * own `trackValue` where its progress holds one, else the family's. An
   * ended window keeps the levels it reached (`BadgeSystem.levelsShown`)
   * and says only that it ended (`ENDED`); else a track with no next
   * threshold is `COMPLETE`; else the visit on screen completing the next
   * level (`pending`, the caller's «с това посещение» answer — counted only
   * while the window runs and a next threshold exists) is `PENDING`, the
   * gauge standing at that threshold; else `TO_NEXT`, `remaining` visits
   * away. The steps are `finished` when nothing is pending and the gauge
   * reached its top. `fromLevel`: the sentence opens on the level won — a
   * running window, a level won, a next level, and nothing pending.
   */
  trackOutlook(
    track: Pick<BadgeSeries, 'levels'>,
    standing: SeriesStanding,
    trackValue: number | null,
    trackLevel: number | null,
    phase: SeasonPhase,
    pending: boolean,
  ): SeasonTrackOutlook {
    const value = trackValue ?? standing.value;
    const ended = phase === SeasonPhase.Ended;
    const levels = BadgeSystem.levelsShown(track, standing, ended);
    const last = levels[levels.length - 1];
    const max = last === undefined ? 1 : (last.target ?? last.level);
    const nextTarget =
      standing.next !== null && standing.target !== null
        ? standing.target
        : null;
    const pendingHere = !ended && nextTarget !== null && pending;
    const drawn = Math.min(
      pendingHere && nextTarget !== null ? nextTarget : value,
      max,
    );
    return {
      seasonTrackState: ended
        ? SeasonTrackState.Ended
        : nextTarget === null
          ? SeasonTrackState.Complete
          : pendingHere
            ? SeasonTrackState.Pending
            : SeasonTrackState.ToNext,
      levels,
      max,
      drawn,
      remaining: nextTarget === null ? 0 : Math.max(1, nextTarget - value),
      finished: !pendingHere && drawn >= max,
      level: trackLevel ?? 0,
      fromLevel:
        !ended &&
        standing.highestLevel > 0 &&
        standing.next !== null &&
        !pending,
    };
  },
} as const;
