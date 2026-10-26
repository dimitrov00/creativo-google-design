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
  type Actor,
  ActorRole,
  AuditAction,
  type AuditContext,
  AuditTarget,
  type AuditTargetRef,
  type CancellationDelta,
  ImpersonationEndReason,
  type ImpersonationLifecycle,
  ImpersonationStatus,
  type RescheduleDelta,
  type SearchFields,
  type StaffEditDelta,
  type TipDelta,
  type TransitionDelta,
} from '@core/components';
import type {
  AttendanceState,
  CustomerId,
  OperationId,
  UserId,
} from '@core/primitives';
import type { RegistrationSystem } from '@core/systems';
import type { AllTrue, Disjoint, NoNested } from '@core/testing';
import type { AuditEntry, AuditEntryMeta } from './audit-entry.entity';
import type { Customer } from './customer.entity';
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

/* ── Customer — one flat archetype (D29) ───────────────────────────────── */

export const customerNotNever: IsNever<Customer> = false;
export const customerFlat: EveryVariantFlat<Customer> = true;
declare const customer: Customer;
// @ts-expect-error — a CustomerId is never a UserId (Law 7.4, D29)
export const customerIdIsNotUser: UserId = customer.id;
// @ts-expect-error — a UserId is never a CustomerId (Law 7.4, D29)
export const userIdIsNotCustomer: CustomerId = user.id;
