/**
 * THE DEV SEED'S LOYALTY DOCUMENTS (flip 3 — loyalty and invitations): the
 * catalogue (`badgeCategories`, `badgeSeries`, `seasons`, `tierDefinitions`,
 * `rewardsCatalog`), the rhythm's head and its first version
 * (`streakDefinitions/{id}`, `…/versions/{version:06}`), and each account
 * holder's `loyaltyAccounts/{customerId}` with its `badgeProgress` and
 * `seasonProgress`, and their `clientJournal` rows — every body the flat
 * archetype minus its `id` (Laws 5–7), every builder `satisfies` its entity,
 * so a stale shape fails `pnpm nx typecheck seed-tools` instead of a read.
 *
 * The plan logic (`tools/seed/loyalty.mjs`) folds the book — the visits,
 * the levels, the tiers, the rhythm the domain projects — and hands these
 * builders plain values; the builders return the documents. Nothing here
 * folds anything, and nothing touches Firebase.
 *
 * - The catalogue is `catalog.json` of `@core/testing` (shared with the
 *   specs and the e2e, read by path by `loyalty.mjs`): each builder takes
 *   one stored body and writes back exactly the entity's fields, so a field
 *   the entity no longer has never reaches the emulator, and the season
 *   builder moves a window and its announcement by whole days.
 * - D29: an account, its progress and its journal are keyed by the client
 *   RECORD (`customerIdOf(uid)`, the production sha256); WHO acted on a row
 *   stays a `UserId` (`actor*`), and the opaque award and idempotency keys
 *   keep the text the fold gives them.
 * - T5: an instant and its shop day are written together, from one reading
 *   of the shop's clock (`SHOP_TIME_ZONE`): a row's `utcEpochMs` and
 *   `localDate`, a level's `earnedAtUtcMs` and `earnedLocalDate`, a
 *   season's `announcedAtUtcMs` and `announcedLocalDate`.
 */
import {
  AchievementOp,
  Actor,
  BadgeSubjectSlot,
  BadgeSubject,
  EarnedVia,
  GrantRefFields,
  JournalEffect,
  type JournalEffectRecord,
  JournalSourceRecord,
  JournalSystemJob,
  JournalVisibility,
  type LabelCode,
  type LabelParam,
  type LocalizedText,
  PersonalRecordKind,
  type PersonalRecord,
  PointsExpiry,
  RedemptionOp,
  RewardGrant,
  RewardGrantRule,
  RewardOp,
  RewardRefFields,
  Role,
  StreakQualifier,
  type StreakQualifierRule,
  StreakRule,
  StreakRuleDirection,
  type StreakState,
  StreakTransition,
  SystemSource,
  TierOp,
  TierOverride,
} from '@core/components';
import type {
  BadgeCategory,
  BadgeProgress,
  BadgeSeries,
  JournalEntry,
  LoyaltyAccount,
  RewardCatalogItem,
  Season,
  SeasonProgress,
  StreakDefinition,
  StreakDefinitionVersion,
  TierDefinition,
} from '@core/entities';
import {
  AchievementRuleId,
  AppointmentId,
  CorrelationId,
  CouponGrantId,
  type CustomerId,
  JournalEntryId,
  JournalEventId,
  LocalDate,
  PublishRequestId,
  RedemptionId,
  RewardId,
  ServiceId,
  StreakDefinitionVersionId,
  TierId,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import { type Body, SHOP_TIME_ZONE, day, sure } from './catalog.fixtures';
import { customerIdOf } from './customers.fixtures';

/** An instant the fold computed, as the brand (a refused one is a defect). */
const instant = (ms: number): UtcEpochMs =>
  sure(UtcEpochMs.of(ms), `instant ${ms}`);

/** The shop day of an instant — the one reading T5 writes beside it. */
const shopDayOf = (at: UtcEpochMs): LocalDate =>
  ZonedTimeSystem.toLocal(at, SHOP_TIME_ZONE).localDate;

// ── The catalogue (catalog.json, field by field) ───────────────────────────

/** `badgeCategories/{id}`: a shelf of the medals page. */
export function badgeCategoryBody(
  stored: Body<BadgeCategory>,
): Body<BadgeCategory> {
  return {
    badgeCategoryKind: stored.badgeCategoryKind,
    title: stored.title,
    order: stored.order,
  } satisfies Omit<BadgeCategory, 'id'>;
}

/** What a family is about — a service, a barber, a shop, or nothing in particular. */
function subjectSlotOf(stored: BadgeSubjectSlot): BadgeSubjectSlot {
  switch (stored.badgeSubject) {
    case null:
      return BadgeSubjectSlot.none();
    case BadgeSubject.Service:
      return BadgeSubjectSlot.service(stored.subjectServiceId);
    case BadgeSubject.Barber:
      return BadgeSubjectSlot.barber(stored.subjectBarberId);
    case BadgeSubject.Location:
      return BadgeSubjectSlot.location(stored.subjectLocationId);
  }
}

/** `badgeSeries/{id}`: a medal family, its levels and what each pays. */
export function badgeSeriesBody(stored: Body<BadgeSeries>): Body<BadgeSeries> {
  return {
    categoryId: stored.categoryId,
    seasonId: stored.seasonId,
    title: stored.title,
    requirement: stored.requirement,
    emblem: stored.emblem,
    artPath: stored.artPath,
    levels: stored.levels,
    repeatable: stored.repeatable,
    order: stored.order,
    retiredAtUtcMs: stored.retiredAtUtcMs,
    retiredLocalDate: stored.retiredLocalDate,
    version: stored.version,
    metric: stored.metric,
    metricWindowDays: stored.metricWindowDays,
    metricScopeServiceId: stored.metricScopeServiceId,
    metricScopeBarberId: stored.metricScopeBarberId,
    metricScopeLocationId: stored.metricScopeLocationId,
    ...subjectSlotOf(stored),
  } satisfies Omit<BadgeSeries, 'id'>;
}

/**
 * `seasons/{id}`, moved `shiftDays` whole days: its window by shop days,
 * its announcement by as many days of elapsed time (today's whole-day move
 * of the instant) — and the announcement's shop day read off the moved
 * instant (T5), so the notice a season gives never changes.
 */
export function seasonBody(
  stored: Body<Season>,
  shiftDays: number,
): Body<Season> {
  const announcedAtUtcMs = UtcEpochMs.plusDays(
    stored.announcedAtUtcMs,
    shiftDays,
  );
  return {
    seasonKind: stored.seasonKind,
    title: stored.title,
    emblem: stored.emblem,
    trackSeriesId: stored.trackSeriesId,
    seriesIds: stored.seriesIds,
    announcedAtUtcMs,
    announcedLocalDate: shopDayOf(announcedAtUtcMs),
    version: stored.version,
    windowFrom: LocalDate.addDays(stored.windowFrom, shiftDays),
    windowUntil: LocalDate.addDays(stored.windowUntil, shiftDays),
  } satisfies Omit<Season, 'id'>;
}

/** `tierDefinitions/{id}`: a tier and what qualifies for it. */
export function tierDefinitionBody(
  stored: Body<TierDefinition>,
): Body<TierDefinition> {
  return {
    name: stored.name,
    rank: stored.rank,
    benefits: stored.benefits,
    version: stored.version,
    effectiveFromLocalDate: stored.effectiveFromLocalDate,
    qualifyMetric: stored.qualifyMetric,
    qualifyAtLeast: stored.qualifyAtLeast,
    qualifyWindowDays: stored.qualifyWindowDays,
  } satisfies Omit<TierDefinition, 'id'>;
}

/** What a reward mints, by its `rewardGrant`. */
function grantRuleOf(stored: RewardGrantRule): RewardGrantRule {
  switch (stored.rewardGrant) {
    case RewardGrant.Coupon:
      return RewardGrantRule.coupon(stored.grantCouponId);
    case RewardGrant.Voucher:
      return RewardGrantRule.voucher(
        stored.grantVoucherCents,
        stored.grantVoucherCurrency,
        stored.grantVoucherExpiresInDays,
      );
    case RewardGrant.Perk:
      return {
        rewardGrant: RewardGrant.Perk,
        grantPerkId: stored.grantPerkId,
        grantPerkForDays: stored.grantPerkForDays,
      } satisfies RewardGrantRule.Perk;
  }
}

/** `rewardsCatalog/{id}`: what points buy at the desk. */
export function rewardCatalogItemBody(
  stored: Body<RewardCatalogItem>,
): Body<RewardCatalogItem> {
  return {
    name: stored.name,
    cost: stored.cost,
    enabled: stored.enabled,
    order: stored.order,
    availableFrom: stored.availableFrom,
    availableUntil: stored.availableUntil,
    perClientLimitCount: stored.perClientLimitCount,
    perClientLimitWindowDays: stored.perClientLimitWindowDays,
    totalLimit: stored.totalLimit,
    redeemedCount: stored.redeemedCount,
    ...grantRuleOf(stored),
  } satisfies Omit<RewardCatalogItem, 'id'>;
}

// ── The rhythm's rule: the head and its first version ──────────────────────

/** `streakDefinitions/{id}`: the rule in force (`CURRENT`) and at most one that waits. */
export function streakDefinitionBody(
  stored: Body<StreakDefinition>,
): Body<StreakDefinition> {
  return {
    name: stored.name,
    rules: stored.rules,
    updatedAtUtcMs: stored.updatedAtUtcMs,
  } satisfies Omit<StreakDefinition, 'id'>;
}

/**
 * Who published the seed's first version of a rule: no person did — the
 * rule the shop opened with (`FIXTURE_STREAK_FIRST_PUBLISHER` of
 * `@core/testing` says the same word, so a spec and the emulator list one
 * history). The one `publishedByUserId` that names no account.
 */
export const SEED_RULE_PUBLISHER: UserId = UserId.of('system');

/** `000001` — a version's document id; the history sorts by it. */
export const ruleVersionIdOf = (version: number): StreakDefinitionVersionId =>
  StreakDefinitionVersionId.forVersion(version);

/** The seed's own intent behind a version it writes: a second run writes the same document. */
export const seedRuleRequestIdOf = (
  streakId: string,
  version: number,
): PublishRequestId =>
  PublishRequestId.of(`seed-${streakId}-${ruleVersionIdOf(version)}`);

/**
 * `streakDefinitions/{id}/versions/{version:06}` for the rule a head the
 * SEED wrote holds in force: the rule alone (`StreakRule.of` — no
 * `headRole`), published by nobody at the instant the head was written,
 * changing nothing (there was no rule before it), never withdrawn.
 */
export function seedRuleVersionBody(
  streakId: string,
  rule: StreakRule,
  publishedAtUtcMs: UtcEpochMs,
): Body<StreakDefinitionVersion> {
  return {
    ...StreakRule.of(rule),
    publishedAtUtcMs,
    publishedByUserId: SEED_RULE_PUBLISHER,
    streakTransition: StreakTransition.Grandfather,
    streakRuleDirection: StreakRuleDirection.Neutral,
    changed: [],
    requestId: seedRuleRequestIdOf(streakId, rule.version),
    withdrawnAtUtcMs: null,
  } satisfies Omit<StreakDefinitionVersion, 'id'>;
}

/**
 * Does a visit of these services (in these categories) keep the rhythm
 * under the rule's qualifier? It must hold a service: the seed books no
 * service that only rides along with another, so every one counts as its
 * own. With a list, one of the visit's services (or of their categories)
 * must be on it.
 */
export function qualifierCounts(
  qualifier: StreakQualifierRule,
  serviceIds: readonly string[],
  categoryIds: readonly string[],
): boolean {
  if (serviceIds.length === 0) return false;
  switch (qualifier.streakQualifier) {
    case StreakQualifier.AnyVisit:
      return true;
    case StreakQualifier.Services:
      return serviceIds.some((id) =>
        qualifier.qualifierServiceIds.includes(ServiceId.of(id)),
      );
    case StreakQualifier.Categories:
      return categoryIds.some((id) =>
        qualifier.qualifierCategoryIds.some((listed) => listed === id),
      );
  }
}

// ── An account holder's documents ──────────────────────────────────────────

/** The tier an account holds, as the fold reached it. */
export type SeedTierPlan = {
  readonly tierId: string;
  readonly definitionVersion: number;
  readonly sinceUtcMs: number;
  readonly qualifying: number;
  readonly nextTierId: string | null;
  readonly remaining: number | null;
};

/** `loyaltyAccounts/{customerId}` as the fold leaves it. */
export type SeedAccountPlan = {
  readonly uid: string;
  readonly balance: number;
  readonly lifetimeEarned: number;
  readonly lifetimeSpent: number;
  readonly tier: SeedTierPlan;
  /** The rhythm's states as `StreakSystem.trace` answered them — one per rule that is on. */
  readonly streaks: readonly StreakState[];
  readonly punchCard: {
    readonly ruleId: string;
    readonly filled: number;
    readonly size: number;
    readonly title: LocalizedText;
  };
  readonly records: readonly PersonalRecord[];
  readonly seq: number;
  readonly version: number;
  readonly updatedAtUtcMs: number;
};

/**
 * `loyaltyAccounts/{customerIdOf(uid)}`: the balance and its lifetimes, the
 * tier at the root (no override — the seed grants none), the rhythm's
 * states as an array, the stamp card, the records; points expiry is off
 * (`DEFAULT_LOYALTY_POLICY.expiry`), so nothing lapses.
 */
export function loyaltyAccountBody(
  plan: SeedAccountPlan,
): Body<LoyaltyAccount> {
  return {
    customerId: customerIdOf(plan.uid),
    balance: plan.balance,
    lifetimeEarned: plan.lifetimeEarned,
    lifetimeAdjusted: 0,
    lifetimeSpent: plan.lifetimeSpent,
    streaks: plan.streaks,
    punchCards: [
      {
        ruleId: AchievementRuleId.of(plan.punchCard.ruleId),
        filled: plan.punchCard.filled,
        size: plan.punchCard.size,
        title: plan.punchCard.title,
      },
    ],
    records: plan.records,
    seq: plan.seq,
    version: plan.version,
    updatedAtUtcMs: instant(plan.updatedAtUtcMs),
    tierId: TierId.of(plan.tier.tierId),
    tierDefinitionVersion: plan.tier.definitionVersion,
    tierSinceUtcMs: instant(plan.tier.sinceUtcMs),
    tierQualifying: plan.tier.qualifying,
    nextTierId:
      plan.tier.nextTierId === null ? null : TierId.of(plan.tier.nextTierId),
    tierRemaining: plan.tier.remaining,
    ...TierOverride.none(),
    ...PointsExpiry.none(),
  } satisfies Omit<LoyaltyAccount, 'id'>;
}

/** «Рекорди»: the longest rhythm, and the day of the visit that reached it. */
export const longestRhythmRecord = (
  value: number,
  on: string,
): PersonalRecord => ({
  personalRecordKind: PersonalRecordKind.LongestRhythm,
  value,
  on: day(on),
  year: null,
  serviceId: null,
});

/** «Рекорди»: the busiest year. */
export const mostVisitsInYearRecord = (
  value: number,
  year: number,
): PersonalRecord => ({
  personalRecordKind: PersonalRecordKind.MostVisitsInYear,
  value,
  on: null,
  year,
  serviceId: null,
});

/** «Рекорди»: the favourite service. */
export const favouriteServiceRecord = (
  value: number,
  serviceId: string,
): PersonalRecord => ({
  personalRecordKind: PersonalRecordKind.FavouriteService,
  value,
  on: null,
  year: null,
  serviceId: ServiceId.of(serviceId),
});

/** «Рекорди»: the first visit. */
export const firstVisitRecord = (on: string): PersonalRecord => ({
  personalRecordKind: PersonalRecordKind.FirstVisit,
  value: 1,
  on: day(on),
  year: null,
  serviceId: null,
});

/** One earned level as the fold holds it: the latest instant, and how often. */
export type SeedEarnedLevel = {
  readonly level: number;
  readonly atUtcMs: number;
  readonly count: number;
};

/**
 * `…/badgeProgress/{seriesId}`: the family's value and the levels earned,
 * each by a rule, its instant and its shop day written together (T5).
 */
export function badgeProgressBody(
  value: number,
  earned: readonly SeedEarnedLevel[],
): Body<BadgeProgress> {
  return {
    value,
    earned: earned.map((level) => {
      const earnedAtUtcMs = instant(level.atUtcMs);
      return {
        level: level.level,
        earnedAtUtcMs,
        earnedLocalDate: shopDayOf(earnedAtUtcMs),
        earnedVia: EarnedVia.Rule,
        count: level.count,
      };
    }),
  } satisfies Omit<BadgeProgress, 'id'>;
}

/** `…/seasonProgress/{seasonId}`: the season's track, mirrored. */
export function seasonProgressBody(
  trackValue: number,
  trackLevel: number,
): Body<SeasonProgress> {
  return { trackValue, trackLevel } satisfies Omit<SeasonProgress, 'id'>;
}

// ── The journal ────────────────────────────────────────────────────────────

/** The loyalty engine itself: every row nobody wrote by hand. */
export const ENGINE_ACTOR: Actor = Actor.system(SystemSource.LoyaltyEngine);

/** Who redeems at the desk: the seeded staff account (`dev-staff-ivan`, barber + admin) — as the admin… */
export const DESK_ADMIN: Actor = Actor.admin(UserId.of('dev-staff-ivan'));

/** …or as the barber, with the roles the account holds. */
export const DESK_STAFF: Actor = Actor.staff(UserId.of('dev-staff-ivan'), [
  Role.Barber,
  Role.Admin,
]);

/** A rule paid or awarded it: the rule, the award key it pays once, the fact behind it. */
export const ruleSource = (
  ruleId: string,
  version: number,
  awardKey: string,
  eventId: string,
): JournalSourceRecord =>
  JournalSourceRecord.rule(
    { ruleId: AchievementRuleId.of(ruleId), version },
    awardKey,
    JournalEventId.of(eventId),
  );

/** The nightly tier job moved it. */
export const tierJobSource = (): JournalSourceRecord =>
  JournalSourceRecord.system(JournalSystemJob.Tier);

/** A reward bought at the desk. */
export const redemptionSource = (redemptionId: string): JournalSourceRecord =>
  JournalSourceRecord.redemption(RedemptionId.of(redemptionId));

/** Points in (`delta > 0`) or out: the only effect that moves the balance. */
export const pointsEffect = (pointsDelta: number): JournalEffectRecord => ({
  journalEffect: JournalEffect.Points,
  pointsDelta,
});

/** A level earned. */
export const achievementEffect = (
  ruleId: string,
  version: number,
  awardKey: string,
): JournalEffectRecord => ({
  journalEffect: JournalEffect.Achievement,
  achievementRuleId: AchievementRuleId.of(ruleId),
  achievementRuleVersion: version,
  achievementAwardKey: awardKey,
  achievementOp: AchievementOp.Granted,
});

/** A change of tier. */
export const tierEffect = (from: string, to: string): JournalEffectRecord => ({
  journalEffect: JournalEffect.Tier,
  tierOp: TierOp.Changed,
  tierFrom: TierId.of(from),
  tierTo: TierId.of(to),
  tierUntil: null,
});

/** A coupon a rule minted (the stamp card's). */
export const rewardEffect = (couponGrantId: string): JournalEffectRecord => ({
  journalEffect: JournalEffect.Reward,
  rewardOp: RewardOp.Granted,
  ...RewardRefFields.couponGrant(CouponGrantId.of(couponGrantId)),
});

/** A reward bought with points, and the coupon it granted. */
export const redemptionEffect = (
  redemptionId: string,
  rewardId: string,
  cost: number,
  couponGrantId: string,
): JournalEffectRecord => ({
  journalEffect: JournalEffect.Redemption,
  redemptionOp: RedemptionOp.Redeemed,
  redemptionId: RedemptionId.of(redemptionId),
  redeemedRewardId: RewardId.of(rewardId),
  redemptionCost: cost,
  ...GrantRefFields.couponGrant(CouponGrantId.of(couponGrantId)),
});

/** `{customerId}_{seq:06}` — a row's id; the ids sort as the ledger does. */
export const journalRowIdOf = (
  customerId: CustomerId,
  seq: number,
): JournalEntryId => JournalEntryId.forEntry(customerId, seq);

/** One row of the journal as the fold writes it. */
export type SeedJournalRow = {
  readonly uid: string;
  readonly seq: number;
  readonly atUtcMs: number;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  /** The words the feed shows: a code and its parameters, in the order they are written. */
  readonly labelCode: LabelCode;
  readonly labelParams: Readonly<Record<string, string | number>>;
  readonly balanceAfter: number;
  /** The visit the row is about, when it is one — a seat's points; `null` for every other event. */
  readonly appointmentId: string | null;
  readonly actor: Actor;
  readonly source: JournalSourceRecord;
  readonly effect: JournalEffectRecord;
};

/**
 * `clientJournal/{customerId}_{seq:06}`: a client-visible row keyed by the
 * client RECORD, its instant and its shop day from one reading (T5), its
 * label's parameters as an ordered list, the actor, the source and the
 * effect flat at the root.
 */
export function journalEntryBody(row: SeedJournalRow): Body<JournalEntry> {
  const utcEpochMs = instant(row.atUtcMs);
  const labelParams: LabelParam[] = Object.entries(row.labelParams).map(
    ([name, value]) => ({ name, value }),
  );
  return {
    customerId: customerIdOf(row.uid),
    seq: row.seq,
    utcEpochMs,
    localDate: shopDayOf(utcEpochMs),
    reverses: null,
    correlationId: CorrelationId.of(row.correlationId),
    idempotencyKey: row.idempotencyKey,
    journalVisibility: JournalVisibility.Client,
    labelCode: row.labelCode,
    labelParams,
    balanceAfter: row.balanceAfter,
    appointmentId:
      row.appointmentId === null ? null : AppointmentId.of(row.appointmentId),
    ...row.actor,
    ...row.source,
    ...row.effect,
  } satisfies Omit<JournalEntry, 'id'>;
}
