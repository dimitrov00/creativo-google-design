/**
 * Compile-time-only assertions for the primitive-obsession ban (migration
 * blueprint §2.2). No runtime `expect()`/`it()` — excluded from the
 * Vitest glob (`*.type-spec.ts`), exists purely so `tsc` fails the build
 * if any signature below accidentally loosens back to a bare primitive
 * or a foreign brand. `declare function` (no body) so the fixture
 * signatures don't trip `no-unused-vars` on their parameters.
 */
import { AuditEntryId, ImpersonationSessionId } from './ids';

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
