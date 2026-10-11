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
  ImpersonationEndReason,
  type ImpersonationLifecycle,
  ImpersonationStatus,
  type SearchFields,
} from '@core/components';
import type { CustomerId, UserId } from '@core/primitives';
import type { AllTrue, Disjoint, NoNested } from '@core/testing';
import type { AuditEntry, AuditEntryMeta } from './audit-entry.entity';
import type { Customer } from './customer.entity';
import type {
  ImpersonationSession,
  ImpersonationSessionMeta,
} from './impersonation-session.entity';
import type { Otp } from './otp.entity';
import type { User, UserMeta } from './user.entity';

type IsNever<T> = [T] extends [never] ? true : false;
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
