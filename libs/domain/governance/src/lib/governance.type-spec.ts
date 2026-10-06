/**
 * Compile-time-only assertions for the primitive-obsession ban (migration
 * blueprint §2.2). No runtime `expect()`/`it()` — excluded from the
 * Vitest glob (`*.type-spec.ts`), exists purely so `tsc` fails the build
 * if any signature below accidentally loosens back to a bare primitive
 * or a foreign brand. `declare function` (no body) so the fixture
 * signatures don't trip `no-unused-vars` on their parameters.
 */
import { FeatureFlagKey } from './feature-flags';
import { AuditEntryId, ImpersonationSessionId } from './ids';
import type { UserId } from '@creativo/domain/accounts';
import { Actor, actorForCaller } from './actor';

// ── (a) a plain `string` is rejected where a branded ID is expected ──

declare function acceptsAuditEntryId(id: AuditEntryId): void;

// @ts-expect-error — a raw string must not satisfy the `AuditEntryId` brand.
acceptsAuditEntryId('audit_123');

declare const someAuditEntryId: AuditEntryId;
acceptsAuditEntryId(someAuditEntryId); // control: the branded value itself is accepted.

declare function acceptsImpersonationSessionId(
  id: ImpersonationSessionId,
): void;

// @ts-expect-error — same rejection for the other id brand in this context.
acceptsImpersonationSessionId('sess_123');

declare const someImpersonationSessionId: ImpersonationSessionId;
acceptsImpersonationSessionId(someImpersonationSessionId); // control.

// ── (b) this context's own branded ID types are not interchangeable
//    with each other, even though both just wrap a string ──

// @ts-expect-error — an `ImpersonationSessionId` must not substitute for
// an `AuditEntryId`.
acceptsAuditEntryId(someImpersonationSessionId);

// @ts-expect-error — and the reverse.
acceptsImpersonationSessionId(someAuditEntryId);

// ── (c) the flag vocabulary is exactly the R41 set (§12.1) — a key added
//    or dropped is a deliberate edit here too, and the retired `rewards.*`
//    keys no longer type-check ──

type ExpectedFeatureFlagKey =
  | 'client.profile'
  | 'client.pause'
  | 'loyalty.points'
  | 'loyalty.streaks'
  | 'loyalty.achievements'
  | 'loyalty.tiers'
  | 'client.support'
  | 'loyalty.selfView'
  | 'client.merge'
  | 'support.bulk'
  | 'client.privacy'
  | 'referrals.invitations'
  | 'discounts.grants';

declare function acceptsFlagRecord(record: Record<FeatureFlagKey, true>): void;
declare function acceptsExpectedFlagRecord(
  record: Record<ExpectedFeatureFlagKey, true>,
): void;
declare const flagRecord: Record<FeatureFlagKey, true>;
declare const expectedFlagRecord: Record<ExpectedFeatureFlagKey, true>;

// Both directions: together they pin the union to exactly the list above.
acceptsFlagRecord(expectedFlagRecord);
acceptsExpectedFlagRecord(flagRecord);

declare function acceptsFeatureFlagKey(key: FeatureFlagKey): void;

// @ts-expect-error — renamed to `loyalty.points` (R41).
acceptsFeatureFlagKey('rewards.points');

// @ts-expect-error — renamed to `loyalty.achievements` (R41).
acceptsFeatureFlagKey('rewards.achievements');

acceptsFeatureFlagKey('loyalty.selfView'); // control.

// ── (d) the `staff` actor is attributed by a validated id and a closed
//    role vocabulary — never a raw uid or a free-text role ──

declare const someUserId: UserId;

// @ts-expect-error — a raw uid must not satisfy `UserId` in attribution.
actorForCaller('uid_123', ['barber']);

actorForCaller(someUserId, ['barber']); // control: claims stay strings.

// @ts-expect-error — a role snapshot holds `UserRole`s, not free text.
Actor.staff(someUserId, ['superuser']);

Actor.staff(someUserId, ['barber', 'receptionist']); // control.
