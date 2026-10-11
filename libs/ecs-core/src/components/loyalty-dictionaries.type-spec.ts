/**
 * The loyalty group's dictionaries (flatten-spec §3.5, §3.9, §7), checked at
 * compile time — split out of `dictionaries.type-spec.ts` (§8.1):
 *
 * 1. `Holds` — each dictionary's values are exactly its type, each value
 *    under one key only;
 * 2. the L8 pair lines — every discriminator and plain tag field is named
 *    `camelCase(Dictionary)` (N15), read by
 *    `tools/lint-rules/dictionary-fields.spec.mjs`; a typed reference in
 *    another role says so with `// N15-exempt: <reason>`;
 * 3. `Screaming` — every dictionary outside the external-contract list of
 *    §0.4 holds SCREAMING_SNAKE values. Exempt and so absent from (3):
 *    `BadgeEmblem` (art asset names), `Metric`, `PerkId`, `CosmeticId`
 *    (catalogue ids), `LabelCode` (i18n keys) and `StreakRuleField` (they
 *    ARE the flat rule's field names — field locators, not codes, §3.5).
 *
 * `tsc` failing IS the test; nothing here runs.
 */
import {
  EarnedVia,
  type EarnedLevel,
  MedalState,
  type SeriesStanding,
} from './badge-level.data';
import { EngagementErrorCode, StreakRuleField } from './engagement-errors.data';
import { EnrollmentStatus } from './enrollment-status.data';
import {
  AwardKind,
  type AwardSummary,
  BadgeCategoryKind,
  BadgeEmblem,
  BadgeSubject,
  type BadgeSubjectSlot,
  Metric,
  PerkId,
  SeasonKind,
  SeasonPhase,
} from './gamification.data';
import {
  AchievementOp,
  CosmeticId,
  FreezeOp,
  type GrantRefFields,
  JournalEffect,
  type JournalEffectRecord,
  JournalVisibility,
  LabelCode,
  PauseOp,
  PauseScope,
  PauseTerm,
  RedemptionOp,
  RewardOp,
  RewardRef,
  type RewardRefFields,
  StreakOp,
  TierOp,
} from './journal-effect.data';
import {
  JournalSource,
  type JournalSourceRecord,
  JournalSystemJob,
} from './journal-source.data';
import {
  type NotificationPayload,
  NotificationTopic,
} from './notification-payload.data';
import {
  type PersonalRecord,
  PersonalRecordKind,
} from './personal-record.data';
import { PositionStatus } from './program-status.data';
import { RewardGrant, type RewardGrantRule } from './reward-grant.data';
import { RedeemProblem } from './reward-redemption.data';
import { FamilyScope, type FamilyScopeFilter } from './standing.data';
import {
  StreakInterval,
  type StreakIntervalRule,
  StreakIntervalSource,
} from './streak-interval.data';
import { StreakPublishErrorCode } from './streak-publish-errors.data';
import {
  QualifierComparison,
  StreakQualifier,
  type StreakQualifierRule,
} from './streak-qualifier.data';
import {
  HeadRole,
  type ScheduledStreakRule,
  StreakExcuse,
  type StreakHeadRule,
  StreakOnBreak,
  type StreakRule,
  StreakRuleDirection,
  StreakRuleParameter,
  StreakTransition,
} from './streak-rule.data';
import {
  FreezeReason,
  type StreakPeriodFact,
  StreakPeriodMark,
  StreakPhase,
  type StreakPhaseState,
  type StreakState,
} from './streak-state.data';
import { type TierOverride, TierOverrideSource } from './tier-state.data';
import type { BadgeCategory } from '../entities/badge-category.entity';
import type { Course } from '../entities/course.entity';
import type { JournalEntry } from '../entities/journal-entry.entity';
import type { Position } from '../entities/position.entity';
import type { Season } from '../entities/season.entity';
import type { StreakDefinitionVersion } from '../entities/streak-definition-version.entity';
import {
  DraftAssessment,
  type StreakDraftAssessment,
} from '../systems/streak-publish.system';
import {
  type StreakPreview,
  StreakPreviewOutcome,
  StreakPreviewUnavailable,
  StreakStanding,
} from '../systems/streak-preview.system';
import {
  type StreakTrackMark,
  StreakTrackMarkKind,
} from '../systems/streak.system';

type Expect<T extends true> = T;
type IsNever<T> = [T] extends [never] ? true : false;
/** Exact type equality (not mere mutual assignability). */
type Equals<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;
/** The keys of `D` whose value another key also has. */
type SharedValueKeys<D> = {
  [K in keyof D]: D[K] extends D[Exclude<keyof D, K>] ? K : never;
}[keyof D];
/** `D`'s values are exactly `T`, each value under one key only. */
type Holds<D, T> =
  Equals<D[keyof D], T> extends true ? IsNever<SharedValueKeys<D>> : false;
type Screaming<V extends string> = [V] extends [Uppercase<V>] ? true : false;

/* The variants a nullable discriminator narrows to (its `null` is the slice's own "none"). */
type SubjectChosen = Exclude<BadgeSubjectSlot, BadgeSubjectSlot.None>;
type GrantMinted = Exclude<GrantRefFields, GrantRefFields.None>;
type OverrideSet = Exclude<TierOverride, TierOverride.None>;
type StreakEffect = JournalEffectRecord.Streak;
type FreezeEffect = JournalEffectRecord.Freeze;
type AchievementEffect = JournalEffectRecord.Achievement;
type TierEffect = JournalEffectRecord.Tier;
type RewardEffect = JournalEffectRecord.Reward;
type RedemptionEffect = JournalEffectRecord.Redemption;
type PauseEffect = JournalEffectRecord.Pause;
type SystemSourceRecord = JournalSourceRecord.System;
type FrozenPhase = StreakPhaseState.Frozen;
type IntervalPeriod = StreakIntervalRule.Period;
type PreviewUnavailable = Extract<
  StreakPreview,
  { readonly streakPreviewOutcome: typeof StreakPreviewOutcome.Unavailable }
>;

// (1) Holds — exact values, one key per value.
export type LoyaltyDictionariesHold = [
  Expect<Holds<typeof EarnedVia, EarnedVia>>, // badge-level.data.ts
  Expect<Holds<typeof MedalState, MedalState>>, // badge-level.data.ts
  Expect<Holds<typeof EngagementErrorCode, EngagementErrorCode>>, // engagement-errors.data.ts
  Expect<Holds<typeof StreakRuleField, StreakRuleField>>, // engagement-errors.data.ts
  Expect<Holds<typeof EnrollmentStatus, EnrollmentStatus>>, // enrollment-status.data.ts
  Expect<Holds<typeof BadgeCategoryKind, BadgeCategoryKind>>, // gamification.data.ts
  Expect<Holds<typeof BadgeEmblem, BadgeEmblem>>, // gamification.data.ts
  Expect<Holds<typeof Metric, Metric>>, // gamification.data.ts
  Expect<Holds<typeof PerkId, PerkId>>, // gamification.data.ts
  Expect<Holds<typeof AwardKind, AwardKind>>, // gamification.data.ts
  Expect<Holds<typeof BadgeSubject, BadgeSubject>>, // gamification.data.ts
  Expect<Holds<typeof SeasonKind, SeasonKind>>, // gamification.data.ts
  Expect<Holds<typeof SeasonPhase, SeasonPhase>>, // gamification.data.ts
  Expect<Holds<typeof JournalEffect, JournalEffect>>, // journal-effect.data.ts
  Expect<Holds<typeof StreakOp, StreakOp>>, // journal-effect.data.ts
  Expect<Holds<typeof FreezeOp, FreezeOp>>, // journal-effect.data.ts
  Expect<Holds<typeof AchievementOp, AchievementOp>>, // journal-effect.data.ts
  Expect<Holds<typeof TierOp, TierOp>>, // journal-effect.data.ts
  Expect<Holds<typeof RewardOp, RewardOp>>, // journal-effect.data.ts
  Expect<Holds<typeof RedemptionOp, RedemptionOp>>, // journal-effect.data.ts
  Expect<Holds<typeof PauseOp, PauseOp>>, // journal-effect.data.ts
  Expect<Holds<typeof RewardRef, RewardRef>>, // journal-effect.data.ts
  Expect<Holds<typeof CosmeticId, CosmeticId>>, // journal-effect.data.ts
  Expect<Holds<typeof PauseTerm, PauseTerm>>, // journal-effect.data.ts
  Expect<Holds<typeof PauseScope, PauseScope>>, // journal-effect.data.ts
  Expect<Holds<typeof JournalVisibility, JournalVisibility>>, // journal-effect.data.ts
  Expect<Holds<typeof LabelCode, LabelCode>>, // journal-effect.data.ts
  Expect<Holds<typeof JournalSource, JournalSource>>, // journal-source.data.ts
  Expect<Holds<typeof JournalSystemJob, JournalSystemJob>>, // journal-source.data.ts
  Expect<Holds<typeof NotificationTopic, NotificationTopic>>, // notification-payload.data.ts
  Expect<Holds<typeof PersonalRecordKind, PersonalRecordKind>>, // personal-record.data.ts
  Expect<Holds<typeof PositionStatus, PositionStatus>>, // program-status.data.ts
  Expect<Holds<typeof RewardGrant, RewardGrant>>, // reward-grant.data.ts
  Expect<Holds<typeof RedeemProblem, RedeemProblem>>, // reward-redemption.data.ts
  Expect<Holds<typeof FamilyScope, FamilyScope>>, // standing.data.ts
  Expect<Holds<typeof StreakInterval, StreakInterval>>, // streak-interval.data.ts
  Expect<Holds<typeof StreakIntervalSource, StreakIntervalSource>>, // streak-interval.data.ts
  Expect<Holds<typeof StreakPublishErrorCode, StreakPublishErrorCode>>, // streak-publish-errors.data.ts
  Expect<Holds<typeof StreakQualifier, StreakQualifier>>, // streak-qualifier.data.ts
  Expect<Holds<typeof QualifierComparison, QualifierComparison>>, // streak-qualifier.data.ts
  Expect<Holds<typeof StreakExcuse, StreakExcuse>>, // streak-rule.data.ts
  Expect<Holds<typeof StreakOnBreak, StreakOnBreak>>, // streak-rule.data.ts
  Expect<Holds<typeof StreakTransition, StreakTransition>>, // streak-rule.data.ts
  Expect<Holds<typeof StreakRuleDirection, StreakRuleDirection>>, // streak-rule.data.ts
  Expect<Holds<typeof StreakRuleParameter, StreakRuleParameter>>, // streak-rule.data.ts
  Expect<Holds<typeof HeadRole, HeadRole>>, // streak-rule.data.ts
  Expect<Holds<typeof StreakPhase, StreakPhase>>, // streak-state.data.ts
  Expect<Holds<typeof FreezeReason, FreezeReason>>, // streak-state.data.ts
  Expect<Holds<typeof StreakPeriodMark, StreakPeriodMark>>, // streak-state.data.ts
  Expect<Holds<typeof TierOverrideSource, TierOverrideSource>>, // tier-state.data.ts
  Expect<Holds<typeof DraftAssessment, DraftAssessment>>, // streak-publish.system.ts
  Expect<Holds<typeof StreakStanding, StreakStanding>>, // streak-preview.system.ts
  Expect<Holds<typeof StreakPreviewOutcome, StreakPreviewOutcome>>, // streak-preview.system.ts
  Expect<Holds<typeof StreakPreviewUnavailable, StreakPreviewUnavailable>>, // streak-preview.system.ts
  Expect<Holds<typeof StreakTrackMarkKind, StreakTrackMarkKind>>, // streak.system.ts
];

// (2) The L8 pair lines — a discriminator or plain tag field is camelCase(Dictionary).
export type LoyaltyDictionaryFields = [
  Expect<Equals<EarnedLevel['earnedVia'], EarnedVia>>, // badge-level.data.ts
  Expect<Equals<SeriesStanding['medalState'], MedalState>>, // badge-level.data.ts
  Expect<Equals<Course['enrollmentStatus'], EnrollmentStatus>>, // course.entity.ts
  Expect<Equals<BadgeCategory['badgeCategoryKind'], BadgeCategoryKind>>, // badge-category.entity.ts
  Expect<Equals<AwardSummary['awardKind'], AwardKind>>, // gamification.data.ts
  Expect<Equals<SubjectChosen['badgeSubject'], BadgeSubject>>, // gamification.data.ts
  Expect<Equals<Season['seasonKind'], SeasonKind>>, // season.entity.ts
  Expect<Equals<JournalEffectRecord['journalEffect'], JournalEffect>>, // journal-effect.data.ts
  Expect<Equals<StreakEffect['streakOp'], StreakOp>>, // journal-effect.data.ts
  Expect<Equals<FreezeEffect['freezeOp'], FreezeOp>>, // journal-effect.data.ts
  Expect<Equals<AchievementEffect['achievementOp'], AchievementOp>>, // journal-effect.data.ts
  Expect<Equals<TierEffect['tierOp'], TierOp>>, // journal-effect.data.ts
  Expect<Equals<RewardEffect['rewardOp'], RewardOp>>, // journal-effect.data.ts
  Expect<Equals<RedemptionEffect['redemptionOp'], RedemptionOp>>, // journal-effect.data.ts
  Expect<Equals<PauseEffect['pauseOp'], PauseOp>>, // journal-effect.data.ts
  Expect<Equals<RewardRefFields['rewardRef'], RewardRef>>, // journal-effect.data.ts
  Expect<Equals<GrantMinted['grantRef'], RewardRef>>, // N15-exempt: a slice-prefixed reference in another role (what a redemption minted, flatten-spec §3.5)
  Expect<Equals<PauseEffect['pauseTerm'], PauseTerm>>, // journal-effect.data.ts
  Expect<Equals<PauseEffect['pauseScope'], PauseScope>>, // journal-effect.data.ts
  Expect<Equals<JournalEntry['journalVisibility'], JournalVisibility>>, // journal-entry.entity.ts
  Expect<Equals<JournalEntry['labelCode'], LabelCode>>, // journal-entry.entity.ts
  Expect<Equals<JournalSourceRecord['journalSource'], JournalSource>>, // journal-source.data.ts
  Expect<Equals<SystemSourceRecord['sourceSystemJob'], JournalSystemJob>>, // N15-exempt: a slice-prefixed reference (flatten-spec §3.5 names it)
  Expect<Equals<NotificationPayload['notificationTopic'], NotificationTopic>>, // notification-payload.data.ts
  Expect<Equals<PersonalRecord['personalRecordKind'], PersonalRecordKind>>, // personal-record.data.ts
  Expect<Equals<Position['positionStatus'], PositionStatus>>, // position.entity.ts
  Expect<Equals<RewardGrantRule['rewardGrant'], RewardGrant>>, // reward-grant.data.ts
  Expect<Equals<FamilyScopeFilter['familyScope'], FamilyScope>>, // standing.data.ts
  Expect<Equals<StreakIntervalRule['streakInterval'], StreakInterval>>, // streak-interval.data.ts
  Expect<Equals<IntervalPeriod['source'], StreakIntervalSource>>, // N15-exempt: the system value `Period { days; source }` flatten-spec §3.5 keeps unchanged
  Expect<Equals<StreakQualifierRule['streakQualifier'], StreakQualifier>>, // streak-qualifier.data.ts
  Expect<Equals<StreakRule['onBreak'], StreakOnBreak>>, // N15-exempt: a rule-option field of the flat StreakRule (N15 names it)
  Expect<Equals<ScheduledStreakRule['streakTransition'], StreakTransition>>, // streak-rule.data.ts
  Expect<Equals<StreakHeadRule['headRole'], HeadRole>>, // streak-rule.data.ts
  Expect<
    Equals<StreakDefinitionVersion['streakRuleDirection'], StreakRuleDirection>
  >, // streak-definition-version.entity.ts
  Expect<Equals<StreakState['streakPhase'], StreakPhase>>, // streak-state.data.ts
  Expect<Equals<FrozenPhase['phaseFreezeReason'], FreezeReason>>, // N15-exempt: a slice-prefixed reference (N15 names `phaseFreezeReason`)
  Expect<Equals<StreakPeriodFact['streakPeriodMark'], StreakPeriodMark>>, // streak-state.data.ts
  Expect<Equals<OverrideSet['tierOverrideSource'], TierOverrideSource>>, // tier-state.data.ts
  Expect<Equals<StreakDraftAssessment['draftAssessment'], DraftAssessment>>, // streak-publish.system.ts
  Expect<Equals<StreakPreview['streakPreviewOutcome'], StreakPreviewOutcome>>, // streak-preview.system.ts
  Expect<Equals<PreviewUnavailable['reason'], StreakPreviewUnavailable>>, // N15-exempt: the unavailable answer's reason, a system value flatten-spec §3.9 keeps
  Expect<Equals<StreakTrackMark['streakTrackMarkKind'], StreakTrackMarkKind>>, // streak.system.ts
];

// (3) Screaming — the tag dictionaries outside §0.4's external contracts.
export type LoyaltyDictionariesScream = [
  Expect<Screaming<EarnedVia>>,
  Expect<Screaming<MedalState>>,
  Expect<Screaming<EngagementErrorCode>>,
  Expect<Screaming<EnrollmentStatus>>,
  Expect<Screaming<BadgeCategoryKind>>,
  Expect<Screaming<AwardKind>>,
  Expect<Screaming<BadgeSubject>>,
  Expect<Screaming<SeasonKind>>,
  Expect<Screaming<SeasonPhase>>,
  Expect<Screaming<JournalEffect>>,
  Expect<Screaming<StreakOp>>,
  Expect<Screaming<FreezeOp>>,
  Expect<Screaming<AchievementOp>>,
  Expect<Screaming<TierOp>>,
  Expect<Screaming<RewardOp>>,
  Expect<Screaming<RedemptionOp>>,
  Expect<Screaming<PauseOp>>,
  Expect<Screaming<RewardRef>>,
  Expect<Screaming<PauseTerm>>,
  Expect<Screaming<PauseScope>>,
  Expect<Screaming<JournalVisibility>>,
  Expect<Screaming<JournalSource>>,
  Expect<Screaming<JournalSystemJob>>,
  Expect<Screaming<NotificationTopic>>,
  Expect<Screaming<PersonalRecordKind>>,
  Expect<Screaming<PositionStatus>>,
  Expect<Screaming<RewardGrant>>,
  Expect<Screaming<RedeemProblem>>,
  Expect<Screaming<FamilyScope>>,
  Expect<Screaming<StreakInterval>>,
  Expect<Screaming<StreakIntervalSource>>,
  Expect<Screaming<StreakPublishErrorCode>>,
  Expect<Screaming<StreakQualifier>>,
  Expect<Screaming<QualifierComparison>>,
  Expect<Screaming<StreakExcuse>>,
  Expect<Screaming<StreakOnBreak>>,
  Expect<Screaming<StreakTransition>>,
  Expect<Screaming<StreakRuleDirection>>,
  Expect<Screaming<StreakRuleParameter>>,
  Expect<Screaming<HeadRole>>,
  Expect<Screaming<StreakPhase>>,
  Expect<Screaming<FreezeReason>>,
  Expect<Screaming<StreakPeriodMark>>,
  Expect<Screaming<TierOverrideSource>>,
  Expect<Screaming<DraftAssessment>>,
  Expect<Screaming<StreakStanding>>,
  Expect<Screaming<StreakPreviewOutcome>>,
  Expect<Screaming<StreakPreviewUnavailable>>,
  Expect<Screaming<StreakTrackMarkKind>>,
];
