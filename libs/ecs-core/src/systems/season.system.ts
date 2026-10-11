import {
  EngagementError,
  Result,
  type BadgeSeriesId,
  LocalDate,
} from '@core/primitives';
import {
  Gamification,
  SeasonKind,
  SeasonPhase,
  type SeasonWindow,
} from '@core/components';

/*
 * A SEASON'S WINDOW (client-card-redesign §4.1, `season.ts:62-131`): where
 * a named, dated window stands on a shop day, which families it holds, and
 * the rules a window keeps — two real days in order, a track for a season
 * and none for an event, announced at least `Gamification.SEASON_NOTICE_
 * DAYS` before it opens (R29). Ids and titles are guarded at the edge, not
 * here. Zone-blind: the announcement is judged on its stored shop day
 * (`announcedLocalDate`, T5).
 */

/** What a season's own rules refuse. */
export type SeasonError =
  | EngagementError.SeasonWindowMalformed
  | EngagementError.SeasonWindowInverted
  | EngagementError.SeasonAnnouncedLate
  | EngagementError.SeasonEventWithTrack
  | EngagementError.SeasonWithoutTrack;

/**
 * The parts of a season its rules read — foreign input still to be judged
 * (the L3 escape): the window's two days are the raw text an author typed,
 * which the rule proves real; a stored `Season` is one of these as it is.
 */
export type SeasonShapeInput = {
  readonly seasonKind: SeasonKind;
  readonly windowFrom: string;
  readonly windowUntil: string;
  readonly trackSeriesId: BadgeSeriesId | null;
  readonly announcedLocalDate: LocalDate;
};

export const SeasonSystem = {
  /**
   * The season's own rules, every fault at once: a window of two real
   * days, not ending before it starts; the announcement — on its shop day —
   * at least the notice period before the first day; a track for a season,
   * none for an event. The season comes back as it was handed in.
   */
  validate<S extends SeasonShapeInput>(
    season: S,
  ): Result<S, readonly SeasonError[]> {
    const errors: SeasonError[] = [];
    const from = LocalDate.parse(season.windowFrom);
    const until = LocalDate.parse(season.windowUntil);
    if (!from.ok || !until.ok) {
      errors.push(
        EngagementError.seasonWindowMalformed(
          season.windowFrom,
          season.windowUntil,
        ),
      );
    } else {
      if (from.value > until.value) {
        errors.push(
          EngagementError.seasonWindowInverted(from.value, until.value),
        );
      }
      if (
        LocalDate.daysBetween(season.announcedLocalDate, from.value) <
        Gamification.SEASON_NOTICE_DAYS
      ) {
        errors.push(
          EngagementError.seasonAnnouncedLate(
            season.announcedLocalDate,
            from.value,
            Gamification.SEASON_NOTICE_DAYS,
          ),
        );
      }
    }
    if (
      season.seasonKind === SeasonKind.Event &&
      season.trackSeriesId !== null
    ) {
      errors.push(EngagementError.seasonEventWithTrack());
    }
    if (
      season.seasonKind === SeasonKind.Season &&
      season.trackSeriesId === null
    ) {
      errors.push(EngagementError.seasonWithoutTrack());
    }
    return errors.length > 0 ? Result.err(errors) : Result.ok(season);
  },

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
} as const;
