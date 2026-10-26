/**
 * The identity group's dictionaries (flatten-spec §3.7, §3.9, §7), checked at
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
 *    `AuthStage`, `Role` (claim and rules values, OQ-3), `FlagName`
 *    (manifest keys), `PhoneInvalidReason` (libphonenumber strings), and
 *    `RegistrationField` / `AuditedProfileField` / `AuthPolicyField` (they
 *    ARE field names — the user document's and the policy bag's).
 *
 * `tsc` failing IS the test; nothing here runs.
 */
import {
  type AccountLifecycle,
  AccountStatus,
  BlockReason,
} from './account-status.data';
import { type BookingStatus, IdentifierChannel } from '@core/primitives';
import {
  AccountsErrorCode,
  GovernanceErrorCode,
  AuthPolicyField,
  type IdentityError,
  IdentityErrorCode,
  MediaErrorCode,
  PhoneErrorCode,
  PhoneInvalidReason,
} from '@core/errors';
import type { AccessDecision } from './access-decision.data';
import { AccessTarget } from './access-target.data';
import { AccessVerdict } from './access-verdict.data';
import { type Actor, ActorRole, SystemSource } from './actor.data';
import {
  AuditAction,
  type AuditContext,
  BackfillOutcome,
} from './audit-context.data';
import { AuditTarget, type AuditTargetRef } from './audit-target-ref.data';
import { AuditedProfileField } from './audited-profile-field.data';
import { GovernedCollection } from './governed-collection.data';
import type { CancellationDelta } from './cancellation-delta.data';
import type { TransitionDelta } from './transition-delta.data';
import { type AuthClaims, AuthStage } from './auth-claims.data';
import { type AuthFlowEvent, AuthFlowEventKind } from './auth-flow-event.data';
import { type AuthFlowState, AuthFlowStep } from './auth-flow.data';
import {
  type AuthProvider,
  AuthProviderKind,
  OAuthProvider,
} from './auth-provider.data';
import { type AuthStrategy, AuthStrategyKind } from './auth-strategy.data';
import { CustomerOrigin } from './customer-origin.data';
import {
  type EndReasonFields,
  ImpersonationEndReason,
} from './end-reason-fields.data';
import { FlagName } from './feature-flags.data';
import { ImpersonationScope } from './impersonation-scope.data';
import {
  type ImpersonationLifecycle,
  ImpersonationStatus,
} from './impersonation-status.data';
import {
  type OnboardingFlowEvent,
  OnboardingFlowEventKind,
} from './onboarding-flow-event.data';
import {
  type OnboardingFlowState,
  OnboardingFlowStep,
} from './onboarding-flow.data';
import { OtpDestinationType } from './otp-destination-type.data';
import { OtpPurpose } from './otp-purpose.data';
import type { ParsedIdentifier } from './parsed-identifier.data';
import { type Principal, PrincipalKind } from './principal.data';
import { ProfileCompletionKey } from './profile-completion-key.data';
import { RegistrationField, RegistrationState } from './registration.data';
import { Role } from './role.data';
import { RouteGate, type RouteGateRule } from './route-gate.data';
import {
  SessionReadiness,
  type SessionReadinessState,
} from './session-readiness.data';
import { SessionKind } from './session-kind.data';
import { SettledVerdict } from './settled-verdict.data';
import type { Customer, ImpersonationSession, Otp, User } from '@core/entities';
import type { ProfileCompletionItem } from '@core/systems';

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

/** A redirect decision — the variant that carries `to`. */
type Redirect = Extract<
  AccessDecision,
  { readonly accessVerdict: typeof AccessVerdict.Redirect }
>;
type EndedLifecycle = ImpersonationLifecycle.Ended;
type BlockedLifecycle = AccountLifecycle.Blocked;
type SystemActor = Actor.System;
type ImpersonatorActor = Actor.Impersonator;
type BackfillContext = AuditContext.Backfill;
type GovernedContext = AuditContext.Governed;
type ImpersonationStartedContext = AuditContext.ImpersonationStarted;
type ImpersonationEndedContext = AuditContext.ImpersonationEnded;
type DoneAuthFlow = AuthFlowState.Done;
type OAuthEntry = AuthProvider.OAuth;
type IdentifierRefusal = IdentityError.IdentifierInvalid;

// (1) Holds — exact values, one key per value.
export type IdentityDictionariesHold = [
  Expect<Holds<typeof AccountStatus, AccountStatus>>, // account-status.data.ts
  Expect<Holds<typeof BlockReason, BlockReason>>, // account-status.data.ts
  Expect<Holds<typeof AccountsErrorCode, AccountsErrorCode>>, // accounts.error.ts
  Expect<Holds<typeof ActorRole, ActorRole>>, // actor.data.ts
  Expect<Holds<typeof SystemSource, SystemSource>>, // actor.data.ts
  Expect<Holds<typeof AuditAction, AuditAction>>, // audit-context.data.ts
  Expect<Holds<typeof BackfillOutcome, BackfillOutcome>>, // audit-context.data.ts
  Expect<Holds<typeof AuditTarget, AuditTarget>>, // audit-target-ref.data.ts
  Expect<Holds<typeof AuditedProfileField, AuditedProfileField>>, // audited-profile-field.data.ts
  Expect<Holds<typeof GovernedCollection, GovernedCollection>>, // governed-collection.data.ts
  Expect<Holds<typeof AuthStage, AuthStage>>, // auth-claims.data.ts
  Expect<Holds<typeof AuthFlowStep, AuthFlowStep>>, // auth-flow.data.ts
  Expect<Holds<typeof AuthFlowEventKind, AuthFlowEventKind>>, // auth-flow-event.data.ts
  Expect<Holds<typeof AuthStrategyKind, AuthStrategyKind>>, // auth-strategy.data.ts
  Expect<Holds<typeof AuthProviderKind, AuthProviderKind>>, // auth-provider.data.ts
  Expect<Holds<typeof OAuthProvider, OAuthProvider>>, // auth-provider.data.ts
  Expect<Holds<typeof CustomerOrigin, CustomerOrigin>>, // customer-origin.data.ts
  Expect<Holds<typeof FlagName, FlagName>>, // feature-flags.data.ts
  Expect<Holds<typeof GovernanceErrorCode, GovernanceErrorCode>>, // governance.error.ts
  Expect<Holds<typeof IdentifierChannel, IdentifierChannel>>, // primitives/identifier-channel.data.ts
  Expect<Holds<typeof IdentityErrorCode, IdentityErrorCode>>, // identity.error.ts
  Expect<Holds<typeof AuthPolicyField, AuthPolicyField>>, // identity.error.ts
  Expect<Holds<typeof ImpersonationScope, ImpersonationScope>>, // impersonation-scope.data.ts
  Expect<Holds<typeof ImpersonationStatus, ImpersonationStatus>>, // impersonation-status.data.ts
  Expect<Holds<typeof ImpersonationEndReason, ImpersonationEndReason>>, // end-reason-fields.data.ts
  Expect<Holds<typeof MediaErrorCode, MediaErrorCode>>, // media.error.ts
  Expect<Holds<typeof OnboardingFlowStep, OnboardingFlowStep>>, // onboarding-flow.data.ts
  Expect<Holds<typeof OnboardingFlowEventKind, OnboardingFlowEventKind>>, // onboarding-flow-event.data.ts
  Expect<Holds<typeof OtpDestinationType, OtpDestinationType>>, // otp-destination-type.data.ts
  Expect<Holds<typeof OtpPurpose, OtpPurpose>>, // otp-purpose.data.ts
  Expect<Holds<typeof PhoneErrorCode, PhoneErrorCode>>, // phone.error.ts
  Expect<Holds<typeof PhoneInvalidReason, PhoneInvalidReason>>, // phone.error.ts
  Expect<Holds<typeof PrincipalKind, PrincipalKind>>, // principal.data.ts
  Expect<Holds<typeof RegistrationState, RegistrationState>>, // registration.data.ts
  Expect<Holds<typeof RegistrationField, RegistrationField>>, // registration.data.ts
  Expect<Holds<typeof Role, Role>>, // role.data.ts
  Expect<Holds<typeof SessionKind, SessionKind>>, // session-kind.data.ts
  Expect<Holds<typeof SettledVerdict, SettledVerdict>>, // settled-verdict.data.ts
  Expect<Holds<typeof ProfileCompletionKey, ProfileCompletionKey>>, // profile-completion-key.data.ts
  Expect<Holds<typeof SessionReadiness, SessionReadiness>>, // session-readiness.data.ts
  Expect<Holds<typeof RouteGate, RouteGate>>, // route-gate.data.ts
  Expect<Holds<typeof AccessTarget, AccessTarget>>, // access-target.data.ts
  Expect<Holds<typeof AccessVerdict, AccessVerdict>>, // access-verdict.data.ts
];

// (2) The L8 pair lines — a discriminator or plain tag field is camelCase(Dictionary).
export type IdentityDictionaryFields = [
  Expect<Equals<AccountLifecycle['accountStatus'], AccountStatus>>, // account-status.data.ts
  Expect<Equals<BlockedLifecycle['blockReason'], BlockReason>>, // account-status.data.ts
  Expect<Equals<Actor['actorRole'], ActorRole>>, // actor.data.ts
  Expect<Equals<SystemActor['actorSystemSource'], SystemSource>>, // N15-exempt: a slice-prefixed reference (flatten-spec N15 names it)
  Expect<Equals<ImpersonatorActor['actorScope'], ImpersonationScope>>, // N15-exempt: a slice-prefixed reference to the session's scope
  Expect<Equals<AuditContext['auditAction'], AuditAction>>, // audit-context.data.ts
  Expect<Equals<BackfillContext['backfillOutcome'], BackfillOutcome>>, // audit-context.data.ts
  Expect<Equals<AuditTargetRef['auditTarget'], AuditTarget>>, // audit-target-ref.data.ts
  Expect<Equals<GovernedContext['governedCollection'], GovernedCollection>>, // audit-context.data.ts
  Expect<
    Equals<
      ImpersonationStartedContext['impersonationScope'],
      ImpersonationScope
    >
  >, // audit-context.data.ts
  Expect<
    Equals<ImpersonationEndedContext['impersonationScope'], ImpersonationScope>
  >, // audit-context.data.ts
  Expect<
    Equals<
      ImpersonationEndedContext['impersonationEndReason'],
      ImpersonationEndReason
    >
  >, // audit-context.data.ts
  Expect<Equals<TransitionDelta['transitionFromBookingStatus'], BookingStatus>>, // N15-exempt: the before-value of a transition (role-prefixed)
  Expect<
    Equals<CancellationDelta['cancellationFromBookingStatus'], BookingStatus>
  >, // N15-exempt: the before-value of a transition (role-prefixed)
  Expect<Equals<AuthClaims['authStage'], AuthStage>>, // auth-claims.data.ts
  Expect<Equals<AuthFlowState['authFlowStep'], AuthFlowStep>>, // auth-flow.data.ts
  Expect<Equals<AuthFlowEvent['authFlowEventKind'], AuthFlowEventKind>>, // auth-flow-event.data.ts
  Expect<Equals<DoneAuthFlow['sessionKind'], SessionKind>>, // auth-flow.data.ts
  Expect<Equals<AuthStrategy['authStrategyKind'], AuthStrategyKind>>, // auth-strategy.data.ts
  Expect<Equals<AuthProvider['authProviderKind'], AuthProviderKind>>, // auth-provider.data.ts
  Expect<Equals<OAuthEntry['provider'], OAuthProvider>>, // N15-exempt: the OAuth variant's named provider reference (flatten-spec §3.7 keeps it)
  Expect<Equals<Customer['customerOrigin'], CustomerOrigin>>, // customer.entity.ts
  Expect<Equals<ParsedIdentifier['identifierChannel'], IdentifierChannel>>, // parsed-identifier.data.ts
  Expect<Equals<IdentifierRefusal['identifierKind'], IdentifierChannel>>, // N15-exempt: an i18n param keeping its name, typed by the renamed tag (N12)
  Expect<
    Equals<ImpersonationSession['impersonationScope'], ImpersonationScope>
  >, // impersonation-session.entity.ts
  Expect<
    Equals<ImpersonationLifecycle['impersonationStatus'], ImpersonationStatus>
  >, // impersonation-status.data.ts
  Expect<
    Equals<EndReasonFields['impersonationEndReason'], ImpersonationEndReason>
  >, // end-reason-fields.data.ts
  Expect<
    Equals<EndedLifecycle['impersonationEndReason'], ImpersonationEndReason>
  >, // impersonation-status.data.ts
  Expect<Equals<OnboardingFlowState['onboardingFlowStep'], OnboardingFlowStep>>, // onboarding-flow.data.ts
  Expect<
    Equals<
      OnboardingFlowEvent['onboardingFlowEventKind'],
      OnboardingFlowEventKind
    >
  >, // onboarding-flow-event.data.ts
  Expect<Equals<Otp['otpDestinationType'], OtpDestinationType>>, // otp.entity.ts
  Expect<Equals<Otp['otpPurpose'], OtpPurpose>>, // otp.entity.ts
  Expect<Equals<Principal['principalKind'], PrincipalKind>>, // principal.data.ts
  Expect<Equals<User['registrationState'], RegistrationState>>, // user.entity.ts
  Expect<Equals<User['accountStatus'], AccountStatus>>, // user.entity.ts
  Expect<
    Equals<ProfileCompletionItem['profileCompletionKey'], ProfileCompletionKey>
  >, // profile-completion.system.ts
  Expect<Equals<SessionReadinessState['sessionReadiness'], SessionReadiness>>, // session-readiness.data.ts
  Expect<Equals<RouteGateRule['routeGate'], RouteGate>>, // route-gate.data.ts
  Expect<Equals<AccessDecision['accessVerdict'], AccessVerdict>>, // access-decision.data.ts
  Expect<Equals<Redirect['to'], AccessTarget>>, // N15-exempt: the redirect's destination, a typed reference in another role
];

// (3) SCREAMING values (flatten-spec §0.4, §7) — every non-exempt dictionary.
export type IdentityScreamingChecks = [
  Expect<Screaming<AccountStatus>>,
  Expect<Screaming<BlockReason>>,
  Expect<Screaming<AccountsErrorCode>>,
  Expect<Screaming<ActorRole>>,
  Expect<Screaming<SystemSource>>,
  Expect<Screaming<AuditAction>>,
  Expect<Screaming<BackfillOutcome>>,
  Expect<Screaming<AuditTarget>>,
  Expect<Screaming<GovernedCollection>>,
  Expect<Screaming<AuthFlowStep>>,
  Expect<Screaming<AuthFlowEventKind>>,
  Expect<Screaming<AuthStrategyKind>>,
  Expect<Screaming<AuthProviderKind>>,
  Expect<Screaming<OAuthProvider>>,
  Expect<Screaming<CustomerOrigin>>,
  Expect<Screaming<GovernanceErrorCode>>,
  Expect<Screaming<IdentifierChannel>>,
  Expect<Screaming<IdentityErrorCode>>,
  Expect<Screaming<ImpersonationScope>>,
  Expect<Screaming<ImpersonationStatus>>,
  Expect<Screaming<ImpersonationEndReason>>,
  Expect<Screaming<MediaErrorCode>>,
  Expect<Screaming<OnboardingFlowStep>>,
  Expect<Screaming<OnboardingFlowEventKind>>,
  Expect<Screaming<OtpDestinationType>>,
  Expect<Screaming<OtpPurpose>>,
  Expect<Screaming<PhoneErrorCode>>,
  Expect<Screaming<PrincipalKind>>,
  Expect<Screaming<RegistrationState>>,
  Expect<Screaming<SessionKind>>,
  Expect<Screaming<SettledVerdict>>,
  Expect<Screaming<ProfileCompletionKey>>,
  Expect<Screaming<SessionReadiness>>,
  Expect<Screaming<RouteGate>>,
  Expect<Screaming<AccessTarget>>,
  Expect<Screaming<AccessVerdict>>,
];

/** The exempt external contracts really are lower-case — the list above is honest. */
export type IdentityExemptAreNotScreaming = [
  Expect<Equals<Screaming<AuthStage>, false>>,
  Expect<Equals<Screaming<Role>, false>>,
  Expect<Equals<Screaming<AuditedProfileField>, false>>,
];
