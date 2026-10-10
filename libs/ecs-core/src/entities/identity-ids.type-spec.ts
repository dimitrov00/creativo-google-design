import { AuditEntryId } from './audit-entry.entity';
import { BackfillJobId } from './backfill-job.entity';
import { ClientMoneyStatsId } from './client-money-stats.entity';
import { ImpersonationSessionId } from './impersonation-session.entity';
import { OtpId } from './otp.entity';
import { PolicyRecomputeJobId } from './policy-recompute-job.entity';
import { UserId } from './user.entity';
import { Identifier } from '../components/identifier.data';
import { OtpCode } from '../components/otp-code.data';
import { TenantId } from '../components/tenant-id.data';

/**
 * Compile-time-only assertions for the accounts, identity and governance id
 * brands — no runtime `expect()`/`it()`, run by `nx typecheck` through
 * `tsconfig.spec.json`. Proves (a) a bare `string` cannot stand in for a
 * branded id, (b) the brands are not interchangeable although every one is a
 * plain string at run time, (c) `XId.of(raw)` is the way in and the brand
 * still reads as a string, and (d) the fixed document ids are brands too: their
 * one literal goes in through `of`, never bare.
 */

declare function requireUserId(id: UserId): void;
declare function requireOtpId(id: OtpId): void;
declare function requireImpersonationSessionId(
  id: ImpersonationSessionId,
): void;
declare function requireAuditEntryId(id: AuditEntryId): void;
declare function requireBackfillJobId(id: BackfillJobId): void;
declare function requireTenantId(id: TenantId): void;
declare function requireIdentifier(value: Identifier): void;
declare function requireOtpCode(value: OtpCode): void;
declare function requireMoneyDocId(id: ClientMoneyStatsId): void;
declare function requirePolicyJobId(id: PolicyRecomputeJobId): void;

// (a) A plain string is rejected where a branded id is expected.
// @ts-expect-error — a bare string is not a UserId; it must come from UserId.of().
requireUserId('u-1');
// @ts-expect-error — a bare string is not an OtpId.
requireOtpId('otp-1');
// @ts-expect-error — a bare string is not an ImpersonationSessionId.
requireImpersonationSessionId('sess-1');
// @ts-expect-error — a bare string is not an AuditEntryId.
requireAuditEntryId('row-1');
// @ts-expect-error — a bare string is not a BackfillJobId.
requireBackfillJobId('clientStats');
// @ts-expect-error — a bare string is not a TenantId.
requireTenantId('creativo');
// @ts-expect-error — a bare string is not an Identifier; it comes from ParsedIdentifier.parse at the edge.
requireIdentifier('client@example.com');
// @ts-expect-error — a bare string is not an OtpCode; it comes from OtpCode.parse.
requireOtpCode('123456');

// (b) The brands are nominal: none substitutes for another.
const userId = UserId.of('u-1');
const otpId = OtpId.of('otp-1');
const sessionId = ImpersonationSessionId.of('sess-1');
const auditId = AuditEntryId.of('row-1');
const backfillId = BackfillJobId.of('clientStats');
const tenantId = TenantId.of('creativo');

// @ts-expect-error — a UserId is not an OtpId.
requireOtpId(userId);
// @ts-expect-error — an OtpId is not a UserId.
requireUserId(otpId);
// @ts-expect-error — an ImpersonationSessionId is not a UserId.
requireUserId(sessionId);
// @ts-expect-error — an AuditEntryId is not an ImpersonationSessionId.
requireImpersonationSessionId(auditId);
// @ts-expect-error — a BackfillJobId is not an AuditEntryId.
requireAuditEntryId(backfillId);
// @ts-expect-error — a TenantId is not a UserId.
requireUserId(tenantId);

// (c) `of` is the way in, and a brand still reads as a string.
requireUserId(userId);
requireOtpId(otpId);
requireImpersonationSessionId(sessionId);
requireAuditEntryId(auditId);
requireBackfillJobId(backfillId);
requireTenantId(tenantId);
requireIdentifier(Identifier.of('client@example.com'));
requireOtpCode(OtpCode.of('123456'));
const asString: string = userId;
void asString;

// (d) The fixed document ids are brands: the literal goes in through `of`.
// @ts-expect-error — even the one right literal is not a ClientMoneyStatsId bare.
requireMoneyDocId('money');
requireMoneyDocId(ClientMoneyStatsId.of(ClientMoneyStatsId.FIXED));
// @ts-expect-error — the policy pass's id is not a BackfillJobId, one document over.
requireBackfillJobId(PolicyRecomputeJobId.of(PolicyRecomputeJobId.FIXED));
// @ts-expect-error — even the one right literal is not a PolicyRecomputeJobId bare.
requirePolicyJobId('clientStatsPolicy');
requirePolicyJobId(PolicyRecomputeJobId.of(PolicyRecomputeJobId.FIXED));
