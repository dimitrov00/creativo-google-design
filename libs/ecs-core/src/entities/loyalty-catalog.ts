import type { BadgeSubjectSlot } from '@core/components';
import type { BadgeCategory } from './badge-category.entity';
import type { BadgeSeries } from './badge-series.entity';
import type { RewardCatalogItem } from './reward-catalog-item.entity';
import type { Season } from './season.entity';
import type { StreakDefinition } from './streak-definition.entity';
import type { TierDefinition } from './tier-definition.entity';

/*
 * THE LOYALTY CATALOGUE AS READ (client-card-redesign §4.1) — the six lists
 * the catalogue is built of, declared ONCE (pass D, D-7.5): the ports
 * answer it (`LoadLoyaltyCatalog`), `LoyaltyCatalogSystem.validate` and the
 * standing system read it, and the entities tier sits below both, so
 * neither declares a copy. Not an entity (no id, no slice intersection) —
 * an entities-tier composite of entities, as `collections.ts` is a
 * non-entity file of this tier.
 *
 * Generic over the rows: each list is read through the few fields the
 * catalogue's rules name (the `Catalog*Ref` bounds, `Pick`s of the stored
 * entities), and its defaults are the entities as stored — so
 * `LoyaltyCatalog` (the port's answer) IS `LoyaltyCatalogParts` and passes
 * to `validate` unmapped (Law 3).
 */

/** What a catalogue reads of a shelf. */
export type CatalogCategoryRef = Pick<BadgeCategory, 'id' | 'order'>;
/** What a catalogue reads of a family. */
export type CatalogSeriesRef = Pick<
  BadgeSeries,
  'id' | 'categoryId' | 'seasonId' | 'order'
>;
/** What a catalogue reads of a season. */
export type CatalogSeasonRef = Pick<
  Season,
  'id' | 'windowFrom' | 'windowUntil' | 'trackSeriesId' | 'seriesIds'
>;
/** What a catalogue reads of a tier. */
export type CatalogTierRef = Pick<
  TierDefinition,
  'id' | 'rank' | 'qualifyAtLeast'
>;
/** What a catalogue reads of a reward. */
export type CatalogRewardRef = Pick<RewardCatalogItem, 'id' | 'cost' | 'order'>;
/** What a catalogue reads of a rhythm's head. */
export type CatalogStreakRef = Pick<StreakDefinition, 'id'>;
/** What the windows a page shows read of a season: its catalogue ref, and whether it is a season or an event. */
export type CatalogWindowRef = CatalogSeasonRef & Pick<Season, 'seasonKind'>;
/** What the barbers' faces read of a family: its subject, and whether it was withdrawn. */
export type CatalogSubjectRef = BadgeSubjectSlot &
  Pick<BadgeSeries, 'retiredAtUtcMs'>;

/** The lists a catalogue is built of, in any order. */
export type LoyaltyCatalogParts<
  C extends CatalogCategoryRef = BadgeCategory,
  S extends CatalogSeriesRef = BadgeSeries,
  N extends CatalogSeasonRef = Season,
  T extends CatalogTierRef = TierDefinition,
  R extends CatalogRewardRef = RewardCatalogItem,
  H extends CatalogStreakRef = StreakDefinition,
> = {
  readonly categories: readonly C[];
  readonly series: readonly S[];
  readonly seasons: readonly N[];
  readonly tiers: readonly T[];
  readonly rewards: readonly R[];
  /** The rhythm's heads: the version in force and the one that waits. `[]` for a catalogue without a rhythm. */
  readonly streaks: readonly H[];
};

/**
 * The loyalty catalogue as stored — the shelves, the medal families, the
 * seasons, the tiers, the rewards and the rhythm's heads (`streaks`), every
 * document as read: `LoyaltyCatalogParts` at its defaults, what
 * `LoadLoyaltyCatalog` answers and `LoyaltyCatalogSystem.validate` takes.
 */
export type LoyaltyCatalog = LoyaltyCatalogParts;
