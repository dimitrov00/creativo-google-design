import type { Observable } from 'rxjs';
import type { JournalEffect, VoucherCode } from '@core/components';
import type {
  RepositoryError,
  Result,
  CouponGrantId,
  CouponId,
  CustomerId,
  StreakDefinitionId,
  UserId,
} from '@core/primitives';
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
 * The engagement context's read ports (blueprint §4.2): coupons, grants and
 * gift vouchers, the loyalty account and its catalogue, the client journal
 * and the streak definitions. One function per query shape, entities
 * straight from `snap.data()`, every one naming `RepositoryError`.
 *
 * Writes are not here: a grant burn or restore, a voucher balance, a
 * redemption counter and the streak publish are entries of one
 * `CommitPlan` (`tx.port.ts`) planned by their systems; coupons stay a
 * rules-guarded admin write until an admin surface lands (§9 D28).
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

// ── Loyalty ───────────────────────────────────────────────────────────────

/** `loyaltyAccounts/{uid}` — `null` before the person's first entry. */
export type LoadLoyaltyAccount = (
  userId: UserId,
) => Promise<Result<LoyaltyAccount | null, RepositoryError>>;

/** `loyaltyAccounts/{uid}/badgeProgress` — the whole subcollection. */
export type ListBadgeProgress = (
  userId: UserId,
) => Promise<Result<readonly BadgeProgress[], RepositoryError>>;

/** `loyaltyAccounts/{uid}/seasonProgress` — the whole subcollection. */
export type ListSeasonProgress = (
  userId: UserId,
) => Promise<Result<readonly SeasonProgress[], RepositoryError>>;

/** The five loyalty catalogue collections, each read whole. */
export type LoyaltyCatalog = {
  readonly badgeCategories: readonly BadgeCategory[];
  readonly badgeSeries: readonly BadgeSeries[];
  readonly seasons: readonly Season[];
  readonly tierDefinitions: readonly TierDefinition[];
  readonly rewards: readonly RewardCatalogItem[];
};

/**
 * `badgeCategories`, `badgeSeries`, `seasons`, `tierDefinitions` and
 * `rewardsCatalog`, whole — static, admin-authored, read together.
 */
export type LoadLoyaltyCatalog = () => Promise<
  Result<LoyaltyCatalog, RepositoryError>
>;

/** One page of a person's client-visible journal, newest first. */
export type JournalPage = {
  readonly entries: readonly JournalEntry[];
  /** The `seq` the next page reads strictly below; `null` at the end. */
  readonly nextBeforeSeq: number | null;
};

/**
 * The activity feed «Движение» — `clientJournal` where `userId ==`,
 * `journalVisibility == CLIENT`, `journalEffect in effects`, `orderBy seq
 * desc` (index #21, re-declared by the loyalty flip (3);
 * `loyalty-activity-reader.adapter.ts:75-107`). `effects` is the pill's
 * list (the feed's `ACTIVITY_EFFECT_KINDS` table: points, rewards, status,
 * all); the paging trim is `PagingSystem`'s (§2.8). Keyed by `UserId` until
 * the loyalty flip (3) (D29, §5.5).
 */
export type PageClientJournal = (
  userId: UserId,
  effects: readonly JournalEffect[],
  beforeSeq: number | null,
  limit: number,
) => Promise<Result<JournalPage, RepositoryError>>;

// ── Streak definitions ────────────────────────────────────────────────────

/** `streakDefinitions/{id}`, live — the head with its `rules` list (the rule in force and the one that waits). */
export type ObserveStreakDefinitionHead = (
  id: StreakDefinitionId,
) => Observable<Result<StreakDefinition | null, RepositoryError>>;

/**
 * The newest `limit` published versions — `streakDefinitions/{id}/versions`,
 * `orderBy version desc` (`streak-definition-repository.adapter.ts:194`).
 */
export type ListStreakDefinitionVersions = (
  id: StreakDefinitionId,
  limit: number,
) => Promise<Result<readonly StreakDefinitionVersion[], RepositoryError>>;

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

/** A client record's loyalty account, badges, seasons and the loyalty catalogue. */
export type LoyaltyReadPorts = {
  readonly loadLoyaltyAccount: LoadLoyaltyAccount;
  readonly listBadgeProgress: ListBadgeProgress;
  readonly listSeasonProgress: ListSeasonProgress;
  readonly loadLoyaltyCatalog: LoadLoyaltyCatalog;
};

/** A client record's journal pages. */
export type ClientJournalPorts = {
  readonly pageClientJournal: PageClientJournal;
};

/** A streak definition's live head and its published versions. */
export type StreakDefinitionPorts = {
  readonly observeStreakDefinitionHead: ObserveStreakDefinitionHead;
  readonly listStreakDefinitionVersions: ListStreakDefinitionVersions;
};

/** The engagement context's whole port suite — an intersection of its bundles. */
export type EngagementPorts = CouponVoucherPorts &
  LoyaltyReadPorts &
  ClientJournalPorts &
  StreakDefinitionPorts;
