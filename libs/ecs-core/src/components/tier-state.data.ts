import type { TierId } from '../entities/tier-definition.entity';
import type { DayKey } from './day-key.data';

/** Where a manual tier override came from, by kind — the stored tags, unchanged. */
export const TierOverrideSourceKind = {
  /** An achievement's award set it. */
  Award: 'award',
  /** A staff adjustment set it. */
  Adjustment: 'adjustment',
} as const;
export type TierOverrideSourceKind =
  (typeof TierOverrideSourceKind)[keyof typeof TierOverrideSourceKind];

/** Where a manual override came from. */
export type TierOverrideSource =
  TierOverrideSource.Award | TierOverrideSource.Adjustment;

export const TierOverrideSource = {
  award(awardKey: string): TierOverrideSource.Award {
    return { kind: TierOverrideSourceKind.Award, awardKey };
  },
  adjustment(adjustmentId: string): TierOverrideSource.Adjustment {
    return { kind: TierOverrideSourceKind.Adjustment, adjustmentId };
  },
} as const;

/**
 * A manual tier, in force through `until` (a shop-calendar day, inclusive;
 * `null` = for good). `until` is stored and read as a DAY
 * (`override.nullableDate('until')`, `loyalty-document.ts:1413`), so it
 * stays a day key — the ISO → ms rule is for instants only.
 */
export type TierOverride = {
  readonly tierId: TierId;
  readonly until: DayKey | null;
  readonly source: TierOverrideSource;
};

/**
 * The account's tier — computed from VISITS in the qualifying window, never
 * points, with an optional manual override (`loyalty-document.ts:456-470`,
 * `tier.since` → `sinceMs`). `next`/`remaining` are `null` at the top.
 * TierSystem does the math.
 */
export type TierState = {
  readonly current: TierId;
  readonly definitionVersion: number;
  readonly sinceMs: number;
  /** Visits in the qualifying window. */
  readonly qualifying: number;
  readonly next: TierId | null;
  readonly remaining: number | null;
  readonly override: TierOverride | null;
};

export namespace TierOverrideSource {
  export type Award = {
    readonly kind: typeof TierOverrideSourceKind.Award;
    readonly awardKey: string;
  };
  export type Adjustment = {
    readonly kind: typeof TierOverrideSourceKind.Adjustment;
    readonly adjustmentId: string;
  };
}
