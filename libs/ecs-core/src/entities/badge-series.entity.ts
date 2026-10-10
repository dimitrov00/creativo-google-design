import type { BadgeLevel } from '../components/badge-level.data';
import type {
  BadgeEmblem,
  BadgeSubject,
  MetricRef,
} from '../components/gamification.data';
import type { LocalizedText } from '../components/localized-text.data';
import type { BadgeCategoryId } from './badge-category.entity';
import type { SeasonId } from './season.entity';

export type SeriesId = string & { readonly __brand: unique symbol };
export const SeriesId = {
  /** The only cast site. Validate the raw string at the edge, not here. */
  of: (raw: string): SeriesId => raw as SeriesId,
} as const;

/**
 * `badgeSeries/{id}` — ONE medal family, the unit the card draws («Фейд»
 * I…V, «С Иван», «Добре дошъл»). It lives in a category or in a season,
 * never in neither; its levels run 1, 2, 3 … with rising targets, a one-off
 * act has exactly one level, and a repeatable (yearly) family exactly one
 * (LoyaltyCatalogSystem checks them together). Its standing for a client is
 * derived from that client's progress document by BadgeSystem.
 *
 * The stored body (`loyalty-document.ts:258-281`): `retiredAt` →
 * `retiredAtMs`, and the metric's `window`/`where` an explicit `null` where
 * today they are absent.
 */
export type BadgeSeriesEntity = {
  readonly id: SeriesId;
  readonly categoryId: BadgeCategoryId | null;
  readonly seasonId: SeasonId | null;
  /** «Фейд» */
  readonly title: LocalizedText;
  /** The family's sentence without a figure: «Посещения с фейд». */
  readonly requirement: LocalizedText;
  readonly emblem: BadgeEmblem;
  readonly subject: BadgeSubject | null;
  /** `null` for a one-off act, and for the rhythm family, whose value is the cadence streak's best run. */
  readonly metric: MetricRef | null;
  /** Owner art in Storage: wins over the subject's art and the emblem. */
  readonly art: BadgeSeriesEntity.Art | null;
  readonly levels: readonly BadgeLevel[];
  /** Earned again every year (the birthday visit); then the only level. */
  readonly repeatable: boolean;
  readonly order: number;
  /** Withdrawn from the catalogue: shown only where a client already started it. */
  readonly retiredAtMs: number | null;
  readonly version: number;
};

export namespace BadgeSeriesEntity {
  /** The Storage key of the family's own art. */
  export type Art = { readonly path: string };
}
