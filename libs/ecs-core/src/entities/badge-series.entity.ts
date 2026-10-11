import type { BadgeLevel } from '../components/badge-level.data';
import type {
  BadgeEmblem,
  BadgeSubjectSlot,
  MetricRef,
} from '../components/gamification.data';
import type { LocalizedText } from '../components/localized-text.data';
import type {
  BadgeCategoryId,
  BadgeSeriesId,
  SeasonId,
} from '../primitives/ids.primitive';
import type { LocalDate } from '../primitives/local-date.primitive';
import type { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';

/**
 * The family's identity slice: the id and the plain 1-to-1 attributes.
 * `artPath` was `art: { path } | null` (N9); `retiredAtUtcMs` +
 * `retiredLocalDate` are written together (T5), `null` together while the
 * family is in the catalogue.
 */
export type BadgeSeriesMeta = {
  readonly id: BadgeSeriesId;
  readonly categoryId: BadgeCategoryId | null;
  readonly seasonId: SeasonId | null;
  /** «Фейд» */
  readonly title: LocalizedText;
  /** The family's sentence without a figure: «Посещения с фейд». */
  readonly requirement: LocalizedText;
  readonly emblem: BadgeEmblem;
  /** Owner art in Storage: wins over the subject's art and the emblem. */
  readonly artPath: string | null;
  /** 1-to-N: each element a flat level. */
  readonly levels: readonly BadgeLevel[];
  /** Earned again every year (the birthday visit); then the only level. */
  readonly repeatable: boolean;
  readonly order: number;
  /** Withdrawn from the catalogue: shown only where a client already started it. */
  readonly retiredAtUtcMs: UtcEpochMs | null;
  readonly retiredLocalDate: LocalDate | null;
  readonly version: number;
};

/**
 * `badgeSeries/{id}` — ONE medal family, the unit the card draws («Фейд»
 * I…V, «С Иван», «Добре дошъл»). It lives in a category or in a season,
 * never in neither; its levels run 1, 2, 3 … with rising targets, a one-off
 * act has exactly one level, and a repeatable (yearly) family exactly one
 * (LoyaltyCatalogSystem checks them together). Its standing for a client is
 * derived from that client's progress document by BadgeSystem.
 *
 * The archetype (Law 6): the identity slice, what it counts (`MetricRef` —
 * `metric: null` for a one-off act and for the rhythm family, whose value
 * is the cadence streak's best run) and what it is about (the
 * `BadgeSubjectSlot` variant slice, `badgeSubject: null` = nothing).
 */
export type BadgeSeries = BadgeSeriesMeta & MetricRef & BadgeSubjectSlot;
