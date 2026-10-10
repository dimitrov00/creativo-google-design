import type { Observable } from 'rxjs';
import type { JournalEffectKind } from '../components/journal-effect.data';
import type { RepositoryError } from '../components/repository-errors.data';
import type { Result } from '../components/result.data';
import type { VoucherCode } from '../components/voucher-code.data';
import type { BadgeCategoryEntity } from '../entities/badge-category.entity';
import type { BadgeProgressEntity } from '../entities/badge-progress.entity';
import type { BadgeSeriesEntity } from '../entities/badge-series.entity';
import type {
  CouponGrantEntity,
  CouponGrantId,
} from '../entities/coupon-grant.entity';
import type { CouponEntity } from '../entities/coupon.entity';
import type { GiftVoucherEntity } from '../entities/gift-voucher.entity';
import type { JournalEntryEntity } from '../entities/journal-entry.entity';
import type { LoyaltyAccountEntity } from '../entities/loyalty-account.entity';
import type { RewardCatalogItemEntity } from '../entities/reward-catalog-item.entity';
import type { SeasonProgressEntity } from '../entities/season-progress.entity';
import type { SeasonEntity } from '../entities/season.entity';
import type {
  StreakDefinitionEntity,
  StreakDefinitionId,
} from '../entities/streak-definition.entity';
import type { StreakDefinitionVersionEntity } from '../entities/streak-definition-version.entity';
import type { TierDefinitionEntity } from '../entities/tier-definition.entity';
import type { UserId } from '../entities/user.entity';

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
) => Promise<Result<CouponEntity | null, RepositoryError>>;

/** Every enabled coupon — `status ==` (`coupon-reader.adapter.ts:59`). */
export type ListOpenCoupons = () => Promise<
  Result<readonly CouponEntity[], RepositoryError>
>;

/** The gift voucher a code names — `code ==` (`gift-voucher-reader.adapter.ts:34`); `null` when none. */
export type FindGiftVoucherByCode = (
  code: VoucherCode,
) => Promise<Result<GiftVoucherEntity | null, RepositoryError>>;

/** Every voucher issued to a person — `issuedToUserId ==` (`client-vouchers-reader.adapter.ts:49`). */
export type ListGiftVouchersForHolder = (
  userId: UserId,
) => Promise<Result<readonly GiftVoucherEntity[], RepositoryError>>;

/** `couponGrants/{id}` — `null` when absent. */
export type LoadCouponGrant = (
  id: CouponGrantId,
) => Promise<Result<CouponGrantEntity | null, RepositoryError>>;

/**
 * A person's ACTIVE grants — `userId ==`, `state.kind == active`
 * (`coupon-grant-repository.adapter.ts:308-309`, equality merge). Which of
 * them are usable at `nowMs` (an expiry the grant carries) is
 * `CouponGrantSystem`'s decision, not the query's.
 */
export type ListUsableCouponGrants = (
  userId: UserId,
) => Promise<Result<readonly CouponGrantEntity[], RepositoryError>>;

// ── Loyalty ───────────────────────────────────────────────────────────────

/** `loyaltyAccounts/{uid}` — `null` before the person's first entry. */
export type LoadLoyaltyAccount = (
  userId: UserId,
) => Promise<Result<LoyaltyAccountEntity | null, RepositoryError>>;

/** `loyaltyAccounts/{uid}/badgeProgress` — the whole subcollection. */
export type ListBadgeProgress = (
  userId: UserId,
) => Promise<Result<readonly BadgeProgressEntity[], RepositoryError>>;

/** `loyaltyAccounts/{uid}/seasonProgress` — the whole subcollection. */
export type ListSeasonProgress = (
  userId: UserId,
) => Promise<Result<readonly SeasonProgressEntity[], RepositoryError>>;

/** The five loyalty catalogue collections, each read whole. */
export type LoyaltyCatalog = {
  readonly badgeCategories: readonly BadgeCategoryEntity[];
  readonly badgeSeries: readonly BadgeSeriesEntity[];
  readonly seasons: readonly SeasonEntity[];
  readonly tierDefinitions: readonly TierDefinitionEntity[];
  readonly rewards: readonly RewardCatalogItemEntity[];
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
  readonly entries: readonly JournalEntryEntity[];
  /** The `seq` the next page reads strictly below; `null` at the end. */
  readonly nextBeforeSeq: number | null;
};

/**
 * The activity feed «Движение» — `clientJournal` where `userId ==`,
 * `visibility == client`, `effect.kind in effectKinds`, `orderBy seq desc`
 * (index #21, `loyalty-activity-reader.adapter.ts:75-107`). `effectKinds`
 * is the pill's list (the feed's `ACTIVITY_EFFECT_KINDS` table: points,
 * rewards, status, all); the paging trim is `PagingSystem`'s (§2.8).
 */
export type PageClientJournal = (
  userId: UserId,
  effectKinds: readonly JournalEffectKind[],
  beforeSeq: number | null,
  limit: number,
) => Promise<Result<JournalPage, RepositoryError>>;

// ── Streak definitions ────────────────────────────────────────────────────

/** `streakDefinitions/{id}`, live — the head with its current and scheduled rule. */
export type ObserveStreakDefinitionHead = (
  id: StreakDefinitionId,
) => Observable<Result<StreakDefinitionEntity | null, RepositoryError>>;

/**
 * The newest `limit` published versions — `streakDefinitions/{id}/versions`,
 * `orderBy version desc` (`streak-definition-repository.adapter.ts:194`).
 */
export type ListStreakDefinitionVersions = (
  id: StreakDefinitionId,
  limit: number,
) => Promise<Result<readonly StreakDefinitionVersionEntity[], RepositoryError>>;

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
