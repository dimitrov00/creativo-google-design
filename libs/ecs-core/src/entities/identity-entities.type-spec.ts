/**
 * Compile-only proofs over the identity group's archetypes (Laws 2 and 6,
 * flatten-spec §3.7, §7 notes): each entity is the intersection of FLAT
 * slices that share no field name, the intersection is never `never`, every
 * variant is flat (`NoNested`), and each domain discriminator narrows to
 * exactly its variant's fields. `tsc` failing — on a `false` constant or an
 * unused `@ts-expect-error` — IS the test; nothing here runs.
 */
import {
  type AccountLifecycle,
  AccountStatus,
  type AuditedProfileField,
  type Actor,
  ActorRole,
  AuditAction,
  type AuditContext,
  AuditTarget,
  type AuditTargetRef,
  type CancellationDelta,
  type GovernedCollection,
  ImpersonationEndReason,
  type ImpersonationLifecycle,
  ImpersonationStatus,
  type OtpRefusalReason,
  type RescheduleDelta,
  type Role,
  type SearchFields,
  type SessionKind,
  type StaffEditDelta,
  type TipDelta,
  type TransitionDelta,
  type WriteProvenance,
} from '@core/components';
import type {
  AttendanceState,
  CustomerId,
  IdentifierChannel,
  ImpersonationSessionId,
  OperationId,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import type { RegistrationSystem } from '@core/systems';
import type { AllTrue, Disjoint, NoNested } from '@core/testing';
import type { AuditEntry, AuditEntryMeta } from './audit-entry.entity';
import type { Customer, CustomerMeta } from './customer.entity';
import type {
  ImpersonationSession,
  ImpersonationSessionMeta,
} from './impersonation-session.entity';
import type { Otp } from './otp.entity';
import type { OwnerProfileFields, User, UserMeta } from './user.entity';

type IsNever<T> = [T] extends [never] ? true : false;
/** `true` only when `A` and `B` are the same type (not merely mutually assignable). */
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
/** `true` when EVERY variant of the union is flat (distributes over `E`). */
type EveryVariantFlat<E> = E extends unknown ? AllTrue<NoNested<E>> : never;

/* ── User = Meta & AccountLifecycle & SearchFields ─────────────────────── */

export const userNotNever: IsNever<User> = false;
export const userFlat: EveryVariantFlat<User> = true;
export const userDisjoint: [
  Disjoint<UserMeta, AccountLifecycle>,
  Disjoint<UserMeta, SearchFields>,
  Disjoint<AccountLifecycle, SearchFields>,
] = [true, true, true];

declare const user: User;
if (user.accountStatus === AccountStatus.Blocked) {
  void user.blockReason;
  void user.blockedUntilUtcMs;
}
if (user.accountStatus === AccountStatus.Active) {
  // @ts-expect-error — an active account has no block reason
  void user.blockReason;
}
// @ts-expect-error — the nested `{ kind }` status object is gone (Law 6)
void user.accountStatus.kind;
// @ts-expect-error — the `{ kind }` registration object became the plain tag `registrationState`
void user.registration;
// @ts-expect-error — no link to a customer on the account (D29: the link lives on the customer)
void user.customerId;

/* ── The provisioned stub is a User (F2-9) ─────────────────────────────── */

/** `RegistrationSystem.provision` answers the archetype itself — every key present, no second shape. */
export const stubIsUser: Equals<
  ReturnType<typeof RegistrationSystem.provision>,
  User
> = true;
declare const stub: ReturnType<typeof RegistrationSystem.provision>;
export const stubAsUser: User = stub;

/* ── OwnerProfileFields — the keys an owner's edit writes (F2-17) ──────── */

/**
 * Exactly the five keys `updateProfile` writes for the owner — no more, no
 * fewer (the rules' owner allowlist, until Phase 4a closed `users` to every
 * client write).
 */
export const ownerKeysAreTheAllowlist: Equals<
  keyof OwnerProfileFields,
  'firstName' | 'lastName' | 'birthDate' | 'searchName' | 'searchPrefixes'
> = true;
/** Each owner key fits the `User` key of the same name, so the patch is a valid root-key `Update`. */
export const ownerKeysFitUser: {
  readonly [
    K in keyof OwnerProfileFields
  ]: OwnerProfileFields[K] extends User[K] ? true : false;
} = {
  firstName: true,
  lastName: true,
  birthDate: true,
  searchName: true,
  searchPrefixes: true,
};
export const ownerFieldsFlat: AllTrue<NoNested<OwnerProfileFields>> = true;
declare const ownerFields: OwnerProfileFields;
// @ts-expect-error — the owner can never write roles (the Admin SDK's)
void ownerFields.roles;
// @ts-expect-error — nor a contact channel (the OTP contact change's)
void ownerFields.phone;
// @ts-expect-error — nor the account lifecycle
void ownerFields.accountStatus;

/* ── Otp — one flat archetype ───────────────────────────────────────────── */

export const otpNotNever: IsNever<Otp> = false;
export const otpFlat: EveryVariantFlat<Otp> = true;
declare const otp: Otp;
void otp.expiresAtUtcMs;
// @ts-expect-error — the pre-flatten `destinationType` is `otpDestinationType` (N15)
void otp.destinationType;

/* ── ImpersonationSession = Meta & ImpersonationLifecycle ───────────────── */

export const sessionNotNever: IsNever<ImpersonationSession> = false;
export const sessionFlat: EveryVariantFlat<ImpersonationSession> = true;
export const sessionDisjoint: Disjoint<
  ImpersonationSessionMeta,
  ImpersonationLifecycle
> = true;
declare const session: ImpersonationSession;
if (session.impersonationStatus === ImpersonationStatus.Ended) {
  void session.endedAtUtcMs;
  if (
    session.impersonationEndReason === ImpersonationEndReason.RevokedBySecurity
  ) {
    void session.revokedByUserId;
    void session.revocationNotes;
  }
  if (session.impersonationEndReason === ImpersonationEndReason.Expired) {
    // @ts-expect-error — an expired session names no ender
    void session.endedByUserId;
  }
}
if (session.impersonationStatus === ImpersonationStatus.Active) {
  // @ts-expect-error — an active session has no end stamp
  void session.endedAtUtcMs;
}

/* ── AuditEntry = Meta & Actor & AuditContext & AuditTargetRef ──────────── */

export const auditNotNever: IsNever<AuditEntry> = false;
export const auditFlat: EveryVariantFlat<AuditEntry> = true;
/** The six pairs — `auditAction` is the context's alone, never the meta's. */
export const auditDisjoint: [
  Disjoint<AuditEntryMeta, Actor>,
  Disjoint<AuditEntryMeta, AuditContext>,
  Disjoint<AuditEntryMeta, AuditTargetRef>,
  Disjoint<Actor, AuditContext>,
  Disjoint<Actor, AuditTargetRef>,
  Disjoint<AuditContext, AuditTargetRef>,
] = [true, true, true, true, true, true];
/** The check is not vacuous: a meta repeating the verb would share a key. */
export const auditRepeatedVerbCaught: Disjoint<
  AuditEntryMeta & { readonly auditAction: AuditAction },
  AuditContext
> = false;

declare const row: AuditEntry;
if (row.actorRole === ActorRole.Impersonator) {
  void row.actorSessionId;
  void row.actorScope;
}
if (row.actorRole === ActorRole.System) {
  void row.actorSystemSource;
  // @ts-expect-error — a system actor names no account
  void row.actorUserId;
}
if (row.auditAction === AuditAction.OpsBackfill) {
  void row.backfillJobName;
  // @ts-expect-error — a backfill row has no placement location
  void row.placementLocationId;
}
if (row.auditAction === AuditAction.BookingCommitted) {
  void row.placementLocationId;
}
/** Every row names its operation (WS-4.4): an id, or `null` for a trigger or backfill row. */
export const auditOperationIdOf: OperationId | null = row.auditOperationId;
/** The operation slot is the meta's — a root field, never nested, never optional. */
export const auditOperationIdIsMeta: Equals<
  AuditEntryMeta['auditOperationId'],
  OperationId | null
> = true;

/*
 * The typed deltas (audit-hardening WS-2, RU-12): each delta slice is flat,
 * shares no field with its variant's head nor with any other slice of the
 * row, and each verb narrows to ITS delta fields only.
 */
type StaffEditHead = {
  readonly auditAction: unknown;
  readonly editRevision: unknown;
};
export const auditDeltaDisjoint: [
  Disjoint<StaffEditDelta, StaffEditHead>,
  Disjoint<RescheduleDelta, AuditEntryMeta>,
  Disjoint<RescheduleDelta, Actor>,
  Disjoint<RescheduleDelta, AuditTargetRef>,
  Disjoint<StaffEditDelta, AuditEntryMeta>,
  Disjoint<StaffEditDelta, Actor>,
  Disjoint<StaffEditDelta, AuditTargetRef>,
  Disjoint<TipDelta, AuditEntryMeta>,
  Disjoint<TipDelta, Actor>,
  Disjoint<TipDelta, AuditTargetRef>,
  Disjoint<TransitionDelta, AuditEntryMeta>,
  Disjoint<TransitionDelta, Actor>,
  Disjoint<TransitionDelta, AuditTargetRef>,
  Disjoint<CancellationDelta, AuditEntryMeta>,
  Disjoint<CancellationDelta, Actor>,
  Disjoint<CancellationDelta, AuditTargetRef>,
  Disjoint<RescheduleDelta, StaffEditDelta>,
  Disjoint<TransitionDelta, CancellationDelta>,
  Disjoint<TipDelta, StaffEditDelta>,
] = [
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
];
export const auditDeltaFlat: [
  AllTrue<NoNested<RescheduleDelta>>,
  AllTrue<NoNested<StaffEditDelta>>,
  AllTrue<NoNested<TipDelta>>,
  AllTrue<NoNested<TransitionDelta>>,
  AllTrue<NoNested<CancellationDelta>>,
] = [true, true, true, true, true];
/** The nullable tag field, pinned here (the L8 pair regex reads one dictionary name only). */
export const transitionFromAttendanceStateIs: Equals<
  TransitionDelta['transitionFromAttendanceState'],
  AttendanceState | null
> = true;
if (row.auditAction === AuditAction.BookingRescheduled) {
  void row.rescheduleFromLocalDate;
  void row.rescheduleToBarberIds;
  void row.rescheduleToLocationId;
  // @ts-expect-error — a client move carries no staff-edit delta
  void row.editRepriceFromCents;
}
if (row.auditAction === AuditAction.BookingStaffReprice) {
  void row.editRepriceFromCents;
  void row.editDiscountIds;
  void row.editMoveToStartMinutes;
  // @ts-expect-error — a staff edit carries no client-move delta
  void row.rescheduleToLocalDate;
}
if (row.auditAction === AuditAction.BookingTipRecorded) {
  void row.tipAmountCents;
  void row.tipFromCents;
  void row.tipCurrency;
  // @ts-expect-error — a tip carries no transition delta
  void row.transitionFromBookingStatus;
}
if (row.auditAction === AuditAction.BookingStaffNoShow) {
  void row.transitionFromBookingStatus;
  void row.transitionFromStatusAtUtcMs;
  void row.transitionFromAttendanceState;
  // @ts-expect-error — a staff transition carries no client-cancel delta
  void row.cancellationFromBookingStatus;
}
if (row.auditAction === AuditAction.BookingCancelled) {
  void row.cancellationFromBookingStatus;
  void row.cancellationFromStatusAtUtcMs;
  // @ts-expect-error — a client cancel carries no tip delta
  void row.tipAmountCents;
}
if (row.auditAction === AuditAction.BookingStaffArrived) {
  // @ts-expect-error — an arrival is the verb alone: no delta
  void row.transitionFromBookingStatus;
}
/*
 * The privileged and governed rows (audit-hardening WS-3): each verb narrows
 * to its own fields, and the profile row's role / status tags are nullable
 * closed vocabularies (pinned here — the L8 pair regex reads one dictionary
 * name only).
 */
export const profileRolesAre: [
  Equals<AuditContext.Profile['profileRolesFrom'], readonly Role[] | null>,
  Equals<AuditContext.Profile['profileRolesTo'], readonly Role[] | null>,
  Equals<
    AuditContext.Profile['profileAccountStatusFrom'],
    AccountStatus | null
  >,
  Equals<AuditContext.Profile['profileAccountStatusTo'], AccountStatus | null>,
  Equals<AuditContext.Profile['profileFields'], readonly AuditedProfileField[]>,
] = [true, true, true, true, true];
if (row.auditAction === AuditAction.ProfileUpdated) {
  void row.profileFields;
  void row.profileRolesTo;
  void row.profileAccountStatusFrom;
  // @ts-expect-error — a profile row names no governed collection
  void row.governedCollection;
}
if (row.auditAction === AuditAction.GovernanceImpersonationStarted) {
  const session: ImpersonationSessionId = row.impersonationSessionId;
  const expires: UtcEpochMs = row.impersonationExpiresAtUtcMs;
  void session;
  void expires;
  void row.impersonationScope;
  // @ts-expect-error — a start has no end reason
  void row.impersonationEndReason;
  // @ts-expect-error — the session's free-text reason is never on a row (T5, R36)
  void row.reason;
}
if (row.auditAction === AuditAction.GovernanceImpersonationEnded) {
  void row.impersonationEndReason;
  void row.impersonationSessionId;
  // @ts-expect-error — nor its revocation notes
  void row.revocationNotes;
}
if (row.auditAction === AuditAction.GovernedDocDeleted) {
  const collection: GovernedCollection = row.governedCollection;
  const fields: readonly string[] = row.governedFields;
  void collection;
  void fields;
  // @ts-expect-error — a governed row carries no profile field list
  void row.profileFields;
}
/*
 * The sign-in rows (audit-hardening Phase 3 WS-B, P3-DEP-7): each verb
 * narrows to its own fields, every variant is flat, and the new context
 * fields are disjoint from the actor, target and meta slices — tags, counts
 * and the expiry only; the challenge's destination, hash and salt are never
 * on a row (R36 / T5).
 */
export const identityContextsFlat: [
  AllTrue<NoNested<AuditContext.OtpRequested>>,
  AllTrue<NoNested<AuditContext.OtpVerified>>,
  AllTrue<NoNested<AuditContext.OtpRefused>>,
  AllTrue<NoNested<AuditContext.SessionIssued>>,
  AllTrue<NoNested<AuditContext.RegistrationCompleted>>,
] = [true, true, true, true, true];
/** Each identity variant minus its verb, against the three other slices of the row. */
type IdentityFacts =
  | Omit<AuditContext.OtpRequested, 'auditAction'>
  | Omit<AuditContext.OtpVerified, 'auditAction'>
  | Omit<AuditContext.OtpRefused, 'auditAction'>
  | Omit<AuditContext.SessionIssued, 'auditAction'>
  | Omit<AuditContext.RegistrationCompleted, 'auditAction'>;
export const identityContextsDisjoint: [
  Disjoint<Omit<AuditContext.OtpRequested, 'auditAction'>, Actor>,
  Disjoint<Omit<AuditContext.OtpVerified, 'auditAction'>, Actor>,
  Disjoint<Omit<AuditContext.OtpRefused, 'auditAction'>, Actor>,
  Disjoint<Omit<AuditContext.SessionIssued, 'auditAction'>, Actor>,
  Disjoint<Omit<AuditContext.RegistrationCompleted, 'auditAction'>, Actor>,
  Disjoint<IdentityFacts, AuditTargetRef>,
  Disjoint<IdentityFacts, AuditEntryMeta>,
] = [true, true, true, true, true, true, true];
/** The check is not vacuous: a context repeating the target's id would share a key. */
export const identityTargetRepeatCaught: Disjoint<
  Omit<AuditContext.SessionIssued, 'auditAction'> & {
    readonly targetUserId: UserId;
  },
  AuditTargetRef
> = false;
export const identityFieldsAre: [
  Equals<AuditContext.OtpRequested['otpExpiresAtUtcMs'], UtcEpochMs>,
  Equals<AuditContext.OtpVerified['otpAttemptCount'], number>,
  Equals<AuditContext.OtpRefused['otpAttemptCount'], number>,
  Equals<AuditContext.OtpRefused['otpMaxAttempts'], number>,
] = [true, true, true, true];
if (row.auditAction === AuditAction.IdentityOtpRequested) {
  const expires: UtcEpochMs = row.otpExpiresAtUtcMs;
  void expires;
  void row.otpDestinationType;
  void row.otpPurpose;
  // @ts-expect-error — a request has no refusal reason
  void row.otpRefusalReason;
  // @ts-expect-error — the destination (a phone or an e-mail) is never on a row (R36)
  void row.destination;
  // @ts-expect-error — nor the code's hash
  void row.codeHash;
}
if (row.auditAction === AuditAction.IdentityOtpVerified) {
  const attempts: number = row.otpAttemptCount;
  void attempts;
  // @ts-expect-error — a verification carries no limit
  void row.otpMaxAttempts;
}
if (row.auditAction === AuditAction.IdentityOtpRefused) {
  const reason: OtpRefusalReason = row.otpRefusalReason;
  void reason;
  void row.otpAttemptCount;
  void row.otpMaxAttempts;
  // @ts-expect-error — a refusal carries no expiry
  void row.otpExpiresAtUtcMs;
}
if (row.auditAction === AuditAction.IdentitySessionIssued) {
  const kind: SessionKind = row.sessionKind;
  void kind;
  void row.otpDestinationType;
  // @ts-expect-error — a session row names no purpose
  void row.otpPurpose;
}
if (row.auditAction === AuditAction.IdentityRegistrationCompleted) {
  const channel: IdentifierChannel = row.registrationIdentifierChannel;
  void channel;
  // @ts-expect-error — a registration row names no challenge channel
  void row.otpDestinationType;
  // @ts-expect-error — nor any profile field (the users trigger's row does that)
  void row.profileFields;
}
/*
 * The data-subject export row (audit-hardening Phase 3 WS-C, P3-DEP-10):
 * flat, counts only, disjoint from the actor, target and meta slices — the
 * bundle, a section or a value of the person is never on a row (R36 / T5).
 */
export const clientExportedFlat: AllTrue<
  NoNested<AuditContext.ClientExported>
> = true;
export const clientExportedDisjoint: [
  Disjoint<Omit<AuditContext.ClientExported, 'auditAction'>, Actor>,
  Disjoint<Omit<AuditContext.ClientExported, 'auditAction'>, AuditTargetRef>,
  Disjoint<Omit<AuditContext.ClientExported, 'auditAction'>, AuditEntryMeta>,
] = [true, true, true];
/** The check is not vacuous: an export row repeating the target's record id would share a key. */
export const clientExportedTargetRepeatCaught: Disjoint<
  Omit<AuditContext.ClientExported, 'auditAction'> & {
    readonly targetCustomerId: CustomerId;
  },
  AuditTargetRef
> = false;
export const clientExportedFieldsAre: [
  Equals<AuditContext.ClientExported['exportDocumentCount'], number>,
  Equals<AuditContext.ClientExported['exportAuditRowCount'], number>,
  Equals<AuditContext.ClientExported['exportByteCount'], number>,
] = [true, true, true];
export const auditEntryWithExportNotNever: IsNever<
  Extract<AuditEntry, { readonly auditAction: 'PRIVACY_CLIENT_EXPORTED' }>
> = false;
if (row.auditAction === AuditAction.PrivacyClientExported) {
  const documents: number = row.exportDocumentCount;
  void documents;
  void row.exportAuditRowCount;
  void row.exportByteCount;
  // @ts-expect-error — an export row carries no profile field list
  void row.profileFields;
  // @ts-expect-error — nor the bundle's text
  void row.exportJson;
  // @ts-expect-error — nor a governed field list
  void row.governedFields;
}
if (row.auditTarget === AuditTarget.User) {
  const target: UserId = row.targetUserId;
  void target;
}
if (row.auditTarget === AuditTarget.Customer) {
  const target: CustomerId = row.targetCustomerId;
  void target;
  // @ts-expect-error — a customer target is never a user (D29)
  void row.targetUserId;
}

/* ── Customer = Meta & WriteProvenance (D29, WS-4.3) ───────────────────── */

export const customerNotNever: IsNever<Customer> = false;
export const customerFlat: EveryVariantFlat<Customer> = true;
export const customerProvenanceDisjoint: Disjoint<
  CustomerMeta,
  WriteProvenance
> = true;
declare const customer: Customer;
const customerWriteOperationId: OperationId | null = customer.writeOperationId;
void customerWriteOperationId;
// @ts-expect-error — a CustomerId is never a UserId (Law 7.4, D29)
export const customerIdIsNotUser: UserId = customer.id;
// @ts-expect-error — a UserId is never a CustomerId (Law 7.4, D29)
export const userIdIsNotCustomer: CustomerId = user.id;
