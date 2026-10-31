/**
 * Compile-only proofs over the loyalty catalogue fixture (`catalog.json`,
 * no-op mapper sweep D8): no document of the six catalogue collections
 * carries a key its entity's body does not declare — any variant's. The
 * seed writes each body as it is (Law 5), so this is the guarantee its
 * deleted per-collection body builders used to give at run time. `tsc`
 * failing IS the test; nothing here runs.
 */
import type {
  BadgeCategory,
  BadgeSeries,
  RewardCatalogItem,
  Season,
  StreakDefinition,
  TierDefinition,
} from '@core/entities';
import catalogJson from './fixtures/loyalty/catalog.json';
import type { ExcessKeys } from './loyalty.fixtures';

type IsNever<T> = [T] extends [never] ? true : false;
type Catalog = typeof catalogJson;

export const catalogHasNoExcessKey: [
  IsNever<ExcessKeys<Catalog['badgeCategories'], BadgeCategory>>,
  IsNever<ExcessKeys<Catalog['badgeSeries'], BadgeSeries>>,
  IsNever<ExcessKeys<Catalog['seasons'], Season>>,
  IsNever<ExcessKeys<Catalog['tierDefinitions'], TierDefinition>>,
  IsNever<ExcessKeys<Catalog['rewardsCatalog'], RewardCatalogItem>>,
  IsNever<ExcessKeys<Catalog['streakDefinitions'], StreakDefinition>>,
] = [true, true, true, true, true, true];
