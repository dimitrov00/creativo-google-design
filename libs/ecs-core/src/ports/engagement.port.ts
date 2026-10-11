import type { Observable } from 'rxjs';
import type { JournalEffect } from '../components/journal-effect.data';
import type { RepositoryError } from '../components/repository-errors.data';
import type { Result } from '../components/result.data';
import type { VoucherCode } from '../components/voucher-code.data';
import type { BadgeCategory } from '../entities/badge-category.entity';
import type { BadgeProgress } from '../entities/badge-progress.entity';
import type { BadgeSeries } from '../entities/badge-series.entity';
import type { CouponGrant } from '../entities/coupon-grant.entity';
import type { Coupon } from '../entities/coupon.entity';
import type { GiftVoucher } from '../entities/gift-voucher.entity';
import type { JournalEntry } from '../entities/journal-entry.entity';
import type { LoyaltyAccount } from '../entities/loyalty-account.entity';
import type { RewardCatalogItem } from '../entities/reward-catalog-item.entity';
import type { SeasonProgress } from '../entities/season-progress.entity';
import type { Season } from '../entities/season.entity';
import type { StreakDefinition } from '../entities/streak-definition.entity';
import type { StreakDefinitionVersion } from '../entities/streak-definition-version.entity';
import type { TierDefinition } from '../entities/tier-definition.entity';
import type {
  CouponGrantId,
  StreakDefinitionId,
  UserId,
} from '../primitives/ids.primitive';

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
 * The enabled coupon a typed code names — `code ==`, `status ==
 * CouponStatus.Enabled`, `limit 1` (`coupon-reader.adapter.ts:34-35`,
 * single-field equality merge); `null` when none. `code` is already
 * normalised (`VoucherCode`). Also the `resolveDiscount` read of the
 * staff edit (§4.1), made OUTSIDE its transaction — a code is a lookup,
 * the grants it may burn are read inside.
 */
export type FindCouponByCode = (
  code: VoucherCode,
) => Promise<Result<Coupon | null, RepositoryError>>;

/** Every enabled coupon — `status ==` (`coupon-reader.adapter.ts:59`). */
export type ListOpenCoupons = () => Promise<
  Result<readonly Coupon[], RepositoryError>
>;

/** The gift voucher a code names — `code ==` (`gift-voucher-reader.adapter.ts:34`); `null` when none. */
export type FindGiftVoucherByCode = (
  code: VoucherCode,
) => Promise<Result<GiftVoucher | null, RepositoryError>>;

/** Every voucher issued to a person — `issuedToUserId ==` (`client-vouchers-reader.adapter.ts:49`). */
export type ListGiftVouchersForHolder = (
  userId: UserId,
) => Promise<Result<readonly GiftVoucher[], RepositoryError>>;

/** `couponGrants/{id}` — `null` when absent. */
export type LoadCouponGrant = (
  id: CouponGrantId,
) => Promise<Result<CouponGrant | null, RepositoryError>>;

/**
 * A person's ACTIVE grants — `userId ==`, the grant's status `== ACTIVE`
 * (`coupon-grant-repository.adapter.ts:308-309`, equality merge). Which of
 * them are usable at `nowUtcMs` (an expiry the grant carries) is
 * `CouponGrantSystem`'s decision, not the query's. Keyed by `UserId` until
 * flip (1) (D29, §5.5).
 */
export type ListUsableCouponGrants = (
  userId: UserId,
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

/** The engagement context's port catalogue; each root binds the `Pick` it implements. */
export type EngagementPorts = {
  readonly findCouponByCode: FindCouponByCode;
  readonly listOpenCoupons: ListOpenCoupons;
  readonly findGiftVoucherByCode: FindGiftVoucherByCode;
  readonly listGiftVouchersForHolder: ListGiftVouchersForHolder;
  readonly loadCouponGrant: LoadCouponGrant;
  readonly listUsableCouponGrants: ListUsableCouponGrants;
  readonly loadLoyaltyAccount: LoadLoyaltyAccount;
  readonly listBadgeProgress: ListBadgeProgress;
  readonly listSeasonProgress: ListSeasonProgress;
  readonly loadLoyaltyCatalog: LoadLoyaltyCatalog;
  readonly pageClientJournal: PageClientJournal;
  readonly observeStreakDefinitionHead: ObserveStreakDefinitionHead;
  readonly listStreakDefinitionVersions: ListStreakDefinitionVersions;
};
