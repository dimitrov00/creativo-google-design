/**
 * Compile-only assertions over the engagement entities' id brands
 * (blueprint §6 Phase 1, "a type-spec per entity brand"): a plain string
 * never satisfies a branded id, and two brands are never interchangeable
 * although each is a plain string at runtime. `tsc` failing on an unused
 * `@ts-expect-error` IS the test; nothing here runs.
 */
import type { BadgeCategoryId } from './badge-category.entity';
import type { SeriesId } from './badge-series.entity';
import type { CouponGrantId } from './coupon-grant.entity';
import type { CouponId } from './coupon.entity';
import type { GiftVoucherId } from './gift-voucher.entity';
import type { InvitationId } from './invitation.entity';
import type { JournalEntryId } from './journal-entry.entity';
import type { NotificationId } from './notification.entity';
import type { RewardId } from './reward-catalog-item.entity';
import type { SeasonId } from './season.entity';
import type { StreakDefinitionVersionId } from './streak-definition-version.entity';
import type { StreakDefinitionId } from './streak-definition.entity';
import type { TierId } from './tier-definition.entity';

declare function takes<T>(id: T): void;

declare const couponId: CouponId;
declare const couponGrantId: CouponGrantId;
declare const giftVoucherId: GiftVoucherId;
declare const journalEntryId: JournalEntryId;
declare const streakDefinitionId: StreakDefinitionId;
declare const streakDefinitionVersionId: StreakDefinitionVersionId;
declare const notificationId: NotificationId;
declare const invitationId: InvitationId;
declare const badgeCategoryId: BadgeCategoryId;
declare const seriesId: SeriesId;
declare const seasonId: SeasonId;
declare const tierId: TierId;
declare const rewardId: RewardId;

// (a) a bare string is no branded id.
// @ts-expect-error — a raw string is not a CouponId
takes<CouponId>('coupon-1');
// @ts-expect-error — a raw string is not a CouponGrantId
takes<CouponGrantId>('grant-1');
// @ts-expect-error — a raw string is not a GiftVoucherId
takes<GiftVoucherId>('voucher-1');
// @ts-expect-error — a raw string is not a JournalEntryId
takes<JournalEntryId>('u_000001');
// @ts-expect-error — a raw string is not a StreakDefinitionId
takes<StreakDefinitionId>('cadence');
// @ts-expect-error — a raw string is not a StreakDefinitionVersionId
takes<StreakDefinitionVersionId>('000001');
// @ts-expect-error — a raw string is not a NotificationId
takes<NotificationId>('ntf-1');
// @ts-expect-error — a raw string is not an InvitationId
takes<InvitationId>('inv-1');
// @ts-expect-error — a raw string is not a BadgeCategoryId
takes<BadgeCategoryId>('cat-mastery');
// @ts-expect-error — a raw string is not a SeriesId
takes<SeriesId>('series-fade');
// @ts-expect-error — a raw string is not a SeasonId
takes<SeasonId>('season-2026-autumn');
// @ts-expect-error — a raw string is not a TierId
takes<TierId>('gold');
// @ts-expect-error — a raw string is not a RewardId
takes<RewardId>('reward-beard');

// (b) distinct brands are not interchangeable.
// @ts-expect-error — a CouponGrantId is not a CouponId
takes<CouponId>(couponGrantId);
// @ts-expect-error — a CouponId is not a GiftVoucherId
takes<GiftVoucherId>(couponId);
// @ts-expect-error — a StreakDefinitionVersionId is not a StreakDefinitionId
takes<StreakDefinitionId>(streakDefinitionVersionId);
// @ts-expect-error — a SeasonId is not a SeriesId
takes<SeriesId>(seasonId);
// @ts-expect-error — a SeriesId is not a BadgeCategoryId
takes<BadgeCategoryId>(seriesId);
// @ts-expect-error — a RewardId is not a TierId
takes<TierId>(rewardId);
// @ts-expect-error — a NotificationId is not an InvitationId
takes<InvitationId>(notificationId);
// @ts-expect-error — a JournalEntryId is not a CouponId
takes<CouponId>(journalEntryId);

// (c) each brand still reads as a string.
takes<string>(couponId);
takes<string>(giftVoucherId);
takes<string>(streakDefinitionId);
takes<string>(invitationId);
takes<string>(badgeCategoryId);
takes<string>(tierId);
