/**
 * Compile-only proofs over the loyalty group's archetypes (Laws 2 and 6,
 * flatten-spec §7 notes): each entity is the intersection of FLAT slices
 * that share no field name, the intersection is never `never`, every
 * variant is flat (`NoNested`), and each domain discriminator narrows to
 * exactly its variant's fields — the variant slices of F-26
 * (`BadgeSubjectSlot`, `TierOverride`, `GrantRefFields`) included. Below,
 * the brand checks the engagement ids carried before they moved to
 * `primitives/ids.primitive.ts`; then the loyalty flip's (3) contracts:
 * the account and the journal key by the client RECORD (`CustomerId`, D29),
 * never by an account's `UserId`, and the ports tier's `LoyaltyCatalog`
 * passes to `LoyaltyCatalogSystem` unmapped (its part names, the rhythm's
 * heads included); and the programs flip's (4): `ShopEvent` is the
 * intersection of two disjoint slices, and `ProgramsPorts` is the
 * intersection of six non-empty bundles holding exactly nine ports (Law 9).
 * `tsc` failing — on a `false` constant or an unused
 * `@ts-expect-error` — IS the test; nothing here runs.
 */
import {
  type Actor,
  ActorRole,
  BadgeSubject,
  type BadgeSubjectSlot,
  type MetricRef,
  type SeasonWindow,
  JournalEffect,
  type JournalEffectRecord,
  RewardRef,
  JournalSource,
  type JournalSourceRecord,
  type NotificationPayload,
  NotificationTopic,
  type PointsExpiry,
  RewardGrant,
  type RewardGrantRule,
  StreakInterval,
  StreakQualifier,
  type StreakRule,
  type TierOverride,
  TierOverrideSource,
  type TierStanding,
  type TierState,
} from '@core/components';
import type {
  BadgeCategoryId,
  BadgeSeriesId,
  CouponGrantId,
  CouponId,
  CustomerId,
  GiftVoucherId,
  InvitationId,
  JournalEntryId,
  NotificationId,
  RewardId,
  SeasonId,
  StreakDefinitionId,
  StreakDefinitionVersionId,
  TierId,
  UserId,
} from '@core/primitives';
import type {
  CourseReadPorts,
  CourseWritePorts,
  LoyaltyCatalog,
  PositionReadPorts,
  PositionWritePorts,
  ProgramsPorts,
  ShopEventReadPorts,
  ShopEventWritePorts,
} from '@core/ports';
import type { LoyaltyCatalogParts } from '@core/systems';
import type { AllTrue, Disjoint, NoNested } from '@core/testing';
import type { BadgeCategory } from './badge-category.entity';
import type { BadgeProgress } from './badge-progress.entity';
import type { BadgeSeries, BadgeSeriesMeta } from './badge-series.entity';
import type { Course } from './course.entity';
import type {
  ShopEvent,
  ShopEventContent,
  ShopEventMeta,
} from './event.entity';
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

/* ── D29: the account and the journal key by the client RECORD ──────────── */

declare const customerId: CustomerId;
declare const userId: UserId;

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

export const accountKeyedByRecord: [
  Equals<LoyaltyAccount['id'], CustomerId>,
  Equals<LoyaltyAccount['customerId'], CustomerId>,
  Equals<JournalEntry['customerId'], CustomerId>,
] = [true, true, true];

takes<LoyaltyAccount['customerId']>(customerId);
takes<JournalEntry['customerId']>(customerId);
// @ts-expect-error — an account's uid never keys a loyalty account (D29)
takes<LoyaltyAccount['customerId']>(userId);
// @ts-expect-error — an account's uid is not a loyalty account's document id
takes<LoyaltyAccount['id']>(userId);
// @ts-expect-error — a journal row rewards a client record, never an account
takes<JournalEntry['customerId']>(userId);
// @ts-expect-error — the uid field is gone from the account body
void account.userId;
// @ts-expect-error — the uid field is gone from the journal row
void entry.userId;

// Who ACTED on a journal row stays an account (`actor*` is a `UserId`).
if (entry.actorRole === ActorRole.User) {
  takes<UserId>(entry.actorUserId);
  // @ts-expect-error — the actor is an account, never a client record
  takes<CustomerId>(entry.actorUserId);
}

/* ── LoyaltyCatalog (ports) passes to LoyaltyCatalogSystem unmapped ─────── */

declare const catalog: LoyaltyCatalog;
declare function takesParts(parts: LoyaltyCatalogParts): void;
takesParts(catalog);

export const catalogCarriesTheHeads: Equals<
  LoyaltyCatalog['streaks'],
  readonly StreakDefinition[]
> = true;
export const catalogKeysAreTheParts: Equals<
  keyof LoyaltyCatalog,
  keyof LoyaltyCatalogParts
> = true;

/* ── ShopEvent = Meta (id, instant) & Content (what the admin typed) ────── */

export const shopEventNotNever: [
  IsNever<ShopEventMeta>,
  IsNever<ShopEventContent>,
] = [false, false];
export const shopEventSlicesFlat: [
  EveryVariantFlat<ShopEventMeta>,
  EveryVariantFlat<ShopEventContent>,
] = [true, true];
export const shopEventDisjoint: Disjoint<ShopEventMeta, ShopEventContent> =
  true;
export const shopEventIsItsSlices: Equals<
  keyof ShopEvent,
  keyof ShopEventMeta | keyof ShopEventContent
> = true;

declare const shopEvent: ShopEvent;
// @ts-expect-error — the zone is the location's, never an event field (Law 7.2)
void shopEvent.timeZone;

/* ── ProgramsPorts = six focused bundles, nine ports (Law 9) ────────────── */

export const programBundlesNotNever: [
  IsNever<PositionReadPorts>,
  IsNever<PositionWritePorts>,
  IsNever<CourseReadPorts>,
  IsNever<CourseWritePorts>,
  IsNever<ShopEventReadPorts>,
  IsNever<ShopEventWritePorts>,
  IsNever<ProgramsPorts>,
] = [false, false, false, false, false, false, false];
export const programsPortsAreTheNine: Equals<
  keyof ProgramsPorts,
  | 'observePositions'
  | 'loadPosition'
  | 'savePosition'
  | 'observeCourses'
  | 'loadCourse'
  | 'saveCourse'
  | 'observeEvents'
  | 'loadEvent'
  | 'saveEvent'
> = true;
export const programsPortsAreTheBundles: Equals<
  keyof ProgramsPorts,
  | keyof PositionReadPorts
  | keyof PositionWritePorts
  | keyof CourseReadPorts
  | keyof CourseWritePorts
  | keyof ShopEventReadPorts
  | keyof ShopEventWritePorts
> = true;
export const programBundlesDisjoint: [
  Disjoint<PositionReadPorts, PositionWritePorts>,
  Disjoint<CourseReadPorts, CourseWritePorts>,
  Disjoint<ShopEventReadPorts, ShopEventWritePorts>,
] = [true, true, true];
