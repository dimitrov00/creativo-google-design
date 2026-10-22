import { type Firestore, collection } from 'firebase/firestore';
import type { LoyaltyCatalogMemo } from '@creativo/infrastructure/firebase-app';
import { type LocalDate, type RepositoryError, Result } from '@core/primitives';
import {
  type BadgeCategory,
  type BadgeSeries,
  Collections,
  type RewardCatalogItem,
  type Season,
  type StreakDefinition,
  type TierDefinition,
} from '@core/entities';
import type { LoyaltyCatalog, LoyaltyCatalogReadPorts } from '@core/ports';
import { readQuery } from './observe';

/**
 * THE PUBLISHED LOYALTY CATALOGUE (flip 3, plan §3.4, F3-10) — the
 * successor of the legacy catalogue reader, WITHOUT its mapper: the six
 * collections read whole, each in Firestore's id order, every document AS
 * STORED, answered under `LoyaltyCatalogSystem`'s part names (`categories`,
 * `series`, `seasons`, `tiers`, `rewards`, `streaks` — the rhythm's
 * HEADS: the rule in force and at most one that waits; a head's
 * `versions` are a subcollection, which a collection read never returns,
 * and the admin page's). Whether the catalogue holds together, and its
 * display order, is `LoyaltyCatalogSystem.validate`'s call, made by the
 * reader over this answer unmapped.
 *
 * Memoised for the session AND THE SHOP DAY in `memo` (the root
 * `LOYALTY_CATALOG_MEMO`), keyed by `today()` — `app.config.ts`'s closure
 * over the clock and the shop's zone; no clock or zone code lives here.
 * The catalogue changes when the shop publishes, not while a card is open,
 * and every card and page reads the same one. Three things end the memo:
 *
 * - a failed read is not kept: the next call reads again, and callers
 *   asking while a read is in flight share it;
 * - the shop's day turning: a tab left open past midnight reads again, so
 *   a rule another session published is seen by the next day at the
 *   latest;
 * - `memo.invalidate()`, which the publish gateway calls after a landed
 *   publish or withdrawal in this session. Other open sessions see the
 *   new rule when they reload, or on the next day.
 */
export const loyaltyCatalogReadPorts = (
  db: Firestore,
  memo: LoyaltyCatalogMemo,
  today: () => LocalDate,
): LoyaltyCatalogReadPorts => {
  const whole = <E>(name: string) => readQuery<E>(collection(db, name), name);

  const read = async (): Promise<Result<LoyaltyCatalog, RepositoryError>> => {
    const [categories, series, seasons, tiers, rewards, streaks] =
      await Promise.all([
        whole<BadgeCategory>(Collections.BadgeCategories),
        whole<BadgeSeries>(Collections.BadgeSeries),
        whole<Season>(Collections.Seasons),
        whole<TierDefinition>(Collections.TierDefinitions),
        whole<RewardCatalogItem>(Collections.RewardsCatalog),
        whole<StreakDefinition>(Collections.StreakDefinitions),
      ]);
    if (!categories.ok) return categories;
    if (!series.ok) return series;
    if (!seasons.ok) return seasons;
    if (!tiers.ok) return tiers;
    if (!rewards.ok) return rewards;
    if (!streaks.ok) return streaks;
    return Result.ok({
      categories: categories.value,
      series: series.value,
      seasons: seasons.value,
      tiers: tiers.value,
      rewards: rewards.value,
      streaks: streaks.value,
    });
  };

  return {
    loadLoyaltyCatalog: () => {
      const day = today();
      const kept = memo.readOn(day);
      if (kept !== null) return kept;
      const fresh = read();
      memo.keep(fresh, day);
      void fresh.then((answer) => {
        if (!answer.ok) memo.drop(fresh);
      });
      return fresh;
    },
  };
};
