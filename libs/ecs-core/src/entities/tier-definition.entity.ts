import type { DayKey } from '../components/day-key.data';
import type {
  Metric,
  MetricWindow,
  PerkId,
} from '../components/gamification.data';
import type { LocalizedText } from '../components/localized-text.data';

export type TierId = string & { readonly __brand: unique symbol };
export const TierId = {
  /** The only cast site. Validate the raw string at the edge, not here. */
  of: (raw: string): TierId => raw as TierId,
} as const;

/**
 * `tierDefinitions/{id}` — Бронз · Сребро · Злато · Платина, the ONE tier
 * definition (§9 D21: no `.data.ts` twin). Qualifying is counted in VISITS
 * in a rolling window, never mixed with points; `rank` 0 is the entry tier
 * and the track draws tiers by rank.
 *
 * Declared change (§9 D24): `effectiveFrom` is a shop-calendar DAY —
 * tiers change at a day boundary, never mid-day — stored as
 * `effectiveFromDayKey` (today an ISO instant).
 */
export type TierDefinitionEntity = {
  readonly id: TierId;
  readonly name: LocalizedText;
  readonly rank: number;
  readonly benefits: readonly PerkId[];
  readonly version: number;
  readonly effectiveFromDayKey: DayKey;
  readonly qualify: TierDefinitionEntity.Qualify;
};

export namespace TierDefinitionEntity {
  /** At least `atLeast` of `metric` in the last `window.lastDays` days. */
  export type Qualify = {
    readonly metric: Metric;
    readonly atLeast: number;
    readonly window: MetricWindow;
  };
}
