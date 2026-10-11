import type { Metric, PerkId, LocalizedText } from '@core/components';
import type { TierId, LocalDate } from '@core/primitives';

/**
 * `tierDefinitions/{id}` — Бронз · Сребро · Злато · Платина, the ONE tier
 * definition (§9 D21: no `.data.ts` twin). Qualifying is counted in VISITS
 * in a rolling window, never mixed with points: at least `qualifyAtLeast`
 * of `qualifyMetric` in the last `qualifyWindowDays` days (was the nested
 * `qualify { metric; atLeast; window { lastDays } }`, N9). `rank` 0 is the
 * entry tier and the track draws tiers by rank. `effectiveFromLocalDate`
 * is a shop-calendar DAY (§9 D24) — tiers change at a day boundary, never
 * mid-day.
 */
export type TierDefinition = {
  readonly id: TierId;
  readonly name: LocalizedText;
  readonly rank: number;
  readonly benefits: readonly PerkId[];
  readonly version: number;
  readonly effectiveFromLocalDate: LocalDate;
  readonly qualifyMetric: Metric;
  readonly qualifyAtLeast: number;
  readonly qualifyWindowDays: number;
};
