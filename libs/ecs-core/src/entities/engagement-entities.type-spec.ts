/**
 * Compile-only proofs over the loyalty group's archetypes (Laws 2 and 6,
 * flatten-spec §7 notes): each entity is the intersection of FLAT slices
 * that share no field name, the intersection is never `never`, every
 * variant is flat (`NoNested`), and each domain discriminator narrows to
 * exactly its variant's fields — the variant slices of F-26
 * (`BadgeSubjectSlot`, `TierOverride`, `GrantRefFields`) included. Below,
 * the brand checks the engagement ids carried before they moved to
 * `primitives/ids.primitive.ts`. `tsc` failing — on a `false` constant or an
 * unused `@ts-expect-error` — IS the test; nothing here runs.
 */
import type { Actor } from '../components/actor.data';
import {
  BadgeSubject,
  type BadgeSubjectSlot,
  type MetricRef,
  type SeasonWindow,
} from '../components/gamification.data';
import {
  JournalEffect,
  type JournalEffectRecord,
  RewardRef,
} from '../components/journal-effect.data';
import {
  JournalSource,
  type JournalSourceRecord,
} from '../components/journal-source.data';
import {
  type NotificationPayload,
  NotificationTopic,
} from '../components/notification-payload.data';
import type { PointsExpiry } from '../components/points-expiry.data';
import {
  RewardGrant,
  type RewardGrantRule,
} from '../components/reward-grant.data';
import { StreakInterval } from '../components/streak-interval.data';
import { StreakQualifier } from '../components/streak-qualifier.data';
import type { StreakRule } from '../components/streak-rule.data';
import {
  type TierOverride,
  TierOverrideSource,
  type TierStanding,
  type TierState,
} from '../components/tier-state.data';
import type {
  BadgeCategoryId,
  BadgeSeriesId,
  CouponGrantId,
  CouponId,
  GiftVoucherId,
  InvitationId,
  JournalEntryId,
  NotificationId,
  RewardId,
  SeasonId,
  StreakDefinitionId,
  StreakDefinitionVersionId,
  TierId,
} from '../primitives/ids.primitive';
import type { AllTrue, Disjoint, NoNested } from '../testing';
import type { BadgeCategory } from './badge-category.entity';
import type { BadgeProgress } from './badge-progress.entity';
import type { BadgeSeries, BadgeSeriesMeta } from './badge-series.entity';
import type { Course } from './course.entity';
import type { ShopEvent } from './event.entity';
import type { InvitationRedemption } from './invitation-redemption.entity';
import type { Invitation } from './invitation.entity';
import type { JournalEntry, JournalEntryMeta } from './journal-entry.entity';
import type {
  LoyaltyAccount,
  LoyaltyAccountMeta,
} from './loyalty-account.entity';
import type { InboxNotification } from './notification.entity';
import type { Position } from './position.entity';
import type {
  RewardCatalogItem,
  RewardCatalogItemMeta,
} from './reward-catalog-item.entity';
import type { SeasonProgress } from './season-progress.entity';
import type { Season, SeasonMeta } from './season.entity';
import type { StreakDefinitionVersion } from './streak-definition-version.entity';
import type { StreakDefinition } from './streak-definition.entity';
import type { TierDefinition } from './tier-definition.entity';

type IsNever<T> = [T] extends [never] ? true : false;
/** `true` when EVERY variant of the union is flat (distributes over `E`). */
type EveryVariantFlat<E> = E extends unknown ? AllTrue<NoNested<E>> : never;

/* ── Plain archetypes: one flat struct each ─────────────────────────────── */

export const plainNotNever: [
  IsNever<BadgeCategory>,
  IsNever<BadgeProgress>,
  IsNever<Course>,
  IsNever<ShopEvent>,
  IsNever<Invitation>,
  IsNever<InvitationRedemption>,
  IsNever<Position>,
  IsNever<SeasonProgress>,
  IsNever<StreakDefinition>,
  IsNever<TierDefinition>,
] = [false, false, false, false, false, false, false, false, false, false];
export const plainFlat: [
  EveryVariantFlat<BadgeCategory>,
  EveryVariantFlat<BadgeProgress>,
  EveryVariantFlat<Course>,
  EveryVariantFlat<ShopEvent>,
  EveryVariantFlat<Invitation>,
  EveryVariantFlat<InvitationRedemption>,
  EveryVariantFlat<Position>,
  EveryVariantFlat<SeasonProgress>,
  EveryVariantFlat<StreakDefinition>,
  EveryVariantFlat<TierDefinition>,
] = [true, true, true, true, true, true, true, true, true, true];

/* ── BadgeSeries = Meta & MetricRef & BadgeSubjectSlot ──────────────────── */

export const badgeSeriesNotNever: IsNever<BadgeSeries> = false;
export const badgeSeriesFlat: EveryVariantFlat<BadgeSeries> = true;
export const badgeSeriesDisjoint: [
  Disjoint<BadgeSeriesMeta, MetricRef>,
  Disjoint<BadgeSeriesMeta, BadgeSubjectSlot>,
  Disjoint<MetricRef, BadgeSubjectSlot>,
] = [true, true, true];

declare const series: BadgeSeries;
if (series.badgeSubject === BadgeSubject.Service) void series.subjectServiceId;
if (series.badgeSubject === BadgeSubject.Barber) {
  // @ts-expect-error — a BARBER family declares no service
  void series.subjectServiceId;
}
if (series.badgeSubject === null) {
  // @ts-expect-error — a family about nothing declares no subject id
  void series.subjectLocationId;
}

/* ── Season = Meta & SeasonWindow ───────────────────────────────────────── */

export const seasonNotNever: IsNever<Season> = false;
export const seasonFlat: EveryVariantFlat<Season> = true;
export const seasonDisjoint: Disjoint<SeasonMeta, SeasonWindow> = true;

/* ── RewardCatalogItem = Meta & RewardGrantRule ─────────────────────────── */

export const rewardNotNever: IsNever<RewardCatalogItem> = false;
export const rewardFlat: EveryVariantFlat<RewardCatalogItem> = true;
export const rewardDisjoint: Disjoint<RewardCatalogItemMeta, RewardGrantRule> =
  true;

declare const reward: RewardCatalogItem;
if (reward.rewardGrant === RewardGrant.Voucher) void reward.grantVoucherCents;
if (reward.rewardGrant === RewardGrant.Coupon) {
  // @ts-expect-error — a coupon grant carries no voucher value
  void reward.grantVoucherCents;
}

/* ── LoyaltyAccount = Meta & TierState (Standing & Override) & PointsExpiry ─ */

export const accountNotNever: IsNever<LoyaltyAccount> = false;
export const accountFlat: EveryVariantFlat<LoyaltyAccount> = true;
export const accountDisjoint: [
  Disjoint<LoyaltyAccountMeta, TierState>,
  Disjoint<LoyaltyAccountMeta, PointsExpiry>,
  Disjoint<TierState, PointsExpiry>,
  Disjoint<TierStanding, TierOverride>,
] = [true, true, true, true];

declare const account: LoyaltyAccount;
if (account.tierOverrideSource === TierOverrideSource.Award) {
  void account.tierOverrideAwardKey;
  // @ts-expect-error — an award override names no adjustment
  void account.tierOverrideAdjustmentId;
}
if (account.tierOverrideSource === null) {
  // @ts-expect-error — no override stands, so no override tier
  void account.tierOverrideTierId;
}

/* ── JournalEntry = Meta & Actor & JournalSourceRecord & JournalEffectRecord ─ */

export const journalNotNever: IsNever<JournalEntry> = false;
export const journalFlat: EveryVariantFlat<JournalEntry> = true;
export const journalDisjoint: [
  Disjoint<JournalEntryMeta, Actor>,
  Disjoint<JournalEntryMeta, JournalSourceRecord>,
  Disjoint<JournalEntryMeta, JournalEffectRecord>,
  Disjoint<Actor, JournalSourceRecord>,
  Disjoint<Actor, JournalEffectRecord>,
  Disjoint<JournalSourceRecord, JournalEffectRecord>,
] = [true, true, true, true, true, true];

declare const entry: JournalEntry;
if (entry.journalEffect === JournalEffect.Points) void entry.pointsDelta;
if (entry.journalEffect === JournalEffect.Tier) {
  // @ts-expect-error — a tier row moves no points
  void entry.pointsDelta;
}
if (entry.journalSource === JournalSource.Rule) void entry.sourceEventId;
if (entry.journalSource === JournalSource.System) {
  // @ts-expect-error — a job's row cites no rule
  void entry.sourceRuleId;
}
if (entry.journalEffect === JournalEffect.Redemption) {
  if (entry.grantRef === RewardRef.GiftVoucher) void entry.grantGiftVoucherId;
  if (entry.grantRef === null) {
    // @ts-expect-error — nothing minted yet, so no grant id
    void entry.grantCouponGrantId;
  }
}
if (entry.journalEffect === JournalEffect.Reward) {
  if (entry.rewardRef === RewardRef.Perk) void entry.rewardPerkId;
}

/* ── InboxNotification = stamps & NotificationPayload ───────────────────── */

export const inboxNotNever: IsNever<InboxNotification> = false;
export const inboxFlat: EveryVariantFlat<InboxNotification> = true;
export const inboxDisjoint: Disjoint<
  Pick<InboxNotification, 'id' | 'sentAtUtcMs' | 'readAtUtcMs'>,
  NotificationPayload
> = true;

declare const inbox: InboxNotification;
if (inbox.notificationTopic === NotificationTopic.WaitlistMatch) {
  void inbox.waitlistRequestId;
}
if (inbox.notificationTopic === NotificationTopic.Announcement) {
  // @ts-expect-error — an announcement names no waitlist request
  void inbox.waitlistRequestId;
}

/* ── StreakDefinitionVersion = the flat StreakRule & its history ────────── */

export const versionNotNever: IsNever<StreakDefinitionVersion> = false;
export const versionFlat: EveryVariantFlat<StreakDefinitionVersion> = true;
export const ruleFlat: EveryVariantFlat<StreakRule> = true;

declare const version: StreakDefinitionVersion;
if (version.streakInterval === StreakInterval.Personal) {
  void version.intervalFallbackDays;
  // @ts-expect-error — a personal interval holds no fixed figure
  void version.intervalDays;
}
if (version.streakQualifier === StreakQualifier.AnyVisit) {
  // @ts-expect-error — any visit counts: no list
  void version.qualifierServiceIds;
}

/* ── The engagement ids: nominal brands (moved to ids.primitive.ts) ─────── */

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
declare const badgeSeriesId: BadgeSeriesId;
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
// @ts-expect-error — a raw string is not a BadgeSeriesId
takes<BadgeSeriesId>('series-fade');
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
// @ts-expect-error — a SeasonId is not a BadgeSeriesId
takes<BadgeSeriesId>(seasonId);
// @ts-expect-error — a BadgeSeriesId is not a BadgeCategoryId
takes<BadgeCategoryId>(badgeSeriesId);
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
