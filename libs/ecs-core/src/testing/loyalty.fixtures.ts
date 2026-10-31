import {
  HeadRole,
  StreakRule,
  StreakRuleDirection,
  StreakTransition,
} from '@core/components';
import type {
  BadgeCategory,
  BadgeProgress,
  BadgeSeries,
  GiftVoucher,
  JournalEntry,
  LoyaltyAccount,
  RewardCatalogItem,
  Season,
  SeasonProgress,
  StreakDefinition,
  StreakDefinitionVersion,
  TierDefinition,
  LoyaltyCatalogParts,
} from '@core/entities';
import {
  CustomerId,
  PublishRequestId,
  StreakDefinitionVersionId,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import { StreakPublishSystem } from '@core/systems';
import georgiJson from './fixtures/loyalty/account-georgi.json';
import martinJson from './fixtures/loyalty/account-martin.json';
import catalogJson from './fixtures/loyalty/catalog.json';
import vouchersJson from './fixtures/loyalty/vouchers.json';
import { deepFreeze } from './deep-freeze';

/**
 * The loyalty and rhythm fixtures (blueprint §6 Phase 3, flip-3 plan §3.1)
 * — test support, reached through `@core/testing`.
 *
 * Three families, one story:
 *
 * - the loyalty JSON files the dev seed and the e2e seed read BY PATH or as
 *   JSON (`tools/seed/loyalty.mjs` the catalogue and the two accounts;
 *   `tools/seed/promotions.spec.mjs` holds the seed's vouchers to
 *   `vouchers.json`): every document exactly as Firestore holds it — the FLAT entity body minus its id (Laws 5–7):
 *   SCREAMING tags, `*UtcMs` instants beside their Sofia `*LocalDate` days
 *   (T5: written together from one reading), the rhythm's states as the
 *   `streaks` array, the journal keyed by the client RECORD (D29). True on
 *   `FIXTURE_TODAY` (2026-09-28): the seasons' phases, the rhythm's phase
 *   and every windowed count are as of that day. Deep-frozen: every spec in
 *   a worker shares them, so none may write into them. `Json<…>` below
 *   holds each file to its entity's shape at compile time;
 * - the same documents as ENTITIES (`loyaltyCatalogFixture()`,
 *   `loyaltyAccountFixtures`, `giftVoucherFixtures()`), ids spread in —
 *   what the in-memory doubles answer and the store and presenter specs
 *   start from;
 * - the rhythm's rule as entities — the head and its first version as the
 *   dev shop opened them, complete and overridable field by field, for the
 *   publish pipeline's specs.
 *
 * The spec beside this file holds the three to each other.
 */

/**
 * A body as JSON can spell it: every brand and closed vocabulary widened to
 * its primitive. JSON has no literal types, so this is the strictest shape
 * the compiler can hold a fixture file to — keys, nesting, nullability and
 * primitive kinds; the spec checks the vocabularies at run time.
 */
type Json<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T extends null
        ? null
        : T extends readonly (infer Item)[]
          ? readonly Json<Item>[]
          : { readonly [K in keyof T]: Json<T[K]> };

/** An entity's stored body — the entity minus its id, variant by variant. */
type Body<E> = E extends unknown ? Omit<E, 'id'> : never;

/** Every key of every variant of `T` (distributes over a union). */
type KeysOf<T> = T extends unknown ? keyof T : never;

/**
 * The keys of a fixture collection's documents that NO variant of `E`'s
 * body declares — `never` when every key is one some variant knows. JSON
 * modules are not fresh literals, so `satisfies` never reports an excess
 * key; this does, at compile time (`loyalty.fixtures.type-spec.ts`). The
 * seed writes each body as it is (Law 5 — no mapper strips a stale key on
 * the way in), so a stale key here would reach Firestore.
 */
export type ExcessKeys<J, E> = {
  [Id in keyof J]: Exclude<keyof J[Id], KeysOf<Body<E>>>;
}[keyof J];

/** One collection as the fixture files key it: document id → body. */
type JsonCollection<E> = { readonly [id: string]: Json<Body<E>> };

/** `catalog.json`'s layout: collection → document id → body. */
export type LoyaltyCatalogJson = {
  readonly badgeCategories: JsonCollection<BadgeCategory>;
  readonly badgeSeries: JsonCollection<BadgeSeries>;
  readonly seasons: JsonCollection<Season>;
  readonly tierDefinitions: JsonCollection<TierDefinition>;
  readonly rewardsCatalog: JsonCollection<RewardCatalogItem>;
  readonly streakDefinitions: JsonCollection<StreakDefinition>;
};

/**
 * `account-georgi.json` / `account-martin.json`: one account holder's
 * loyalty documents — the account's uid, the client record it is keyed by
 * (`CustomerId.forUser(uid)` with the production sha256, D29), the
 * `loyaltyAccounts/{customerId}` body, its `badgeProgress` and
 * `seasonProgress` subcollections by document id, and its `clientJournal`
 * rows by id (`{customerId}_{seq:06}`).
 */
export type LoyaltyClientJson = {
  readonly uid: string;
  readonly customerId: string;
  readonly account: Json<Body<LoyaltyAccount>>;
  readonly badgeProgress: JsonCollection<BadgeProgress>;
  readonly seasonProgress: JsonCollection<SeasonProgress>;
  readonly clientJournal: JsonCollection<JournalEntry>;
};

/**
 * `catalog.json` — every loyalty catalogue collection (`badgeCategories`,
 * `badgeSeries`, `seasons`, `tierDefinitions`, `rewardsCatalog`,
 * `streakDefinitions`), keyed by collection, then by document id.
 */
export const loyaltyCatalogJson = deepFreeze(
  catalogJson satisfies LoyaltyCatalogJson,
);

/**
 * The two account holders' loyalty documents as stored, by first name:
 * Георги (`dev-client-1`) and Мартин (`dev-client-2`).
 */
export const loyaltyAccountJson = deepFreeze({
  georgi: georgiJson satisfies LoyaltyClientJson,
  martin: martinJson satisfies LoyaltyClientJson,
});

/**
 * `vouchers.json`'s layout: `giftVouchers/{id}` → the flat `GiftVoucher`
 * body (the `VoucherLifecycle` variant at the root, money in `*Cents` beside
 * its `currency`, `*UtcMs` instants beside the Sofia `expiresLocalDate`, the
 * holder's client record (`CustomerId.forUser(uid)` with the production
 * sha256, D29) beside the account that reads it).
 */
export type GiftVouchersJson = {
  readonly giftVouchers: JsonCollection<GiftVoucher>;
};

/**
 * `vouchers.json` — `{ giftVouchers: { [id]: body } }`, true on
 * `FIXTURE_TODAY`. Георги (`dev-client-1`) holds three (`GIFT50` with
 * 25,00 € left of 50,00 € to the end of 31.12.2026, one spent, one the shop
 * voided), Мартин (`dev-client-2`) `GIFT2025`, whole, and `GIFT5` is paper:
 * nobody's until its code is presented.
 */
export const giftVouchersJson = deepFreeze(
  vouchersJson satisfies GiftVouchersJson,
);

/**
 * A stored body as its entity, the id spread in — the ONE cast of these
 * fixtures: `Json<…>` held the file to the entity's shape at compile time,
 * and `loyalty.fixtures.spec.ts` holds every vocabulary and variant at run
 * time.
 */
function stored<E>(id: string, body: object): E {
  return { id, ...body } as unknown as E;
}

/** Firestore's document order — by id, byte-wise (every fixture id is ASCII). */
function byId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A collection's documents as entities, in Firestore's id order. */
function collection<E>(documents: { readonly [id: string]: object }): E[] {
  return Object.entries(documents)
    .sort(([a], [b]) => byId(a, b))
    .map(([id, body]) => stored<E>(id, body));
}

const CATALOG: LoyaltyCatalogParts = deepFreeze({
  categories: collection<BadgeCategory>(loyaltyCatalogJson.badgeCategories),
  series: collection<BadgeSeries>(loyaltyCatalogJson.badgeSeries),
  seasons: collection<Season>(loyaltyCatalogJson.seasons),
  tiers: collection<TierDefinition>(loyaltyCatalogJson.tierDefinitions),
  rewards: collection<RewardCatalogItem>(loyaltyCatalogJson.rewardsCatalog),
  streaks: collection<StreakDefinition>(loyaltyCatalogJson.streakDefinitions),
});

/**
 * The published catalogue as `LoadLoyaltyCatalog` answers it: the six
 * collections whole under `LoyaltyCatalogSystem`'s part names, each in
 * Firestore's id order, every document as stored (display order is
 * `LoyaltyCatalogSystem.validate`'s). One frozen value, however often it is
 * asked for.
 */
export function loyaltyCatalogFixture(): LoyaltyCatalogParts {
  return CATALOG;
}

/** One account holder's loyalty, as entities. */
export type LoyaltyClientFixture = {
  readonly uid: UserId;
  readonly customerId: CustomerId;
  readonly account: LoyaltyAccount;
  /** The started families, in Firestore's id order. */
  readonly badgeProgress: readonly BadgeProgress[];
  /** The seasons with a track value, in Firestore's id order. */
  readonly seasonProgress: readonly SeasonProgress[];
  /** Every journal row, by `seq` (dense from 1). */
  readonly clientJournal: readonly JournalEntry[];
};

function holder(json: LoyaltyClientJson): LoyaltyClientFixture {
  const customerId = CustomerId.of(json.customerId);
  return deepFreeze({
    uid: UserId.of(json.uid),
    customerId,
    account: stored<LoyaltyAccount>(customerId, json.account),
    badgeProgress: collection<BadgeProgress>(json.badgeProgress),
    seasonProgress: collection<SeasonProgress>(json.seasonProgress),
    clientJournal: collection<JournalEntry>(json.clientJournal).sort(
      (a, b) => a.seq - b.seq,
    ),
  });
}

/**
 * The two account holders the dev shop knows best, as entities.
 *
 * - **Георги Петров** (`dev-client-1`), the regular: 24 worked visits since
 *   6.03.2025, every one a fade with Иван at Център at 10:00, six with a
 *   beard, seven booked online, today's cut done. 358 points after one
 *   250-point redemption; Злато, 6 visits to Платина; a 4/10 stamp card;
 *   24 in rhythm, a run that began with his first visit; 37 levels, the
 *   autumn season's track at II.
 * - **Мартин Илиев** (`dev-client-2`): 13 classic cuts since 8.05.2025 at
 *   12:30 with Иван or Нико, ten booked online, the shop's one cancellation
 *   excused; in the chair today, on his birthday. 215 points after one
 *   120-point redemption; Сребро, 3 visits to Злато; a 3/10 stamp card; 13
 *   in rhythm since his first visit, at risk until 30.09; 28 levels.
 *
 * The journal holds each account's point-moving rows — what the ledger
 * reads — so `seq` is dense over them. Their `points.rule` labels say what
 * paid: `spendMinor` for a seat's points, `seriesId` and `level` for a
 * level's payout (the welcome is `series-welcome` level 1); a redemption is
 * `points.redeemed` with the `reward`.
 */
export const loyaltyAccountFixtures: {
  readonly georgi: LoyaltyClientFixture;
  readonly martin: LoyaltyClientFixture;
} = {
  georgi: holder(loyaltyAccountJson.georgi),
  martin: holder(loyaltyAccountJson.martin),
};

/**
 * The five gift vouchers of `vouchers.json` as entities, ids spread in, in
 * Firestore's id order — keyed by the production record ids the file holds
 * (a spec that resolves records with `customerOf` re-keys them).
 */
export function giftVoucherFixtures(): readonly GiftVoucher[] {
  return VOUCHERS;
}

const VOUCHERS: readonly GiftVoucher[] = deepFreeze(
  collection<GiftVoucher>(giftVouchersJson.giftVouchers),
);

/** A fixture instant that is one by construction (a literal checked by the spec). */
function instant(raw: number): UtcEpochMs {
  const parsed = UtcEpochMs.of(raw);
  if (!parsed.ok) throw new Error(`a broken fixture instant: ${raw}`);
  return parsed.value;
}

/**
 * The instant the dev shop opened its rhythm: `catalog.json`'s
 * `streakDefinitions/cadence` `updatedAtUtcMs`, 2025-03-01T07:00:00.000Z —
 * the head's stamp and the first version's `publishedAtUtcMs`.
 */
export const FIXTURE_STREAK_OPENED_AT_UTC_MS: UtcEpochMs =
  instant(1_740_812_400_000);

/** Who published the first version: nobody by hand — the rule the shop opened with (`StreakPublishSystem.SYSTEM_PUBLISHER`). */
export const FIXTURE_STREAK_FIRST_PUBLISHER: UserId =
  StreakPublishSystem.SYSTEM_PUBLISHER;

/**
 * The rhythm's head as the dev shop opened it: the recommended rule in
 * force since 2025-03-01, nothing waiting — `catalog.json`'s
 * `streakDefinitions/cadence` as the entity (one `CURRENT` element).
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
