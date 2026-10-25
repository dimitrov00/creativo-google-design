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
import { type AwardSummary, PerkId } from './award-summary.data';
import { BadgeSubject, type BadgeSubjectSlot } from './badge-subject-slot.data';
import { DraftAssessment } from './draft-assessment.data';
import { EarnedVia, type EarnedLevel } from './earned-level.data';
import { AwardKind } from '@core/primitives';
import {
  EngagementErrorCode,
  StreakRuleField,
  StreakPublishErrorCode,
} from '@core/errors';
import { EnrollmentStatus } from './enrollment-status.data';
import {
  FamilyScope,
  type FamilyScopeFilter,
} from './family-scope-filter.data';
import { BadgeCategoryKind } from './badge-category-kind.data';
import { BadgeEmblem } from './badge-emblem.data';
import { SeasonKind } from './season-kind.data';
import { SeasonPhase } from './season-phase.data';
import { type GrantRefFields } from './grant-ref-fields.data';
import {
  AchievementOp,
  FreezeOp,
  JournalEffect,
  type JournalEffectRecord,
  PauseOp,
  PauseScope,
  PauseTerm,
  RedemptionOp,
  RewardOp,
  StreakOp,
  TierOp,
} from './journal-effect.data';
import { JournalVisibility } from './journal-visibility.data';
import {
  JournalSource,
  type JournalSourceRecord,
  JournalSystemJob,
} from './journal-source.data';
import { Metric } from './metric-ref.data';
import {
  type NotificationPayload,
  NotificationTopic,
} from './notification-payload.data';
import {
  type PersonalRecord,
  PersonalRecordKind,
} from './personal-record.data';
import { PositionStatus } from './program-status.data';
import { LabelCode } from './public-label.data';
import { QualifierComparison } from './qualifier-comparison.data';
import { RewardGrant, type RewardGrantRule } from './reward-grant.data';
import {
  CosmeticId,
  RewardRef,
  type RewardRefFields,
} from './reward-ref-fields.data';
import { RedeemProblem } from './redeem-problem.data';
import { type ScheduledStreakRule } from './scheduled-streak-rule.data';
import { MedalState, type SeriesStanding } from './series-standing.data';
import { HeadRole, type StreakHeadRule } from './streak-head-rule.data';
import {
  StreakInterval,
  type StreakIntervalRule,
} from './streak-interval.data';
import { StreakIntervalSource } from './streak-interval-source.data';
import {
  type StreakPeriodFact,
  StreakPeriodMark,
} from './streak-period-fact.data';
import {
  FreezeReason,
  StreakPhase,
  type StreakPhaseState,
} from './streak-phase-state.data';
import { type StreakPreview } from './streak-preview.data';
import { StreakPreviewOutcome } from './streak-preview-outcome.data';
import { StreakPreviewUnavailable } from './streak-preview-unavailable.data';
import {
  StreakQualifier,
  type StreakQualifierRule,
} from './streak-qualifier.data';
import { StreakPublishConsent } from './streak-publish-consent.data';
import { StreakRuleDirection } from './streak-rule-direction.data';
import { StreakRuleParameter } from './streak-rule-parameter.data';
import {
  StreakExcuse,
  StreakOnBreak,
  type StreakRule,
} from './streak-rule.data';
import { StreakTransition } from './streak-transition.data';
import { StreakStanding } from './streak-standing.data';
import { type StreakState } from './streak-state.data';
import {
  type StreakTrackMark,
  StreakTrackMarkKind,
} from './streak-track-mark.data';
import { type TierOverride, TierOverrideSource } from './tier-override.data';
import type {
  BadgeCategory,
  Course,
  JournalEntry,
  Position,
  Season,
  StreakDefinitionVersion,
} from '@core/entities';
import type { StreakDraftAssessment } from '@core/systems';

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
  Expect<Holds<typeof EarnedVia, EarnedVia>>, // earned-level.data.ts
  Expect<Holds<typeof MedalState, MedalState>>, // series-standing.data.ts
  Expect<Holds<typeof EngagementErrorCode, EngagementErrorCode>>, // engagement.error.ts
  Expect<Holds<typeof StreakRuleField, StreakRuleField>>, // engagement.error.ts
  Expect<Holds<typeof EnrollmentStatus, EnrollmentStatus>>, // enrollment-status.data.ts
  Expect<Holds<typeof BadgeCategoryKind, BadgeCategoryKind>>, // badge-category-kind.data.ts
  Expect<Holds<typeof BadgeEmblem, BadgeEmblem>>, // badge-emblem.data.ts
  Expect<Holds<typeof Metric, Metric>>, // metric-ref.data.ts
  Expect<Holds<typeof PerkId, PerkId>>, // award-summary.data.ts
  Expect<Holds<typeof AwardKind, AwardKind>>, // primitives/award-kind.data.ts
  Expect<Holds<typeof BadgeSubject, BadgeSubject>>, // badge-subject-slot.data.ts
  Expect<Holds<typeof SeasonKind, SeasonKind>>, // season-kind.data.ts
  Expect<Holds<typeof SeasonPhase, SeasonPhase>>, // season-phase.data.ts
  Expect<Holds<typeof JournalEffect, JournalEffect>>, // journal-effect.data.ts
  Expect<Holds<typeof StreakOp, StreakOp>>, // journal-effect.data.ts
  Expect<Holds<typeof FreezeOp, FreezeOp>>, // journal-effect.data.ts
  Expect<Holds<typeof AchievementOp, AchievementOp>>, // journal-effect.data.ts
  Expect<Holds<typeof TierOp, TierOp>>, // journal-effect.data.ts
  Expect<Holds<typeof RewardOp, RewardOp>>, // journal-effect.data.ts
  Expect<Holds<typeof RedemptionOp, RedemptionOp>>, // journal-effect.data.ts
  Expect<Holds<typeof PauseOp, PauseOp>>, // journal-effect.data.ts
  Expect<Holds<typeof RewardRef, RewardRef>>, // reward-ref-fields.data.ts
  Expect<Holds<typeof CosmeticId, CosmeticId>>, // reward-ref-fields.data.ts
  Expect<Holds<typeof PauseTerm, PauseTerm>>, // journal-effect.data.ts
  Expect<Holds<typeof PauseScope, PauseScope>>, // journal-effect.data.ts
  Expect<Holds<typeof JournalVisibility, JournalVisibility>>, // journal-visibility.data.ts
  Expect<Holds<typeof LabelCode, LabelCode>>, // public-label.data.ts
  Expect<Holds<typeof JournalSource, JournalSource>>, // journal-source.data.ts
  Expect<Holds<typeof JournalSystemJob, JournalSystemJob>>, // journal-source.data.ts
  Expect<Holds<typeof NotificationTopic, NotificationTopic>>, // notification-payload.data.ts
  Expect<Holds<typeof PersonalRecordKind, PersonalRecordKind>>, // personal-record.data.ts
  Expect<Holds<typeof PositionStatus, PositionStatus>>, // program-status.data.ts
  Expect<Holds<typeof RewardGrant, RewardGrant>>, // reward-grant.data.ts
  Expect<Holds<typeof RedeemProblem, RedeemProblem>>, // redeem-problem.data.ts
  Expect<Holds<typeof FamilyScope, FamilyScope>>, // family-scope-filter.data.ts
  Expect<Holds<typeof StreakInterval, StreakInterval>>, // streak-interval.data.ts
  Expect<Holds<typeof StreakIntervalSource, StreakIntervalSource>>, // streak-interval-source.data.ts
  Expect<Holds<typeof StreakPublishErrorCode, StreakPublishErrorCode>>, // streak-publish.error.ts
  Expect<Holds<typeof StreakQualifier, StreakQualifier>>, // streak-qualifier.data.ts
  Expect<Holds<typeof QualifierComparison, QualifierComparison>>, // qualifier-comparison.data.ts
  Expect<Holds<typeof StreakExcuse, StreakExcuse>>, // streak-rule.data.ts
  Expect<Holds<typeof StreakOnBreak, StreakOnBreak>>, // streak-rule.data.ts
  Expect<Holds<typeof StreakTransition, StreakTransition>>, // streak-transition.data.ts
  Expect<Holds<typeof StreakRuleDirection, StreakRuleDirection>>, // streak-rule-direction.data.ts
  Expect<Holds<typeof StreakRuleParameter, StreakRuleParameter>>, // streak-rule-parameter.data.ts
  Expect<Holds<typeof HeadRole, HeadRole>>, // streak-head-rule.data.ts
  Expect<Holds<typeof StreakPublishConsent, StreakPublishConsent>>, // streak-publish-consent.data.ts
  Expect<Holds<typeof StreakPhase, StreakPhase>>, // streak-phase-state.data.ts
  Expect<Holds<typeof FreezeReason, FreezeReason>>, // streak-phase-state.data.ts
  Expect<Holds<typeof StreakPeriodMark, StreakPeriodMark>>, // streak-period-fact.data.ts
  Expect<Holds<typeof TierOverrideSource, TierOverrideSource>>, // tier-override.data.ts
  Expect<Holds<typeof DraftAssessment, DraftAssessment>>, // draft-assessment.data.ts
  Expect<Holds<typeof StreakStanding, StreakStanding>>, // streak-standing.data.ts
  Expect<Holds<typeof StreakPreviewOutcome, StreakPreviewOutcome>>, // streak-preview-outcome.data.ts
  Expect<Holds<typeof StreakPreviewUnavailable, StreakPreviewUnavailable>>, // streak-preview-unavailable.data.ts
  Expect<Holds<typeof StreakTrackMarkKind, StreakTrackMarkKind>>, // streak-track-mark.data.ts
];

// (2) The L8 pair lines — a discriminator or plain tag field is camelCase(Dictionary).
export type LoyaltyDictionaryFields = [
  Expect<Equals<EarnedLevel['earnedVia'], EarnedVia>>, // earned-level.data.ts
  Expect<Equals<SeriesStanding['medalState'], MedalState>>, // series-standing.data.ts
  Expect<Equals<Course['enrollmentStatus'], EnrollmentStatus>>, // course.entity.ts
  Expect<Equals<BadgeCategory['badgeCategoryKind'], BadgeCategoryKind>>, // badge-category.entity.ts
  Expect<Equals<AwardSummary['awardKind'], AwardKind>>, // award-summary.data.ts
  Expect<Equals<SubjectChosen['badgeSubject'], BadgeSubject>>, // badge-subject-slot.data.ts
  Expect<Equals<Season['seasonKind'], SeasonKind>>, // season.entity.ts
  Expect<Equals<JournalEffectRecord['journalEffect'], JournalEffect>>, // journal-effect.data.ts
  Expect<Equals<StreakEffect['streakOp'], StreakOp>>, // journal-effect.data.ts
  Expect<Equals<FreezeEffect['freezeOp'], FreezeOp>>, // journal-effect.data.ts
  Expect<Equals<AchievementEffect['achievementOp'], AchievementOp>>, // journal-effect.data.ts
  Expect<Equals<TierEffect['tierOp'], TierOp>>, // journal-effect.data.ts
  Expect<Equals<RewardEffect['rewardOp'], RewardOp>>, // journal-effect.data.ts
  Expect<Equals<RedemptionEffect['redemptionOp'], RedemptionOp>>, // journal-effect.data.ts
  Expect<Equals<PauseEffect['pauseOp'], PauseOp>>, // journal-effect.data.ts
  Expect<Equals<RewardRefFields['rewardRef'], RewardRef>>, // reward-ref-fields.data.ts
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
  Expect<Equals<FamilyScopeFilter['familyScope'], FamilyScope>>, // family-scope-filter.data.ts
  Expect<Equals<StreakIntervalRule['streakInterval'], StreakInterval>>, // streak-interval.data.ts
  Expect<Equals<IntervalPeriod['source'], StreakIntervalSource>>, // N15-exempt: the system value `Period { days; source }` flatten-spec §3.5 keeps unchanged
  Expect<Equals<StreakQualifierRule['streakQualifier'], StreakQualifier>>, // streak-qualifier.data.ts
  Expect<Equals<StreakRule['onBreak'], StreakOnBreak>>, // N15-exempt: a rule-option field of the flat StreakRule (N15 names it)
  Expect<Equals<ScheduledStreakRule['streakTransition'], StreakTransition>>, // scheduled-streak-rule.data.ts
  Expect<Equals<StreakHeadRule['headRole'], HeadRole>>, // streak-head-rule.data.ts
  Expect<
    Equals<StreakDefinitionVersion['streakRuleDirection'], StreakRuleDirection>
  >, // streak-definition-version.entity.ts
  Expect<Equals<StreakState['streakPhase'], StreakPhase>>, // streak-state.data.ts (the phase slice, streak-phase-state.data.ts)
  Expect<Equals<FrozenPhase['phaseFreezeReason'], FreezeReason>>, // N15-exempt: a slice-prefixed reference (N15 names `phaseFreezeReason`)
  Expect<Equals<StreakPeriodFact['streakPeriodMark'], StreakPeriodMark>>, // streak-period-fact.data.ts
  Expect<Equals<OverrideSet['tierOverrideSource'], TierOverrideSource>>, // tier-override.data.ts
  Expect<Equals<StreakDraftAssessment['draftAssessment'], DraftAssessment>>, // streak-publish.system.ts (system I/O; the dictionary is draft-assessment.data.ts)
  Expect<Equals<StreakPreview['streakPreviewOutcome'], StreakPreviewOutcome>>, // streak-preview.data.ts
  Expect<Equals<PreviewUnavailable['reason'], StreakPreviewUnavailable>>, // N15-exempt: the unavailable answer's reason, a system value flatten-spec §3.9 keeps
  Expect<Equals<StreakTrackMark['streakTrackMarkKind'], StreakTrackMarkKind>>, // streak-track-mark.data.ts
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
  Expect<Screaming<StreakPublishConsent>>,
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
