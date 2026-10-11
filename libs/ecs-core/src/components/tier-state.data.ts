import type { AdjustmentId, TierId } from '../primitives/ids.primitive';
import type { LocalDate } from '../primitives/local-date.primitive';
import type { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';

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
 * The account's computed tier — from VISITS in the qualifying window, never
 * points (`loyalty-document.ts:456-470`), a flat slice at the account's
 * root, every field prefixed `tier` (`tierSinceUtcMs` was `tier.since`).
 * `nextTierId`/`tierRemaining` are `null` at the top. TierSystem does the
 * math.
 */
export type TierStanding = {
  /** The tier the visits reached (was `current`). */
  readonly tierId: TierId;
  readonly tierDefinitionVersion: number;
  readonly tierSinceUtcMs: UtcEpochMs;
  /** Visits in the qualifying window. */
  readonly tierQualifying: number;
  readonly nextTierId: TierId | null;
  readonly tierRemaining: number | null;
};

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

/**
 * The account's tier — the computed standing and the optional manual
 * override, both flat at the account's root (Law 6).
 */
export type TierState = TierStanding & TierOverride;

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
