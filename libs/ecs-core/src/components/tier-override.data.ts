import type { AdjustmentId, LocalDate, TierId } from '@core/primitives';

/** Where a manual tier override came from — the discriminator `tierOverrideSource` (`null` = no override). */
export const TierOverrideSource = {
  /** An achievement's award set it. */
  Award: 'AWARD',
  /** A staff adjustment set it. */
  Adjustment: 'ADJUSTMENT',
} as const;
export type TierOverrideSource =
  (typeof TierOverrideSource)[keyof typeof TierOverrideSource];

/**
 * A manual tier, in force through `tierOverrideUntil` (a shop-calendar day,
 * inclusive; `null` = for good) — the variant SLICE (F-26) that replaces
 * today's nullable nested `override { tierId; until; source }` and its
 * source union: `tierOverrideSource: null` is "no override", and each
 * source declares only its own key, so every variant narrows.
 */
export type TierOverride =
  TierOverride.None | TierOverride.Award | TierOverride.Adjustment;

export const TierOverride = {
  none(): TierOverride.None {
    return { tierOverrideSource: null };
  },
  award(
    tierOverrideTierId: TierId,
    tierOverrideUntil: LocalDate | null,
    tierOverrideAwardKey: string,
  ): TierOverride.Award {
    return {
      tierOverrideSource: TierOverrideSource.Award,
      tierOverrideTierId,
      tierOverrideUntil,
      tierOverrideAwardKey,
    };
  },
  adjustment(
    tierOverrideTierId: TierId,
    tierOverrideUntil: LocalDate | null,
    tierOverrideAdjustmentId: AdjustmentId,
  ): TierOverride.Adjustment {
    return {
      tierOverrideSource: TierOverrideSource.Adjustment,
      tierOverrideTierId,
      tierOverrideUntil,
      tierOverrideAdjustmentId,
    };
  },
} as const;

export namespace TierOverride {
  /** No override stands (today's `override: null`). */
  export type None = { readonly tierOverrideSource: null };
  export type Award = {
    readonly tierOverrideSource: typeof TierOverrideSource.Award;
    readonly tierOverrideTierId: TierId;
    readonly tierOverrideUntil: LocalDate | null;
    readonly tierOverrideAwardKey: string;
  };
  export type Adjustment = {
    readonly tierOverrideSource: typeof TierOverrideSource.Adjustment;
    readonly tierOverrideTierId: TierId;
    readonly tierOverrideUntil: LocalDate | null;
    readonly tierOverrideAdjustmentId: AdjustmentId;
  };
}
