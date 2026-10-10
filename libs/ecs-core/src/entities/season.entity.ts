import type {
  BadgeEmblem,
  SeasonKind,
  SeasonWindow,
} from '../components/gamification.data';
import type { LocalizedText } from '../components/localized-text.data';
import type { SeriesId } from './badge-series.entity';

export type SeasonId = string & { readonly __brand: unique symbol };
export const SeasonId = {
  /** The only cast site. Validate the raw string at the edge, not here. */
  of: (raw: string): SeasonId => raw as SeasonId,
} as const;

/**
 * `seasons/{id}` — a named, dated window in the shop's calendar, both ends
 * inclusive. A season has a track — the family its gauge draws, «Есен 2026»
 * I…V — and families of its own; an event is a short window with families
 * and no track («Седмица на брадата»). Announced at least
 * `Gamification.SEASON_NOTICE_DAYS` before it opens; SeasonSystem `phaseOn`
 * says where it stands on a day. Nothing counts down: the page shows real
 * dates. The stored body, `announcedAt` → `announcedAtMs`.
 */
export type SeasonEntity = {
  readonly id: SeasonId;
  readonly kind: SeasonKind;
  readonly title: LocalizedText;
  readonly emblem: BadgeEmblem;
  readonly window: SeasonWindow;
  /** A season's track family; `null` on an event. */
  readonly trackSeriesId: SeriesId | null;
  /** The window's other families, in order — never the track. */
  readonly seriesIds: readonly SeriesId[];
  readonly announcedAtMs: number;
  readonly version: number;
};
