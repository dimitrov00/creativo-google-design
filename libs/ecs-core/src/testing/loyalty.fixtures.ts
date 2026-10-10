import {
  StreakRule,
  StreakRuleDirection,
  StreakTransition,
} from '../components/streak-rule.data';
import {
  StreakDefinitionVersionId,
  type StreakDefinitionVersionEntity,
} from '../entities/streak-definition-version.entity';
import type { StreakDefinitionEntity } from '../entities/streak-definition.entity';
import { UserId } from '../entities/user.entity';
import catalogJson from './fixtures/loyalty/catalog.json';
import vouchersJson from './fixtures/loyalty/vouchers.json';
import { deepFreeze } from './deep-freeze';

/**
 * The loyalty and rhythm fixtures (blueprint §6 Phase 3a, §7) — test
 * support, reached through `@creativo/ecs-core/testing`.
 *
 * Two families:
 *
 * - the two loyalty JSON files the dev seed reads BY PATH
 *   (`tools/seed/loyalty.mjs` the catalogue, `tools/seed/promotions.mjs`
 *   the vouchers), moved here from `libs/application/engagement` in 3a.
 *   They hold TODAY's wire — the documents exactly as Firestore holds them
 *   before the loyalty flip (3) reshapes them, ISO instants and all — and
 *   are true on `FIXTURE_TODAY` (2026-09-28): the seasons' phases, the
 *   rhythm's phase and every windowed count are as of that day. Deep-frozen:
 *   every spec in a worker shares them, so none may write into them. The
 *   application layer's `loyaltyFixtures` re-exports them (typed as its
 *   `*Document` interfaces) until Phase 4;
 * - the rhythm's rule as ENTITIES — the head and its first version as the
 *   dev shop opened them (`catalog.json`'s `streakDefinitions/cadence`, in
 *   the ECS shape: `effectiveFromDayKey`, `*Ms`), for the pipeline specs of
 *   the loyalty flip. Complete, every field present, overridable field by
 *   field; the spec beside this file holds them to the JSON, so the two
 *   tell one story.
 */

/**
 * `catalog.json` — every loyalty catalogue collection (`badgeCategories`,
 * `badgeSeries`, `seasons`, `tierDefinitions`, `rewardsCatalog`,
 * `streakDefinitions`), keyed by collection, then by document id.
 */
export const loyaltyCatalogJson = deepFreeze(catalogJson);

/**
 * `vouchers.json` — `{ giftVouchers: { [id]: body } }`. Георги
 * (`dev-client-1`) holds three (one to spend, one spent, one voided),
 * Мартин (`dev-client-2`) one, and one is paper: nobody's until its code is
 * presented.
 */
export const giftVouchersJson = deepFreeze(vouchersJson);

/**
 * The instant the dev shop opened its rhythm: `catalog.json`'s
 * `streakDefinitions/cadence.updatedAt`, 2025-03-01T07:00:00.000Z — the
 * head's `updatedAtMs` and the first version's `publishedAtMs`.
 */
export const FIXTURE_STREAK_OPENED_AT_MS = 1_740_812_400_000;

/** Who published the first version: nobody by hand — the rule the shop opened with. */
export const FIXTURE_STREAK_FIRST_PUBLISHER: UserId = UserId.of('system');

/**
 * The rhythm's head as the dev shop opened it: the recommended rule in
 * force since 2025-03-01, nothing waiting — `catalog.json`'s
 * `streakDefinitions/cadence` in the entity's shape.
 */
export function streakDefinitionFixture(
  overrides: Partial<StreakDefinitionEntity> = {},
): StreakDefinitionEntity {
  return {
    id: StreakRule.DEFAULT_DEFINITION_ID,
    name: StreakRule.DEFAULT_NAME,
    current: StreakRule.DEFAULT,
    scheduled: null,
    updatedAtMs: FIXTURE_STREAK_OPENED_AT_MS,
    ...overrides,
  };
}

/**
 * Version 1 of the rhythm (`streakDefinitions/cadence/versions/000001`),
 * the history the dev seed gives the head: the recommended rule, published
 * by nobody by hand when the shop opened, changing nothing, never
 * withdrawn. Its `requestId` is the seed's (`seed-{streakId}-{version:06}`).
 */
export function streakDefinitionVersionFixture(
  overrides: Partial<StreakDefinitionVersionEntity> = {},
): StreakDefinitionVersionEntity {
  const id = StreakDefinitionVersionId.forVersion(StreakRule.DEFAULT.version);
  return {
    ...StreakRule.DEFAULT,
    id,
    publishedAtMs: FIXTURE_STREAK_OPENED_AT_MS,
    publishedBy: FIXTURE_STREAK_FIRST_PUBLISHER,
    transition: StreakTransition.Grandfather,
    direction: StreakRuleDirection.Neutral,
    changed: [],
    requestId: `seed-${StreakRule.DEFAULT_DEFINITION_ID}-${id}`,
    withdrawnAtMs: null,
    ...overrides,
  };
}
