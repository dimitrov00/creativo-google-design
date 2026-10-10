/**
 * Compile-time-only checks of every `as const` tag dictionary in ecs-core —
 * no runtime `expect()`/`it()`; `nx typecheck` runs it through
 * `tsconfig.spec.json` (`src/**\/*.type-spec.ts`), like the brand spec
 * (`entities/ids.type-spec.ts`). Covers 140 dictionaries and 47 kind-unions,
 * checked against the declarations when this file was written; a new
 * dictionary or union gets its line here (blueprint §7: "one added … per
 * `as const` dictionary (`satisfies` checks)").
 *
 * 1. **`satisfies`** — each dictionary's values are of its type (for a
 *    companion that spreads a private dictionary, each tag member is).
 * 2. **Holds** — the type is EXACTLY the dictionary's values (no hand-written
 *    second source that drifted), and no two keys share a value (two names,
 *    one stored string, is a bug).
 * 3. **Kind coverage** — each discriminated union's `kind` is exactly its
 *    tag dictionary: every tag has a variant and every variant's tag is in
 *    the dictionary.
 */
import {
  AccountState,
  AccountStatus,
  BlockReason,
} from './account-status.data';
import { AccountsErrorCode } from './accounts-errors.data';
import { Actor, ActorKind, SystemSource } from './actor.data';
import { AppliedDiscountSource } from './applied-discount.data';
import {
  AuditAction,
  AuditContext,
  BackfillOutcome,
} from './audit-context.data';
import { AuthStage } from './auth-claims.data';
import {
  AuthFlowEvent,
  AuthFlowEventKind,
  AuthFlowState,
  AuthFlowStep,
} from './auth-flow.data';
import {
  AuthProvider,
  AuthProviderKind,
  AuthStrategy,
  AuthStrategyKind,
  OAuthProvider,
} from './auth-strategy.data';
import { EarnedVia, MedalState } from './badge-level.data';
import { BarberPref, BarberPrefKind } from './barber-pref.data';
import { BookingFlowErrorCode } from './booking-flow-errors.data';
import {
  BookingFlowState,
  BookingFlowStep,
  MoveRefusalKind,
  ShopReach,
} from './booking-flow.data';
import { BookingState, BookingStatus } from './booking-status.data';
import { SeatKey, SeatKeyKind } from './cart-line.data';
import {
  CatalogErrorCode,
  GeoAxis,
  MediaDimension,
} from './catalog-errors.data';
import {
  BarberState,
  LocationState,
  ServiceState,
} from './catalog-status.data';
import {
  CouponCombinability,
  CouponCombinabilityKind,
} from './coupon-combinability.data';
import { CouponExpiry, CouponExpiryKind } from './coupon-expiry.data';
import { CouponOccasion, CouponStatus } from './coupon-occasion.data';
import { CouponValue, CouponValueKind } from './coupon-value.data';
import { Daypart } from './daypart.data';
import { EngagementErrorCode, StreakRuleField } from './engagement-errors.data';
import { EnrollmentStatus } from './enrollment-status.data';
import { ExceptionEffect, ExceptionEffectKind } from './exception-effect.data';
import { FlagName } from './feature-flags.data';
import {
  AwardKind,
  AwardSummary,
  BadgeCategoryKind,
  BadgeEmblem,
  BadgeSubject,
  BadgeSubjectKind,
  Metric,
  PerkId,
  SeasonKind,
  SeasonPhase,
} from './gamification.data';
import { GovernanceErrorCode } from './governance-errors.data';
import {
  CouponGrantCapacity,
  CouponGrantExpiration,
  GrantCapacityKind,
  GrantExpirationKind,
  GrantState,
  GrantStatus,
} from './grant-status.data';
import { IdentifierKind, ParsedIdentifier } from './identifier.data';
import { AuthPolicyField, IdentityErrorCode } from './identity-errors.data';
import { ImpersonationScope } from './impersonation-scope.data';
import {
  ImpersonationEndReason,
  ImpersonationEndReasonKind,
  ImpersonationState,
  ImpersonationStatus,
} from './impersonation-status.data';
import { JournalActor } from './journal-actor.data';
import {
  AchievementEffectOp,
  CosmeticId,
  FreezeEffectOp,
  JournalEffect,
  JournalEffectKind,
  JournalVisibility,
  LabelCode,
  PauseEffectOp,
  PauseScope,
  PauseTerm,
  PauseTermKind,
  RedemptionEffectOp,
  RewardEffectOp,
  RewardRef,
  RewardRefKind,
  StreakEffectOp,
  TierEffectOp,
} from './journal-effect.data';
import {
  JournalSource,
  JournalSourceKind,
  JournalSystemJob,
} from './journal-source.data';
import { Locale } from './locale.data';
import { MediaErrorCode } from './media-errors.data';
import { BlockKind } from './minute-block.data';
import { MoneyErrorCode } from './money-errors.data';
import { Currency, RoundingMode } from './money.data';
import {
  NotificationKind,
  NotificationPayload,
} from './notification-payload.data';
import {
  OnboardingFlowEvent,
  OnboardingFlowEventKind,
  OnboardingFlowState,
  OnboardingFlowStep,
} from './onboarding-flow.data';
import { ClockDayHours, DayHours, DayHoursKind } from './opening-hours.data';
import { OtpDestinationType } from './otp-destination-type.data';
import { OtpPurpose } from './otp-purpose.data';
import { PartyMember, PartyMemberKind } from './party.data';
import { PersonalRecordKind } from './personal-record.data';
import { PhoneErrorCode, PhoneInvalidReason } from './phone-errors.data';
import { PhotoOrigin } from './photo-origin.data';
import { PipelineErrorCode } from './pipeline-errors.data';
import { PlacementKind } from './placement-kind.data';
import { Principal, PrincipalKind } from './principal.data';
import { PositionState } from './program-status.data';
import {
  Frequency,
  MonthlyDayKind,
  RecurrenceEndKind,
  WeekOfMonth,
} from './recurrence-rule.data';
import {
  Registration,
  RegistrationField,
  RegistrationState,
} from './registration.data';
import { RepositoryErrorCode } from './repository-errors.data';
import { RewardGrant, RewardGrantKind } from './reward-grant.data';
import { Role } from './role.data';
import { SchedulingErrorCode } from './scheduling-errors.data';
import {
  CancellationReason,
  CancelledBy,
  SeatOutcome,
  SeatOutcomeKind,
} from './seat-outcome.data';
import { SeatRelationship, SeatSubject, SeatSubjectKind } from './seat.data';
import {
  ServiceComposition,
  ServiceCompositionKind,
} from './service-composition.data';
import { SessionKind } from './session-kind.data';
import { FamilyScope, FamilyScopeKind } from './standing.data';
import {
  StreakInterval,
  StreakIntervalKind,
  StreakIntervalSource,
} from './streak-interval.data';
import {
  QualifierComparison,
  StreakQualifier,
  StreakQualifierKind,
} from './streak-qualifier.data';
import {
  StreakExcuse,
  StreakOnBreak,
  StreakRuleDirection,
  StreakRuleParameter,
  StreakTransition,
} from './streak-rule.data';
import {
  FreezeReason,
  StreakPeriodMark,
  StreakPhase,
  StreakPhaseKind,
} from './streak-state.data';
import { TierOverrideSource, TierOverrideSourceKind } from './tier-state.data';
import { DateTimeInvalidReason, TimeErrorCode } from './time-errors.data';
import {
  VoucherRefusal,
  VoucherState,
  VoucherStateKind,
} from './voucher-state.data';
import { WaitlistState } from './waitlist-status.data';
import { Weekday } from './weekday.data';
import { WriteKind, WriteOp } from './write-op.data';
import { BackfillJobKind } from '../entities/backfill-job.entity';
import { PolicyRecomputeJobKind } from '../entities/policy-recompute-job.entity';
import {
  CollectionName,
  Collections,
  RetiredCollectionName,
  RetiredCollections,
  RetiredSubcollectionName,
  RetiredSubcollections,
  SubcollectionName,
  Subcollections,
} from '../ports/collections';
import { DstResolution } from '../systems/zoned-time.system';

/** A tag dictionary whose every value is a `T`. */
type Dictionary<T> = { readonly [key: string]: T };
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

/** The value-level `satisfies` runs at compile time only; nothing is called. */
declare function dictionary(checked: unknown): void;

// (1) satisfies — every dictionary's values are of its type.
dictionary(AccountState satisfies Dictionary<AccountState>);
dictionary(BlockReason satisfies Dictionary<BlockReason>);
dictionary(AccountsErrorCode satisfies Dictionary<AccountsErrorCode>);
dictionary(ActorKind satisfies Dictionary<ActorKind>);
dictionary(SystemSource satisfies Dictionary<SystemSource>);
dictionary(AppliedDiscountSource satisfies Dictionary<AppliedDiscountSource>);
dictionary(AuditAction satisfies Dictionary<AuditAction>);
dictionary(BackfillOutcome satisfies Dictionary<BackfillOutcome>);
dictionary(AuthStage satisfies Dictionary<AuthStage>);
dictionary(AuthFlowStep satisfies Dictionary<AuthFlowStep>);
dictionary(AuthFlowEventKind satisfies Dictionary<AuthFlowEventKind>);
dictionary(AuthStrategyKind satisfies Dictionary<AuthStrategyKind>);
dictionary(AuthProviderKind satisfies Dictionary<AuthProviderKind>);
dictionary(OAuthProvider satisfies Dictionary<OAuthProvider>);
dictionary(EarnedVia satisfies Dictionary<EarnedVia>);
dictionary(MedalState satisfies Dictionary<MedalState>);
dictionary(BarberPrefKind satisfies Dictionary<BarberPrefKind>);
dictionary(BookingFlowErrorCode satisfies Dictionary<BookingFlowErrorCode>);
dictionary(BookingFlowStep satisfies Dictionary<BookingFlowStep>);
dictionary(MoveRefusalKind satisfies Dictionary<MoveRefusalKind>);
dictionary(ShopReach satisfies Readonly<Record<'Call' | 'Contact', ShopReach>>);
dictionary(BookingState satisfies Dictionary<BookingState>);
dictionary(SeatKeyKind satisfies Dictionary<SeatKeyKind>);
dictionary(CatalogErrorCode satisfies Dictionary<CatalogErrorCode>);
dictionary(MediaDimension satisfies Dictionary<MediaDimension>);
dictionary(GeoAxis satisfies Dictionary<GeoAxis>);
dictionary(ServiceState satisfies Dictionary<ServiceState>);
dictionary(BarberState satisfies Dictionary<BarberState>);
dictionary(LocationState satisfies Dictionary<LocationState>);
dictionary(
  CouponCombinabilityKind satisfies Dictionary<CouponCombinabilityKind>,
);
dictionary(CouponExpiryKind satisfies Dictionary<CouponExpiryKind>);
dictionary(CouponOccasion satisfies Dictionary<CouponOccasion>);
dictionary(CouponStatus satisfies Dictionary<CouponStatus>);
dictionary(CouponValueKind satisfies Dictionary<CouponValueKind>);
dictionary(
  Daypart satisfies Readonly<
    Record<'Morning' | 'Afternoon' | 'Evening', Daypart>
  >,
);
dictionary(StreakRuleField satisfies Dictionary<StreakRuleField>);
dictionary(EngagementErrorCode satisfies Dictionary<EngagementErrorCode>);
dictionary(EnrollmentStatus satisfies Dictionary<EnrollmentStatus>);
dictionary(ExceptionEffectKind satisfies Dictionary<ExceptionEffectKind>);
dictionary(FlagName satisfies Dictionary<FlagName>);
dictionary(BadgeCategoryKind satisfies Dictionary<BadgeCategoryKind>);
dictionary(BadgeEmblem satisfies Dictionary<BadgeEmblem>);
dictionary(Metric satisfies Dictionary<Metric>);
dictionary(PerkId satisfies Dictionary<PerkId>);
dictionary(AwardKind satisfies Dictionary<AwardKind>);
dictionary(BadgeSubjectKind satisfies Dictionary<BadgeSubjectKind>);
dictionary(SeasonKind satisfies Dictionary<SeasonKind>);
dictionary(SeasonPhase satisfies Dictionary<SeasonPhase>);
dictionary(GovernanceErrorCode satisfies Dictionary<GovernanceErrorCode>);
dictionary(GrantState satisfies Dictionary<GrantState>);
dictionary(GrantCapacityKind satisfies Dictionary<GrantCapacityKind>);
dictionary(GrantExpirationKind satisfies Dictionary<GrantExpirationKind>);
dictionary(IdentifierKind satisfies Dictionary<IdentifierKind>);
dictionary(IdentityErrorCode satisfies Dictionary<IdentityErrorCode>);
dictionary(AuthPolicyField satisfies Dictionary<AuthPolicyField>);
dictionary(ImpersonationScope satisfies Dictionary<ImpersonationScope>);
dictionary(ImpersonationState satisfies Dictionary<ImpersonationState>);
dictionary(
  ImpersonationEndReasonKind satisfies Dictionary<ImpersonationEndReasonKind>,
);
dictionary(JournalEffectKind satisfies Dictionary<JournalEffectKind>);
dictionary(StreakEffectOp satisfies Dictionary<StreakEffectOp>);
dictionary(FreezeEffectOp satisfies Dictionary<FreezeEffectOp>);
dictionary(AchievementEffectOp satisfies Dictionary<AchievementEffectOp>);
dictionary(TierEffectOp satisfies Dictionary<TierEffectOp>);
dictionary(RewardEffectOp satisfies Dictionary<RewardEffectOp>);
dictionary(RedemptionEffectOp satisfies Dictionary<RedemptionEffectOp>);
dictionary(PauseEffectOp satisfies Dictionary<PauseEffectOp>);
dictionary(RewardRefKind satisfies Dictionary<RewardRefKind>);
dictionary(CosmeticId satisfies Dictionary<CosmeticId>);
dictionary(PauseTermKind satisfies Dictionary<PauseTermKind>);
dictionary(PauseScope satisfies Dictionary<PauseScope>);
dictionary(JournalVisibility satisfies Dictionary<JournalVisibility>);
dictionary(LabelCode satisfies Dictionary<LabelCode>);
dictionary(JournalSourceKind satisfies Dictionary<JournalSourceKind>);
dictionary(JournalSystemJob satisfies Dictionary<JournalSystemJob>);
dictionary(Locale satisfies Dictionary<Locale>);
dictionary(MediaErrorCode satisfies Dictionary<MediaErrorCode>);
dictionary(BlockKind satisfies Dictionary<BlockKind>);
dictionary(MoneyErrorCode satisfies Dictionary<MoneyErrorCode>);
dictionary(Currency satisfies Dictionary<Currency>);
dictionary(RoundingMode satisfies Dictionary<RoundingMode>);
dictionary(NotificationKind satisfies Dictionary<NotificationKind>);
dictionary(OnboardingFlowStep satisfies Dictionary<OnboardingFlowStep>);
dictionary(
  OnboardingFlowEventKind satisfies Dictionary<OnboardingFlowEventKind>,
);
dictionary(DayHoursKind satisfies Dictionary<DayHoursKind>);
dictionary(OtpDestinationType satisfies Dictionary<OtpDestinationType>);
dictionary(OtpPurpose satisfies Dictionary<OtpPurpose>);
dictionary(PartyMemberKind satisfies Dictionary<PartyMemberKind>);
dictionary(PersonalRecordKind satisfies Dictionary<PersonalRecordKind>);
dictionary(PhoneErrorCode satisfies Dictionary<PhoneErrorCode>);
dictionary(PhoneInvalidReason satisfies Dictionary<PhoneInvalidReason>);
dictionary(
  PhotoOrigin satisfies Readonly<Record<'Shot' | 'Library', PhotoOrigin>>,
);
dictionary(PipelineErrorCode satisfies Dictionary<PipelineErrorCode>);
dictionary(
  PlacementKind satisfies Readonly<Record<'Self' | 'Staff', PlacementKind>>,
);
dictionary(PrincipalKind satisfies Dictionary<PrincipalKind>);
dictionary(PositionState satisfies Dictionary<PositionState>);
dictionary(Frequency satisfies Dictionary<Frequency>);
dictionary(WeekOfMonth satisfies Dictionary<WeekOfMonth>);
dictionary(MonthlyDayKind satisfies Dictionary<MonthlyDayKind>);
dictionary(RecurrenceEndKind satisfies Dictionary<RecurrenceEndKind>);
dictionary(RegistrationState satisfies Dictionary<RegistrationState>);
dictionary(RegistrationField satisfies Dictionary<RegistrationField>);
dictionary(RepositoryErrorCode satisfies Dictionary<RepositoryErrorCode>);
dictionary(RewardGrantKind satisfies Dictionary<RewardGrantKind>);
dictionary(Role satisfies Dictionary<Role>);
dictionary(SchedulingErrorCode satisfies Dictionary<SchedulingErrorCode>);
dictionary(SeatOutcomeKind satisfies Dictionary<SeatOutcomeKind>);
dictionary(CancellationReason satisfies Dictionary<CancellationReason>);
dictionary(CancelledBy satisfies Dictionary<CancelledBy>);
dictionary(SeatSubjectKind satisfies Dictionary<SeatSubjectKind>);
dictionary(SeatRelationship satisfies Dictionary<SeatRelationship>);
dictionary(ServiceCompositionKind satisfies Dictionary<ServiceCompositionKind>);
dictionary(SessionKind satisfies Dictionary<SessionKind>);
dictionary(FamilyScopeKind satisfies Dictionary<FamilyScopeKind>);
dictionary(StreakIntervalKind satisfies Dictionary<StreakIntervalKind>);
dictionary(StreakIntervalSource satisfies Dictionary<StreakIntervalSource>);
dictionary(StreakQualifierKind satisfies Dictionary<StreakQualifierKind>);
dictionary(QualifierComparison satisfies Dictionary<QualifierComparison>);
dictionary(StreakExcuse satisfies Dictionary<StreakExcuse>);
dictionary(StreakOnBreak satisfies Dictionary<StreakOnBreak>);
dictionary(StreakTransition satisfies Dictionary<StreakTransition>);
dictionary(StreakRuleDirection satisfies Dictionary<StreakRuleDirection>);
dictionary(StreakRuleParameter satisfies Dictionary<StreakRuleParameter>);
dictionary(StreakPhaseKind satisfies Dictionary<StreakPhaseKind>);
dictionary(FreezeReason satisfies Dictionary<FreezeReason>);
dictionary(StreakPeriodMark satisfies Dictionary<StreakPeriodMark>);
dictionary(TierOverrideSourceKind satisfies Dictionary<TierOverrideSourceKind>);
dictionary(TimeErrorCode satisfies Dictionary<TimeErrorCode>);
dictionary(DateTimeInvalidReason satisfies Dictionary<DateTimeInvalidReason>);
dictionary(VoucherStateKind satisfies Dictionary<VoucherStateKind>);
dictionary(VoucherRefusal satisfies Dictionary<VoucherRefusal>);
dictionary(WaitlistState satisfies Dictionary<WaitlistState>);
dictionary(
  Weekday satisfies Readonly<
    Record<'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun', Weekday>
  >,
);
dictionary(WriteKind satisfies Dictionary<WriteKind>);
dictionary(BackfillJobKind satisfies Dictionary<BackfillJobKind>);
dictionary(PolicyRecomputeJobKind satisfies Dictionary<PolicyRecomputeJobKind>);
dictionary(DstResolution satisfies Dictionary<DstResolution>);
dictionary(Collections satisfies Dictionary<CollectionName>);
dictionary(Subcollections satisfies Dictionary<SubcollectionName>);
dictionary(RetiredCollections satisfies Dictionary<RetiredCollectionName>);
dictionary(
  RetiredSubcollections satisfies Dictionary<RetiredSubcollectionName>,
);

// (2) Holds — exact values, one key per value.
export type DictionariesHold = [
  Expect<Holds<typeof AccountState, AccountState>>, // components/account-status.data.ts
  Expect<Holds<typeof BlockReason, BlockReason>>, // components/account-status.data.ts
  Expect<Holds<typeof AccountsErrorCode, AccountsErrorCode>>, // components/accounts-errors.data.ts
  Expect<Holds<typeof ActorKind, ActorKind>>, // components/actor.data.ts
  Expect<Holds<typeof SystemSource, SystemSource>>, // components/actor.data.ts
  Expect<Holds<typeof AppliedDiscountSource, AppliedDiscountSource>>, // components/applied-discount.data.ts
  Expect<Holds<typeof AuditAction, AuditAction>>, // components/audit-context.data.ts
  Expect<Holds<typeof BackfillOutcome, BackfillOutcome>>, // components/audit-context.data.ts
  Expect<Holds<typeof AuthStage, AuthStage>>, // components/auth-claims.data.ts
  Expect<Holds<typeof AuthFlowStep, AuthFlowStep>>, // components/auth-flow.data.ts
  Expect<Holds<typeof AuthFlowEventKind, AuthFlowEventKind>>, // components/auth-flow.data.ts
  Expect<Holds<typeof AuthStrategyKind, AuthStrategyKind>>, // components/auth-strategy.data.ts
  Expect<Holds<typeof AuthProviderKind, AuthProviderKind>>, // components/auth-strategy.data.ts
  Expect<Holds<typeof OAuthProvider, OAuthProvider>>, // components/auth-strategy.data.ts
  Expect<Holds<typeof EarnedVia, EarnedVia>>, // components/badge-level.data.ts
  Expect<Holds<typeof MedalState, MedalState>>, // components/badge-level.data.ts
  Expect<Holds<typeof BarberPrefKind, BarberPrefKind>>, // components/barber-pref.data.ts
  Expect<Holds<typeof BookingFlowErrorCode, BookingFlowErrorCode>>, // components/booking-flow-errors.data.ts
  Expect<Holds<typeof BookingFlowStep, BookingFlowStep>>, // components/booking-flow.data.ts
  Expect<Holds<typeof MoveRefusalKind, MoveRefusalKind>>, // components/booking-flow.data.ts
  Expect<Holds<Pick<typeof ShopReach, 'Call' | 'Contact'>, ShopReach>>, // components/booking-flow.data.ts (SHOP_REACH)
  Expect<Holds<typeof BookingState, BookingState>>, // components/booking-status.data.ts
  Expect<Holds<typeof SeatKeyKind, SeatKeyKind>>, // components/cart-line.data.ts
  Expect<Holds<typeof CatalogErrorCode, CatalogErrorCode>>, // components/catalog-errors.data.ts
  Expect<Holds<typeof MediaDimension, MediaDimension>>, // components/catalog-errors.data.ts
  Expect<Holds<typeof GeoAxis, GeoAxis>>, // components/catalog-errors.data.ts
  Expect<Holds<typeof ServiceState, ServiceState>>, // components/catalog-status.data.ts
  Expect<Holds<typeof BarberState, BarberState>>, // components/catalog-status.data.ts
  Expect<Holds<typeof LocationState, LocationState>>, // components/catalog-status.data.ts
  Expect<Holds<typeof CouponCombinabilityKind, CouponCombinabilityKind>>, // components/coupon-combinability.data.ts
  Expect<Holds<typeof CouponExpiryKind, CouponExpiryKind>>, // components/coupon-expiry.data.ts
  Expect<Holds<typeof CouponOccasion, CouponOccasion>>, // components/coupon-occasion.data.ts
  Expect<Holds<typeof CouponStatus, CouponStatus>>, // components/coupon-occasion.data.ts
  Expect<Holds<typeof CouponValueKind, CouponValueKind>>, // components/coupon-value.data.ts
  Expect<
    Holds<Pick<typeof Daypart, 'Morning' | 'Afternoon' | 'Evening'>, Daypart>
  >, // components/daypart.data.ts (DAYPART)
  Expect<Holds<typeof StreakRuleField, StreakRuleField>>, // components/engagement-errors.data.ts
  Expect<Holds<typeof EngagementErrorCode, EngagementErrorCode>>, // components/engagement-errors.data.ts
  Expect<Holds<typeof EnrollmentStatus, EnrollmentStatus>>, // components/enrollment-status.data.ts
  Expect<Holds<typeof ExceptionEffectKind, ExceptionEffectKind>>, // components/exception-effect.data.ts
  Expect<Holds<typeof FlagName, FlagName>>, // components/feature-flags.data.ts
  Expect<Holds<typeof BadgeCategoryKind, BadgeCategoryKind>>, // components/gamification.data.ts
  Expect<Holds<typeof BadgeEmblem, BadgeEmblem>>, // components/gamification.data.ts
  Expect<Holds<typeof Metric, Metric>>, // components/gamification.data.ts
  Expect<Holds<typeof PerkId, PerkId>>, // components/gamification.data.ts
  Expect<Holds<typeof AwardKind, AwardKind>>, // components/gamification.data.ts
  Expect<Holds<typeof BadgeSubjectKind, BadgeSubjectKind>>, // components/gamification.data.ts
  Expect<Holds<typeof SeasonKind, SeasonKind>>, // components/gamification.data.ts
  Expect<Holds<typeof SeasonPhase, SeasonPhase>>, // components/gamification.data.ts
  Expect<Holds<typeof GovernanceErrorCode, GovernanceErrorCode>>, // components/governance-errors.data.ts
  Expect<Holds<typeof GrantState, GrantState>>, // components/grant-status.data.ts
  Expect<Holds<typeof GrantCapacityKind, GrantCapacityKind>>, // components/grant-status.data.ts
  Expect<Holds<typeof GrantExpirationKind, GrantExpirationKind>>, // components/grant-status.data.ts
  Expect<Holds<typeof IdentifierKind, IdentifierKind>>, // components/identifier.data.ts
  Expect<Holds<typeof IdentityErrorCode, IdentityErrorCode>>, // components/identity-errors.data.ts
  Expect<Holds<typeof AuthPolicyField, AuthPolicyField>>, // components/identity-errors.data.ts
  Expect<Holds<typeof ImpersonationScope, ImpersonationScope>>, // components/impersonation-scope.data.ts
  Expect<Holds<typeof ImpersonationState, ImpersonationState>>, // components/impersonation-status.data.ts
  Expect<Holds<typeof ImpersonationEndReasonKind, ImpersonationEndReasonKind>>, // components/impersonation-status.data.ts
  Expect<Holds<typeof JournalEffectKind, JournalEffectKind>>, // components/journal-effect.data.ts
  Expect<Holds<typeof StreakEffectOp, StreakEffectOp>>, // components/journal-effect.data.ts
  Expect<Holds<typeof FreezeEffectOp, FreezeEffectOp>>, // components/journal-effect.data.ts
  Expect<Holds<typeof AchievementEffectOp, AchievementEffectOp>>, // components/journal-effect.data.ts
  Expect<Holds<typeof TierEffectOp, TierEffectOp>>, // components/journal-effect.data.ts
  Expect<Holds<typeof RewardEffectOp, RewardEffectOp>>, // components/journal-effect.data.ts
  Expect<Holds<typeof RedemptionEffectOp, RedemptionEffectOp>>, // components/journal-effect.data.ts
  Expect<Holds<typeof PauseEffectOp, PauseEffectOp>>, // components/journal-effect.data.ts
  Expect<Holds<typeof RewardRefKind, RewardRefKind>>, // components/journal-effect.data.ts
  Expect<Holds<typeof CosmeticId, CosmeticId>>, // components/journal-effect.data.ts
  Expect<Holds<typeof PauseTermKind, PauseTermKind>>, // components/journal-effect.data.ts
  Expect<Holds<typeof PauseScope, PauseScope>>, // components/journal-effect.data.ts
  Expect<Holds<typeof JournalVisibility, JournalVisibility>>, // components/journal-effect.data.ts
  Expect<Holds<typeof LabelCode, LabelCode>>, // components/journal-effect.data.ts
  Expect<Holds<typeof JournalSourceKind, JournalSourceKind>>, // components/journal-source.data.ts
  Expect<Holds<typeof JournalSystemJob, JournalSystemJob>>, // components/journal-source.data.ts
  Expect<Holds<typeof Locale, Locale>>, // components/locale.data.ts
  Expect<Holds<typeof MediaErrorCode, MediaErrorCode>>, // components/media-errors.data.ts
  Expect<Holds<typeof BlockKind, BlockKind>>, // components/minute-block.data.ts
  Expect<Holds<typeof MoneyErrorCode, MoneyErrorCode>>, // components/money-errors.data.ts
  Expect<Holds<typeof Currency, Currency>>, // components/money.data.ts
  Expect<Holds<typeof RoundingMode, RoundingMode>>, // components/money.data.ts
  Expect<Holds<typeof NotificationKind, NotificationKind>>, // components/notification-payload.data.ts
  Expect<Holds<typeof OnboardingFlowStep, OnboardingFlowStep>>, // components/onboarding-flow.data.ts
  Expect<Holds<typeof OnboardingFlowEventKind, OnboardingFlowEventKind>>, // components/onboarding-flow.data.ts
  Expect<Holds<typeof DayHoursKind, DayHoursKind>>, // components/opening-hours.data.ts
  Expect<Holds<typeof OtpDestinationType, OtpDestinationType>>, // components/otp-destination-type.data.ts
  Expect<Holds<typeof OtpPurpose, OtpPurpose>>, // components/otp-purpose.data.ts
  Expect<Holds<typeof PartyMemberKind, PartyMemberKind>>, // components/party.data.ts
  Expect<Holds<typeof PersonalRecordKind, PersonalRecordKind>>, // components/personal-record.data.ts
  Expect<Holds<typeof PhoneErrorCode, PhoneErrorCode>>, // components/phone-errors.data.ts
  Expect<Holds<typeof PhoneInvalidReason, PhoneInvalidReason>>, // components/phone-errors.data.ts
  Expect<Holds<Pick<typeof PhotoOrigin, 'Shot' | 'Library'>, PhotoOrigin>>, // components/photo-origin.data.ts (PHOTO_ORIGIN)
  Expect<Holds<typeof PipelineErrorCode, PipelineErrorCode>>, // components/pipeline-errors.data.ts
  Expect<Holds<Pick<typeof PlacementKind, 'Self' | 'Staff'>, PlacementKind>>, // components/placement-kind.data.ts (PLACEMENT_KIND)
  Expect<Holds<typeof PrincipalKind, PrincipalKind>>, // components/principal.data.ts
  Expect<Holds<typeof PositionState, PositionState>>, // components/program-status.data.ts
  Expect<Holds<typeof Frequency, Frequency>>, // components/recurrence-rule.data.ts
  Expect<Holds<typeof WeekOfMonth, WeekOfMonth>>, // components/recurrence-rule.data.ts
  Expect<Holds<typeof MonthlyDayKind, MonthlyDayKind>>, // components/recurrence-rule.data.ts
  Expect<Holds<typeof RecurrenceEndKind, RecurrenceEndKind>>, // components/recurrence-rule.data.ts
  Expect<Holds<typeof RegistrationState, RegistrationState>>, // components/registration.data.ts
  Expect<Holds<typeof RegistrationField, RegistrationField>>, // components/registration.data.ts
  Expect<Holds<typeof RepositoryErrorCode, RepositoryErrorCode>>, // components/repository-errors.data.ts
  Expect<Holds<typeof RewardGrantKind, RewardGrantKind>>, // components/reward-grant.data.ts
  Expect<Holds<typeof Role, Role>>, // components/role.data.ts
  Expect<Holds<typeof SchedulingErrorCode, SchedulingErrorCode>>, // components/scheduling-errors.data.ts
  Expect<Holds<typeof SeatOutcomeKind, SeatOutcomeKind>>, // components/seat-outcome.data.ts
  Expect<Holds<typeof CancellationReason, CancellationReason>>, // components/seat-outcome.data.ts
  Expect<Holds<typeof CancelledBy, CancelledBy>>, // components/seat-outcome.data.ts
  Expect<Holds<typeof SeatSubjectKind, SeatSubjectKind>>, // components/seat.data.ts
  Expect<Holds<typeof SeatRelationship, SeatRelationship>>, // components/seat.data.ts
  Expect<Holds<typeof ServiceCompositionKind, ServiceCompositionKind>>, // components/service-composition.data.ts
  Expect<Holds<typeof SessionKind, SessionKind>>, // components/session-kind.data.ts
  Expect<Holds<typeof FamilyScopeKind, FamilyScopeKind>>, // components/standing.data.ts
  Expect<Holds<typeof StreakIntervalKind, StreakIntervalKind>>, // components/streak-interval.data.ts
  Expect<Holds<typeof StreakIntervalSource, StreakIntervalSource>>, // components/streak-interval.data.ts
  Expect<Holds<typeof StreakQualifierKind, StreakQualifierKind>>, // components/streak-qualifier.data.ts
  Expect<Holds<typeof QualifierComparison, QualifierComparison>>, // components/streak-qualifier.data.ts
  Expect<Holds<typeof StreakExcuse, StreakExcuse>>, // components/streak-rule.data.ts
  Expect<Holds<typeof StreakOnBreak, StreakOnBreak>>, // components/streak-rule.data.ts
  Expect<Holds<typeof StreakTransition, StreakTransition>>, // components/streak-rule.data.ts
  Expect<Holds<typeof StreakRuleDirection, StreakRuleDirection>>, // components/streak-rule.data.ts
  Expect<Holds<typeof StreakRuleParameter, StreakRuleParameter>>, // components/streak-rule.data.ts
  Expect<Holds<typeof StreakPhaseKind, StreakPhaseKind>>, // components/streak-state.data.ts
  Expect<Holds<typeof FreezeReason, FreezeReason>>, // components/streak-state.data.ts
  Expect<Holds<typeof StreakPeriodMark, StreakPeriodMark>>, // components/streak-state.data.ts
  Expect<Holds<typeof TierOverrideSourceKind, TierOverrideSourceKind>>, // components/tier-state.data.ts
  Expect<Holds<typeof TimeErrorCode, TimeErrorCode>>, // components/time-errors.data.ts
  Expect<Holds<typeof DateTimeInvalidReason, DateTimeInvalidReason>>, // components/time-errors.data.ts
  Expect<Holds<typeof VoucherStateKind, VoucherStateKind>>, // components/voucher-state.data.ts
  Expect<Holds<typeof VoucherRefusal, VoucherRefusal>>, // components/voucher-state.data.ts
  Expect<Holds<typeof WaitlistState, WaitlistState>>, // components/waitlist-status.data.ts
  Expect<
    Holds<
      Pick<
        typeof Weekday,
        'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun'
      >,
      Weekday
    >
  >, // components/weekday.data.ts (ISO_WEEKDAY)
  Expect<Holds<typeof WriteKind, WriteKind>>, // components/write-op.data.ts
  Expect<Holds<typeof BackfillJobKind, BackfillJobKind>>, // entities/backfill-job.entity.ts
  Expect<Holds<typeof PolicyRecomputeJobKind, PolicyRecomputeJobKind>>, // entities/policy-recompute-job.entity.ts
  Expect<Holds<typeof DstResolution, DstResolution>>, // systems/zoned-time.system.ts
  Expect<Holds<typeof Collections, CollectionName>>, // ports/collections.ts
  Expect<Holds<typeof Subcollections, SubcollectionName>>, // ports/collections.ts
  Expect<Holds<typeof RetiredCollections, RetiredCollectionName>>, // ports/collections.ts
  Expect<Holds<typeof RetiredSubcollections, RetiredSubcollectionName>>, // ports/collections.ts
];

// (3) Kind coverage — each union's `kind` is its dictionary.
export type KindsCoverTheirDictionaries = [
  Expect<Equals<AccountStatus['kind'], AccountState>>, // components/account-status.data.ts
  Expect<Equals<Registration['kind'], RegistrationState>>, // components/registration.data.ts
  Expect<Equals<ImpersonationEndReason['kind'], ImpersonationEndReasonKind>>, // components/impersonation-status.data.ts
  Expect<Equals<ImpersonationStatus['kind'], ImpersonationState>>, // components/impersonation-status.data.ts
  Expect<Equals<Actor['kind'], ActorKind>>, // components/actor.data.ts
  Expect<Equals<DayHours['kind'], DayHoursKind>>, // components/opening-hours.data.ts
  Expect<Equals<ClockDayHours['kind'], DayHoursKind>>, // components/opening-hours.data.ts
  Expect<Equals<ServiceComposition['kind'], ServiceCompositionKind>>, // components/service-composition.data.ts
  Expect<Equals<AwardSummary['kind'], AwardKind>>, // components/gamification.data.ts
  Expect<Equals<BadgeSubject['kind'], BadgeSubjectKind>>, // components/gamification.data.ts
  Expect<Equals<CouponGrantCapacity['kind'], GrantCapacityKind>>, // components/grant-status.data.ts
  Expect<Equals<CouponGrantExpiration['kind'], GrantExpirationKind>>, // components/grant-status.data.ts
  Expect<Equals<GrantStatus['kind'], GrantState>>, // components/grant-status.data.ts
  Expect<Equals<VoucherState['kind'], VoucherStateKind>>, // components/voucher-state.data.ts
  Expect<Equals<CouponValue['kind'], CouponValueKind>>, // components/coupon-value.data.ts
  Expect<Equals<CouponCombinability['kind'], CouponCombinabilityKind>>, // components/coupon-combinability.data.ts
  Expect<Equals<CouponExpiry['kind'], CouponExpiryKind>>, // components/coupon-expiry.data.ts
  Expect<Equals<AuditContext['kind'], AuditAction>>, // components/audit-context.data.ts
  Expect<Equals<ParsedIdentifier['kind'], IdentifierKind>>, // components/identifier.data.ts
  Expect<Equals<AuthFlowState['kind'], AuthFlowStep>>, // components/auth-flow.data.ts
  Expect<Equals<AuthFlowEvent['kind'], AuthFlowEventKind>>, // components/auth-flow.data.ts
  Expect<Equals<AuthStrategy['kind'], AuthStrategyKind>>, // components/auth-strategy.data.ts
  Expect<Equals<AuthProvider['kind'], AuthProviderKind>>, // components/auth-strategy.data.ts
  Expect<Equals<BarberPref['kind'], BarberPrefKind>>, // components/barber-pref.data.ts
  Expect<Equals<BookingStatus['kind'], BookingState>>, // components/booking-status.data.ts
  Expect<Equals<SeatOutcome['kind'], SeatOutcomeKind>>, // components/seat-outcome.data.ts
  Expect<Equals<SeatSubject['kind'], SeatSubjectKind>>, // components/seat.data.ts
  Expect<Equals<SeatKey['kind'], SeatKeyKind>>, // components/cart-line.data.ts
  Expect<Equals<PartyMember['kind'], PartyMemberKind>>, // components/party.data.ts
  Expect<Equals<BookingFlowState['kind'], BookingFlowStep>>, // components/booking-flow.data.ts
  Expect<Equals<ExceptionEffect['kind'], ExceptionEffectKind>>, // components/exception-effect.data.ts
  Expect<Equals<JournalActor['kind'], ActorKind>>, // components/journal-actor.data.ts
  Expect<Equals<RewardGrant['kind'], RewardGrantKind>>, // components/reward-grant.data.ts
  Expect<Equals<StreakInterval['kind'], StreakIntervalKind>>, // components/streak-interval.data.ts
  Expect<Equals<StreakQualifier['kind'], StreakQualifierKind>>, // components/streak-qualifier.data.ts
  Expect<Equals<JournalSource['kind'], JournalSourceKind>>, // components/journal-source.data.ts
  Expect<Equals<RewardRef['kind'], RewardRefKind>>, // components/journal-effect.data.ts
  Expect<Equals<PauseTerm['kind'], PauseTermKind>>, // components/journal-effect.data.ts
  Expect<Equals<JournalEffect['kind'], JournalEffectKind>>, // components/journal-effect.data.ts
  Expect<Equals<NotificationPayload['kind'], NotificationKind>>, // components/notification-payload.data.ts
  Expect<Equals<OnboardingFlowState['kind'], OnboardingFlowStep>>, // components/onboarding-flow.data.ts
  Expect<Equals<OnboardingFlowEvent['kind'], OnboardingFlowEventKind>>, // components/onboarding-flow.data.ts
  Expect<Equals<Principal['kind'], PrincipalKind>>, // components/principal.data.ts
  Expect<Equals<FamilyScope['kind'], FamilyScopeKind>>, // components/standing.data.ts
  Expect<Equals<StreakPhase['kind'], StreakPhaseKind>>, // components/streak-state.data.ts
  Expect<Equals<TierOverrideSource['kind'], TierOverrideSourceKind>>, // components/tier-state.data.ts
  Expect<Equals<WriteOp['kind'], WriteKind>>, // components/write-op.data.ts
];

// The checks are not vacuous.
export type ProbeSharedValue = Expect<
  // @ts-expect-error — two keys sharing a value fail Holds.
  Holds<{ readonly A: 'a'; readonly B: 'a' }, 'a'>
>;
export type ProbeWideType = Expect<
  // @ts-expect-error — a type wider than the values fails Holds.
  Holds<{ readonly A: 'a' }, 'a' | 'b'>
>;
export type ProbeMissingTag = Expect<
  // @ts-expect-error — a union missing a tag fails kind coverage.
  Equals<{ readonly kind: 'a' }['kind'], 'a' | 'b'>
>;
