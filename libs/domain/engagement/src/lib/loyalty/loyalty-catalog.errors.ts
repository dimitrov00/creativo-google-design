import { DomainError } from '@creativo/domain/kernel';

/** A family names a category the catalogue does not have. */
export class LoyaltyCatalogDanglingCategoryError extends DomainError {
  override readonly code =
    'engagement.loyalty_catalog.dangling_category' as const;
  constructor(
    public readonly seriesId: string,
    public readonly categoryId: string,
  ) {
    super(`Badge family ${seriesId} names no category ${categoryId}`, {
      seriesId,
      categoryId,
    });
  }
}

/**
 * A family and a season disagree: the family names a season that is not
 * there, or a season lists a family that is not there or not its own.
 */
export class LoyaltyCatalogDanglingSeasonError extends DomainError {
  override readonly code =
    'engagement.loyalty_catalog.dangling_season' as const;
  constructor(
    public readonly seasonId: string,
    public readonly seriesId: string,
  ) {
    super(`Season ${seasonId} and badge family ${seriesId} do not match`, {
      seasonId,
      seriesId,
    });
  }
}

export class LoyaltyCatalogDuplicateIdError extends DomainError {
  override readonly code = 'engagement.loyalty_catalog.duplicate_id' as const;
  constructor(
    public readonly collection: string,
    public readonly id: string,
  ) {
    super(`The catalogue lists ${collection} ${id} twice`, { collection, id });
  }
}

/** By rank, each tier asks for more visits than the one below it. */
export class LoyaltyCatalogTiersNotRisingError extends DomainError {
  override readonly code =
    'engagement.loyalty_catalog.tiers_not_rising' as const;
  constructor(public readonly tierIds: readonly string[]) {
    super(`Tiers must ask more as they rank higher: ${tierIds.join(', ')}`, {
      tierIds,
    });
  }
}

/** A reward costs whole, positive points. */
export class LoyaltyCatalogCostNotPositiveError extends DomainError {
  override readonly code =
    'engagement.loyalty_catalog.cost_not_positive' as const;
  constructor(
    public readonly rewardId: string,
    public readonly cost: number,
  ) {
    super(`Reward ${rewardId} costs ${cost}, not a positive whole number`, {
      rewardId,
      cost,
    });
  }
}

export type LoyaltyCatalogError =
  | LoyaltyCatalogDanglingCategoryError
  | LoyaltyCatalogDanglingSeasonError
  | LoyaltyCatalogDuplicateIdError
  | LoyaltyCatalogTiersNotRisingError
  | LoyaltyCatalogCostNotPositiveError;
