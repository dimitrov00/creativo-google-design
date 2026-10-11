import type {
  BadgeEmblem,
  SeasonKind,
  SeasonWindow,
  LocalizedText,
} from '@core/components';
import type {
  BadgeSeriesId,
  SeasonId,
  LocalDate,
  UtcEpochMs,
} from '@core/primitives';

/**
 * The season's identity slice. `seasonKind` was `kind` (N15);
 * `announcedAtUtcMs` + `announcedLocalDate` are the announcement's instant
 * and its shop day, written together (T5: the notice is judged on the day).
 */
export type SeasonMeta = {
  readonly id: SeasonId;
  readonly seasonKind: SeasonKind;
  readonly title: LocalizedText;
  readonly emblem: BadgeEmblem;
  /** A season's track family; `null` on an event. */
  readonly trackSeriesId: BadgeSeriesId | null;
  /** The window's other families, in order — never the track. */
  readonly seriesIds: readonly BadgeSeriesId[];
  readonly announcedAtUtcMs: UtcEpochMs;
  readonly announcedLocalDate: LocalDate;
  readonly version: number;
};

/**
 * `seasons/{id}` — a named, dated window in the shop's calendar, both ends
 * inclusive. A season has a track — the family its gauge draws, «Есен 2026»
 * I…V — and families of its own; an event is a short window with families
 * and no track («Седмица на брадата»). Announced at least
 * `Gamification.SEASON_NOTICE_DAYS` before it opens; SeasonSystem `phaseOn`
 * says where it stands on a day. Nothing counts down: the page shows real
 * dates. The archetype (Law 6): the identity slice and the `SeasonWindow`
 * slice (`windowFrom`, `windowUntil`, was `window`).
 */
export type Season = SeasonMeta & SeasonWindow;
