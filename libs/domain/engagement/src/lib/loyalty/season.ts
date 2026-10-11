import { Result, fail, ok } from '@creativo/domain/kernel';
import { LocalizedText, LocalizedTextProps } from '@creativo/domain/catalog';
import {
  BadgeSeriesId as SystemSeriesId,
  EngagementErrorCode,
  LocalDate,
  defect,
} from '@core/primitives';
import {
  Gamification,
  SeasonKind,
  SeasonPhase as SystemSeasonPhase,
} from '@core/components';
import {
  type SeasonError as SystemSeasonError,
  SeasonSystem,
} from '@core/systems';
import { BadgeSeriesId, SeasonId } from '../ids';
import type { BadgeEmblem } from './badge-vocabulary';
import { IsoDate, sofiaDayOf } from './loyalty-calendar';
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
 * `SeasonSystem` (`@core/systems`, `season.system.ts`). The id and
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
    const rules = SeasonSystem.validate({
      seasonKind: SEASON_KIND[props.kind],
      windowFrom: from,
      windowUntil: until,
      trackSeriesId:
        props.trackSeriesId === null
          ? null
          : SystemSeriesId.of(props.trackSeriesId),
      // The announcement's Sofia day, read at this edge (T5).
      announcedLocalDate: dayOf(sofiaDayOf(props.announcedAt)),
    });
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
    return LEGACY_SEASON_PHASE[
      SeasonSystem.phaseOn(
        {
          windowFrom: dayOf(this.window.from),
          windowUntil: dayOf(this.window.until),
        },
        dayOf(today),
      )
    ];
  }

  /** Every family the window holds: the track first, then the rest in order. */
  familyIds(): readonly BadgeSeriesId[] {
    return SeasonSystem.familyIds(this);
  }
}

// ── The bridge: legacy words ↔ ecs-core structs (Phase 4 deletes it) ──────

/** The window's kind, in the system's words. */
const SEASON_KIND = {
  season: SeasonKind.Season,
  event: SeasonKind.Event,
} as const satisfies Record<SeasonProps['kind'], SeasonKind>;

/** A window's phase, in the legacy words. */
const LEGACY_SEASON_PHASE: Readonly<Record<SystemSeasonPhase, SeasonPhase>> = {
  [SystemSeasonPhase.Announced]: 'announced',
  [SystemSeasonPhase.Open]: 'open',
  [SystemSeasonPhase.Ended]: 'ended',
};

/** A Sofia day the class holds: a validated window end, a clock's «today». */
function dayOf(raw: IsoDate): LocalDate {
  const day = LocalDate.parse(raw);
  return day.ok ? day.value : defect(`${raw} is no calendar day`);
}

function legacyErrorOf(error: SystemSeasonError): SeasonError {
  switch (error.errorCode) {
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
