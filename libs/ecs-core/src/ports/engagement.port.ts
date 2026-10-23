import type { Observable } from 'rxjs';
import type {
  JournalEffect,
  StreakPublishCall,
  VoucherCode,
} from '@core/components';
import type {
  Result,
  CouponGrantId,
  CouponId,
  CustomerId,
  StreakDefinitionId,
} from '@core/primitives';
import type { RepositoryError, StreakPublishError } from '@core/errors';
import type {
  BadgeCategory,
  BadgeProgress,
  BadgeSeries,
  CouponGrant,
  Coupon,
  GiftVoucher,
  JournalEntry,
  LoyaltyAccount,
  RewardCatalogItem,
  SeasonProgress,
  Season,
  StreakDefinition,
  StreakDefinitionVersion,
  TierDefinition,
} from '@core/entities';

/**
 * The engagement context's ports (blueprint §4.2): coupons, grants and gift
 * vouchers, the loyalty account and its catalogue, the client journal, the
 * streak definitions and the web's gateway to the rhythm's publish
 * callable. One function per query shape, entities straight from
 * `snap.data()` — every stored body answered as stored (Law 5, no
 * read-side mapper) — every one naming `RepositoryError`.
 *
 * Server writes are not here: a grant burn or restore, a voucher balance, a
 * redemption counter and the streak publish are entries of one
 * `CommitPlan` (`tx.port.ts`) planned by their systems and committed by
 * their pipelines; the web reaches the publish only through the callable
 * (`StreakPublishGatewayPorts`). Coupons stay a rules-guarded admin write
 * until an admin surface lands (§9 D28).
 */

// ── Coupons, grants, vouchers ─────────────────────────────────────────────

/**
 * The enabled coupon a typed code names — `code ==`, `couponStatus ==
 * CouponStatus.Enabled`, `limit 1` (`coupon-reader.adapter.ts:34-35`,
 * single-field equality merge); `null` when none. `code` is already
 * normalised (`VoucherCode`). Also the `resolveDiscount` read of the
 * staff edit (§4.1), made OUTSIDE its transaction — a code is a lookup,
 * the grants it may burn are read inside.
 */
export type FindCouponByCode = (
  code: VoucherCode,
) => Promise<Result<Coupon | null, RepositoryError>>;

/** Every enabled coupon — `couponStatus ==` (`coupon-reader.adapter.ts:59`). */
export type ListOpenCoupons = () => Promise<
  Result<readonly Coupon[], RepositoryError>
>;

/**
 * The coupons a set of grants was granted from — `documentId() in`, in
 * chunks of 30 (Firestore's `in` bound), whatever their status: a held
 * grant whose coupon was disabled since keeps its name, value and
 * exclusivity in the «Отстъпка» menu, as `findUsableForUser` does today. An
 * id with no document is simply absent from the answer (order not
 * promised; the caller matches by `id`).
 */
export type LoadCoupons = (
  ids: readonly CouponId[],
) => Promise<Result<readonly Coupon[], RepositoryError>>;

/** The gift voucher a code names — `code ==` (`gift-voucher-reader.adapter.ts:34`); `null` when none. */
export type FindGiftVoucherByCode = (
  code: VoucherCode,
) => Promise<Result<GiftVoucher | null, RepositoryError>>;

/**
 * Every voucher issued to a client record — `issuedToCustomerId ==` (D29;
 * `client-vouchers-reader.adapter.ts:49`), the client card's wallet, a
 * staff read (`worksTheBook`). A client's own reads are keyed by the rules'
 * `holderUserId`, never through this port.
 */
export type ListGiftVouchersForHolder = (
  customerId: CustomerId,
) => Promise<Result<readonly GiftVoucher[], RepositoryError>>;

/** `couponGrants/{id}` — `null` when absent. */
export type LoadCouponGrant = (
  id: CouponGrantId,
) => Promise<Result<CouponGrant | null, RepositoryError>>;

/**
 * A client record's ACTIVE grants — `customerId ==`, `grantStatus ==
 * ACTIVE` (D29; `coupon-grant-repository.adapter.ts:308-309`, equality
 * merge, no composite). Which of them are usable at `nowUtcMs` (an expiry
 * the grant carries) is `CouponGrantSystem`'s decision, not the query's.
 */
export type ListUsableCouponGrants = (
  customerId: CustomerId,
) => Promise<Result<readonly CouponGrant[], RepositoryError>>;

// ── Loyalty (keyed by the client record, D29) ─────────────────────────────

/**
 * `loyaltyAccounts/{customerId}` — the client record's account as stored;
 * `null` before its first entry.
 */
export type LoadLoyaltyAccount = (
  customerId: CustomerId,
) => Promise<Result<LoyaltyAccount | null, RepositoryError>>;

/** `loyaltyAccounts/{customerId}/badgeProgress` — the whole subcollection, every document as stored. */
export type ListBadgeProgress = (
  customerId: CustomerId,
) => Promise<Result<readonly BadgeProgress[], RepositoryError>>;

/** `loyaltyAccounts/{customerId}/seasonProgress` — the whole subcollection, every document as stored. */
export type ListSeasonProgress = (
  customerId: CustomerId,
) => Promise<Result<readonly SeasonProgress[], RepositoryError>>;

/**
 * The loyalty catalogue, under `LoyaltyCatalogSystem`'s part names
 * (`LoyaltyCatalogParts`), so the answer passes to its `validate` UNMAPPED
 * (Law 3): the shelves, the medal families, the seasons, the tiers, the
 * rewards and the rhythm's heads (`streaks`). The ports tier may not import
 * the systems tier, so the record is declared here and
 * `engagement-entities.type-spec.ts` pins it assignable to
 * `LoyaltyCatalogParts`.
 */
export type LoyaltyCatalog = {
  readonly categories: readonly BadgeCategory[];
  readonly series: readonly BadgeSeries[];
  readonly seasons: readonly Season[];
  readonly tiers: readonly TierDefinition[];
  readonly rewards: readonly RewardCatalogItem[];
  readonly streaks: readonly StreakDefinition[];
};

/**
 * `badgeCategories`, `badgeSeries`, `seasons`, `tierDefinitions`,
 * `rewardsCatalog` and `streakDefinitions`, each read whole, in Firestore's
 * id order — static, admin-authored, read together, every document as
 * stored. Whether the catalogue holds together (and its display order) is
 * `LoyaltyCatalogSystem.validate`'s call, made by the reader.
 */
export type LoadLoyaltyCatalog = () => Promise<
  Result<LoyaltyCatalog, RepositoryError>
>;

/** One page of a client record's client-visible journal, newest first. */
export type JournalPage = {
  readonly entries: readonly JournalEntry[];
  /** The `seq` the next page reads strictly below; `null` at the end. */
  readonly nextBeforeSeq: number | null;
};

/**
 * The activity feed «Движение» and the ledger — `clientJournal` where
 * `customerId ==`, `journalVisibility == CLIENT`, `journalEffect in
 * effects` (a pill's `JournalFeed.effectsOf`), `orderBy seq desc`, `seq <
 * beforeSeq` when one is given, `limit + 1` rows read and trimmed by
 * `PagingSystem` (§2.8; index #21: `customerId`, `journalVisibility`,
 * `journalEffect`, `seq` desc). Rows as stored.
 */
export type PageClientJournal = (
  customerId: CustomerId,
  effects: readonly JournalEffect[],
  beforeSeq: number | null,
  limit: number,
) => Promise<Result<JournalPage, RepositoryError>>;

// ── Streak definitions ────────────────────────────────────────────────────

/** `streakDefinitions/{id}`, live — the head with its `rules` list (the rule in force and the one that waits); `null` when absent. */
export type ObserveStreakDefinitionHead = (
  id: StreakDefinitionId,
) => Observable<Result<StreakDefinition | null, RepositoryError>>;

/**
 * The newest `limit` published versions — `streakDefinitions/{id}/versions`,
 * `orderBy version desc`, `limit` at least one.
 */
export type ListStreakDefinitionVersions = (
  id: StreakDefinitionId,
  limit: number,
) => Promise<Result<readonly StreakDefinitionVersion[], RepositoryError>>;

/**
 * Publishes the rhythm's rule through the admin-only callable
 * (`publishStreakDefinition`, its wire frozen): the receipt of the version
 * it made — or, for a retry of the same `requestId`, of the version the
 * first send made. A refusal is a `StreakPublishError`: `CALLER_NOT_ADMIN`
 * for the callable's `notAdmin` answer and for a thrown
 * `permission-denied`/`unauthenticated`; `INVALID` with the flat
 * `StreakRuleField`s at fault (a locator the page does not know kept as
 * written); `TOO_EARLY` with the `earliest` day (the request's own day when
 * the answer names none); `STALE`, `RECOMPUTE_NEEDS_ENGINE`,
 * `PREVIEW_STALE`. A request that got no answer, or an answer that is none
 * of `published`/`withdrawn`/`refused` as the call expects, is a
 * `RepositoryError`.
 */
export type PublishStreakRule = (
  call: StreakPublishCall,
) => Promise<
  Result<StreakPublishCall.Receipt, StreakPublishError | RepositoryError>
>;

/**
 * Withdraws the version that waits for its day, through the same callable
 * (`op: 'withdraw'`). Refusals as {@link PublishStreakRule}'s; an answer for
 * another version, a publish answer or none at all is a `RepositoryError`.
 */
export type WithdrawStreakRule = (
  call: StreakPublishCall.Withdraw,
) => Promise<Result<void, StreakPublishError | RepositoryError>>;

// ── Focused bundles (Law 9 — composed with `&`, never sliced) ─────────────

/** A coupon by its typed code — the visit edit's discount check (server and web). */
export type CouponLookupPorts = {
  readonly findCouponByCode: FindCouponByCode;
};

/** The shop's open coupons and a set of coupons by id. */
export type CouponCatalogPorts = {
  readonly listOpenCoupons: ListOpenCoupons;
  readonly loadCoupons: LoadCoupons;
};

/** A client record's coupon grants. */
export type CouponGrantPorts = {
  readonly loadCouponGrant: LoadCouponGrant;
  readonly listUsableCouponGrants: ListUsableCouponGrants;
};

/** Gift vouchers by code and by holder. */
export type GiftVoucherPorts = {
  readonly findGiftVoucherByCode: FindGiftVoucherByCode;
  readonly listGiftVouchersForHolder: ListGiftVouchersForHolder;
};

/**
 * Coupons, grants and gift vouchers — the bundle the web's
 * `COUPON_VOUCHER_PORTS` token binds (the visit editor's «Отстъпка» menu,
 * the client card's wallet).
 */
export type CouponVoucherPorts = CouponLookupPorts &
  CouponCatalogPorts &
  CouponGrantPorts &
  GiftVoucherPorts;

/**
 * A client record's loyalty account, badge progress and season progress —
 * the bundle the web's `LOYALTY_ACCOUNT_READ_PORTS` token binds (the
 * client card).
 */
export type LoyaltyAccountReadPorts = {
  readonly loadLoyaltyAccount: LoadLoyaltyAccount;
  readonly listBadgeProgress: ListBadgeProgress;
  readonly listSeasonProgress: ListSeasonProgress;
};

/** The loyalty catalogue — the bundle the web's `LOYALTY_CATALOG_READ_PORTS` token binds. */
export type LoyaltyCatalogReadPorts = {
  readonly loadLoyaltyCatalog: LoadLoyaltyCatalog;
};

/** A client record's loyalty and the catalogue it is drawn by — a suite of the two. */
export type LoyaltyReadPorts = LoyaltyAccountReadPorts &
  LoyaltyCatalogReadPorts;

/** A client record's journal pages — the web's `CLIENT_JOURNAL_PORTS`. */
export type ClientJournalPorts = {
  readonly pageClientJournal: PageClientJournal;
};

/** A streak definition's live head and its published versions — the web's `STREAK_DEFINITION_PORTS`. */
export type StreakDefinitionPorts = {
  readonly observeStreakDefinitionHead: ObserveStreakDefinitionHead;
  readonly listStreakDefinitionVersions: ListStreakDefinitionVersions;
};

/**
 * The rhythm's publish and withdrawal through the callable — the bundle the
 * web's `STREAK_PUBLISH_PORTS` token binds (the admin rhythm page).
 */
export type StreakPublishGatewayPorts = {
  readonly publishStreakRule: PublishStreakRule;
  readonly withdrawStreakRule: WithdrawStreakRule;
};

/** The engagement context's whole port suite — an intersection of its bundles. */
export type EngagementPorts = CouponVoucherPorts &
  LoyaltyReadPorts &
  ClientJournalPorts &
  StreakDefinitionPorts &
  StreakPublishGatewayPorts;
