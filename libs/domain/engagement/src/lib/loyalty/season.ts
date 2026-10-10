import { Result, fail, ok } from '@creativo/domain/kernel';
import { LocalizedText, LocalizedTextProps } from '@creativo/domain/catalog';
import {
  DayKey,
  EngagementErrorCode,
  Gamification,
  type SeasonError as SystemSeasonError,
  SeasonSystem,
  type SeriesId,
} from '@creativo/ecs-core';
import { BadgeSeriesId, SeasonId } from '../ids';
import type { BadgeEmblem } from './badge-vocabulary';
import { IsoDate, LOYALTY_ZONE } from './loyalty-calendar';
import {
  SeasonAnnouncedLateError,
  SeasonError,
  SeasonEventWithTrackError,
  SeasonWindowInvertedError,
  SeasonWindowMalformedError,
  SeasonWithoutTrackError,
} from './season.errors';

/*
 * `seasons/{id}` as a class — a thin shim since the ECS migration's Phase 2:
 * the window's rules, its phase on a day and its families are
 * `SeasonSystem` (`@creativo/ecs-core`, `season.system.ts`). The id and
 * title guards stay with the class until Phase 4 deletes it; the bridge to
 * the system's structs is the private helpers at the end.
 */

/**
 * How far ahead a season is announced: the loyalty policy's rule-change
 * notice (R29, `ruleChangeNoticeDays`). A season changes what earns, so the
 * client hears of it before it counts.
 */
export const SEASON_NOTICE_DAYS: number = Gamification.SEASON_NOTICE_DAYS;

/** A season or an event on a day: announced — shown «от 1.11», no progress yet; open; ended — archived. */
export type SeasonPhase = 'announced' | 'open' | 'ended';

export interface SeasonProps {
  id: string;
  kind: 'season' | 'event';
  title: LocalizedTextProps;
  emblem: BadgeEmblem;
  window: { from: string; until: string };
  trackSeriesId: string | null;
  seriesIds: readonly string[];
  announcedAt: Date;
  version: number;
}

/**
 * `seasons/{id}` — a named, dated window (Europe/Sofia, both ends
 * inclusive). A season has a track — the family its gauge draws, «Есен
 * 2026» I…V — and families of its own; an event is a short window with
 * families and no track («Седмица на брадата»). Nothing counts down: the
 * page shows real dates, «до 30.11».
 */
export class Season {
  private constructor(
    readonly id: SeasonId,
    readonly kind: 'season' | 'event',
    readonly title: LocalizedText,
    readonly emblem: BadgeEmblem,
    readonly window: { readonly from: IsoDate; readonly until: IsoDate },
    readonly trackSeriesId: BadgeSeriesId | null,
    /** The window's other families, in order — never the track. */
    readonly seriesIds: readonly BadgeSeriesId[],
    readonly announcedAt: Date,
    readonly version: number,
  ) {}

  static create(props: SeasonProps): Result<Season, SeasonError[]> {
    const errors: SeasonError[] = [];
    const id = SeasonId.create(props.id);
    if (id.isFailure()) errors.push(id.error);
    const title = LocalizedText.create(props.title);
    if (title.isFailure()) errors.push(...title.error);

    let trackSeriesId: BadgeSeriesId | null = null;
    if (props.trackSeriesId !== null) {
      const track = BadgeSeriesId.create(props.trackSeriesId);
      if (track.isFailure()) errors.push(track.error);
      else trackSeriesId = track.value;
    }
    const seriesIds: BadgeSeriesId[] = [];
    for (const raw of props.seriesIds) {
      const seriesId = BadgeSeriesId.create(raw);
      if (seriesId.isFailure()) errors.push(seriesId.error);
      else seriesIds.push(seriesId.value);
    }

    const { from, until } = props.window;
    const rules = SeasonSystem.validate(
      {
        kind: props.kind,
        window: { from: DayKey.of(from), until: DayKey.of(until) },
        trackSeriesId:
          props.trackSeriesId === null
            ? null
            : (props.trackSeriesId as SeriesId),
        announcedAtMs: props.announcedAt.getTime(),
      },
      LOYALTY_ZONE,
    );
    if (!rules.ok) {
      for (const error of rules.error) errors.push(legacyErrorOf(error));
    }

    if (errors.length > 0 || id.isFailure() || title.isFailure()) {
      return fail(errors);
    }
    return ok(
      new Season(
        id.value,
        props.kind,
        title.value,
        props.emblem,
        { from, until },
        trackSeriesId,
        seriesIds,
        props.announcedAt,
        props.version,
      ),
    );
  }

  /** Where the window stands on a Sofia day, both ends inclusive. */
  phaseOn(today: IsoDate): SeasonPhase {
    return SeasonSystem.phaseOn(
      {
        from: DayKey.of(this.window.from),
        until: DayKey.of(this.window.until),
      },
      DayKey.of(today),
    );
  }

  /** Every family the window holds: the track first, then the rest in order. */
  familyIds(): readonly BadgeSeriesId[] {
    return SeasonSystem.familyIds(this);
  }
}

// ── The bridge: ecs-core struct error → legacy class (Phase 4 deletes it) ──

function legacyErrorOf(error: SystemSeasonError): SeasonError {
  switch (error.code) {
    case EngagementErrorCode.SeasonWindowMalformed:
      return new SeasonWindowMalformedError(error.from, error.until);
    case EngagementErrorCode.SeasonWindowInverted:
      return new SeasonWindowInvertedError(error.from, error.until);
    case EngagementErrorCode.SeasonAnnouncedLate:
      return new SeasonAnnouncedLateError(
        error.announcedOn,
        error.from,
        error.noticeDays,
      );
    case EngagementErrorCode.SeasonEventWithTrack:
      return new SeasonEventWithTrackError();
    default:
      return new SeasonWithoutTrackError();
  }
}
