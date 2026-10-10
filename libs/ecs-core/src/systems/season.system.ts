import { DayKey } from '../components/day-key.data';
import { EngagementError } from '../components/engagement-errors.data';
import {
  Gamification,
  SeasonKind,
  SeasonPhase,
  type SeasonWindow,
} from '../components/gamification.data';
import { Result } from '../components/result.data';
import type { SeasonEntity } from '../entities/season.entity';
import { ZonedTimeSystem } from './zoned-time.system';

/*
 * A SEASON'S WINDOW (client-card-redesign §4.1, `season.ts:62-131`): where
 * a named, dated window stands on a shop day, which families it holds, and
 * the rules a window keeps — two real days in order, a track for a season
 * and none for an event, announced at least `Gamification.SEASON_NOTICE_
 * DAYS` before it opens (R29). Ids and titles are guarded at the edge, not
 * here.
 */

/** What a season's own rules refuse. */
export type SeasonError =
  | EngagementError.SeasonWindowMalformed
  | EngagementError.SeasonWindowInverted
  | EngagementError.SeasonAnnouncedLate
  | EngagementError.SeasonEventWithTrack
  | EngagementError.SeasonWithoutTrack;

/** The parts of a season its rules read. */
export type SeasonShape = Pick<
  SeasonEntity,
  'kind' | 'window' | 'trackSeriesId' | 'announcedAtMs'
>;

export const SeasonSystem = {
  /**
   * The season's own rules, every fault at once: a window of two real
   * days, not ending before it starts; the announcement — on the shop's
   * calendar in `zone` — at least the notice period before the first day;
   * a track for a season, none for an event. The season comes back as it
   * was handed in.
   */
  validate<S extends SeasonShape>(
    season: S,
    zone: string,
  ): Result<S, readonly SeasonError[]> {
    const errors: SeasonError[] = [];
    const { from, until } = season.window;
    if (!DayKey.isValid(from) || !DayKey.isValid(until)) {
      errors.push(EngagementError.seasonWindowMalformed(from, until));
    } else {
      if (from > until) {
        errors.push(EngagementError.seasonWindowInverted(from, until));
      }
      const announced = ZonedTimeSystem.wallClockOf(season.announcedAtMs, zone);
      if (
        announced.ok &&
        ZonedTimeSystem.daysBetween(announced.value.dayKey, from) <
          Gamification.SEASON_NOTICE_DAYS
      ) {
        errors.push(
          EngagementError.seasonAnnouncedLate(
            announced.value.dayKey,
            from,
            Gamification.SEASON_NOTICE_DAYS,
          ),
        );
      }
    }
    if (season.kind === SeasonKind.Event && season.trackSeriesId !== null) {
      errors.push(EngagementError.seasonEventWithTrack());
    }
    if (season.kind === SeasonKind.Season && season.trackSeriesId === null) {
      errors.push(EngagementError.seasonWithoutTrack());
    }
    return errors.length > 0 ? Result.err(errors) : Result.ok(season);
  },

  /** Where the window stands on a shop day, both ends inclusive. */
  phaseOn(window: SeasonWindow, today: DayKey): SeasonPhase {
    if (today < window.from) return SeasonPhase.Announced;
    return today > window.until ? SeasonPhase.Ended : SeasonPhase.Open;
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
} as const;
