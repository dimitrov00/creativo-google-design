import {
  HeadRole,
  StreakRule,
  StreakRuleDirection,
  StreakTransition,
} from '../components/streak-rule.data';
import type { StreakDefinitionVersion } from '../entities/streak-definition-version.entity';
import type { StreakDefinition } from '../entities/streak-definition.entity';
import {
  PublishRequestId,
  StreakDefinitionVersionId,
  UserId,
} from '../primitives/ids.primitive';
import { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';
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
 *   before the loyalty flip (3) reshapes them, ISO instants, nested rules
 *   and lowercase tags and all (frozen, flatten-spec §0.1) — and are true
 *   on `FIXTURE_TODAY` (2026-09-28): the seasons' phases, the rhythm's
 *   phase and every windowed count are as of that day. Deep-frozen: every
 *   spec in a worker shares them, so none may write into them. The
 *   application layer's `loyaltyFixtures` re-exports them (typed as its
 *   `*Document` interfaces) until Phase 4;
 * - the rhythm's rule as ENTITIES — the head and its first version as the
 *   dev shop opened them (`catalog.json`'s `streakDefinitions/cadence`, in
 *   the flat Law 6/7 shape: the head's `rules` list, the flat rule,
 *   `effectiveFromLocalDate`, `*UtcMs`), for the pipeline specs of the
 *   loyalty flip. Complete, every field present, overridable field by
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

/** A fixture instant that is one by construction (a literal checked by the spec). */
function instant(raw: number): UtcEpochMs {
  const parsed = UtcEpochMs.of(raw);
  if (!parsed.ok) throw new Error(`a broken fixture instant: ${raw}`);
  return parsed.value;
}

/**
 * The instant the dev shop opened its rhythm: `catalog.json`'s
 * `streakDefinitions/cadence.updatedAt`, 2025-03-01T07:00:00.000Z — the
 * head's `updatedAtUtcMs` and the first version's `publishedAtUtcMs`.
 */
export const FIXTURE_STREAK_OPENED_AT_UTC_MS: UtcEpochMs =
  instant(1_740_812_400_000);

/** Who published the first version: nobody by hand — the rule the shop opened with. */
export const FIXTURE_STREAK_FIRST_PUBLISHER: UserId = UserId.of('system');

/**
 * The rhythm's head as the dev shop opened it: the recommended rule in
 * force since 2025-03-01, nothing waiting — `catalog.json`'s
 * `streakDefinitions/cadence` in the entity's shape (one `CURRENT` element).
 */
export function streakDefinitionFixture(
  overrides: Partial<StreakDefinition> = {},
): StreakDefinition {
  return {
    id: StreakRule.DEFAULT_DEFINITION_ID,
    name: StreakRule.DEFAULT_NAME,
    rules: [
      {
        ...StreakRule.DEFAULT,
        headRole: HeadRole.Current,
        streakTransition: null,
      },
    ],
    updatedAtUtcMs: FIXTURE_STREAK_OPENED_AT_UTC_MS,
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
  overrides: Partial<StreakDefinitionVersion> = {},
): StreakDefinitionVersion {
  const id = StreakDefinitionVersionId.forVersion(StreakRule.DEFAULT.version);
  // A field-by-field override of a union-typed archetype (the qualifier and
  // interval variants): TS cannot follow a spread across the variants, so
  // the merged struct is named — the spec holds every field.
  return {
    ...StreakRule.DEFAULT,
    id,
    publishedAtUtcMs: FIXTURE_STREAK_OPENED_AT_UTC_MS,
    publishedByUserId: FIXTURE_STREAK_FIRST_PUBLISHER,
    streakTransition: StreakTransition.Grandfather,
    streakRuleDirection: StreakRuleDirection.Neutral,
    changed: [],
    requestId: PublishRequestId.of(
      `seed-${StreakRule.DEFAULT_DEFINITION_ID}-${id}`,
    ),
    withdrawnAtUtcMs: null,
    ...overrides,
  } as StreakDefinitionVersion;
}
