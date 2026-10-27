import {
  Actor,
  AuditAction,
  AuditContext,
  AuditTargetRef,
  type OtpRefusalReason,
  type SessionKind,
  SystemSource,
} from '@core/components';
import {
  AuditResourceId,
  defect,
  type IdentifierChannel,
  type OperationId,
  type UserId,
  type UtcEpochMs,
} from '@core/primitives';
import type { Otp } from '@core/entities';
import { type AuditRowPlan, AuditSystem } from './audit.system';

/** Who acts before any session exists — the sign-in callables themselves (P3-RU-10). */
const IDENTITY_CALLABLE: Actor.System = Actor.system(
  SystemSource.IdentityCallable,
);

/**
 * The sign-in half of the audit log (audit-hardening Phase 3 WS-B,
 * P3-DEP-7): the ONE row each identity act plans INSIDE the commit of the
 * pipeline that changes state — the challenge saved, consumed or charged a
 * wrong code; the token answered; the first registration completed. Every
 * planner picks its fields EXPLICITLY, never spreading an {@link Otp}: the
 * destination (a phone or an e-mail), the code hash and the salt never reach
 * a row (R36 / T5). Ids derive from state the commit proves
 * (`AuditSystem.changeKey`, P3-RU-7), so a retried attempt plans the same
 * id. The three PRE-SESSION rows (`_REQUESTED`, `_VERIFIED`, `_REFUSED`)
 * carry no operation id (P3-L-20: on an unauthenticated path the transport
 * id is caller-chosen text, and `auditLog` is permanent), target no account
 * (none is resolved yet — P3-RU-11) and name the challenge `otps/<id>`;
 * the session and registration rows name the account `users/<uid>` and its
 * operation. No clock, no I/O: `nowUtcMs` is a parameter.
 */
export const IdentityAuditSystem = {
  /** The actor of the pre-session rows and of the session row. */
  ACTOR: IDENTITY_CALLABLE,

  /** The row a saved challenge writes, stamped at its creation. */
  planOtpRequested(otp: Otp): AuditRowPlan {
    const action = AuditAction.IdentityOtpRequested;
    const resourceId = AuditResourceId.forOtp(otp.id);
    return {
      row: {
        recordedAtUtcMs: otp.createdAtUtcMs,
        resourceId,
        auditOperationId: null,
        ...IDENTITY_CALLABLE,
        ...AuditContext.otpRequested(
          otp.otpDestinationType,
          otp.otpPurpose,
          otp.expiresAtUtcMs,
        ),
        ...AuditTargetRef.none(),
      },
      idBasis: AuditSystem.idBasisOf(
        action,
        resourceId,
        null,
        AuditSystem.changeKey.otpRequested(otp.id),
      ),
    };
  },

  /**
   * The row a consumed challenge writes, stamped at its consumption; the
   * wrong codes recorded before the right one. An open challenge here is a
   * programmer defect — only `OtpSystem.attempt`'s success hands one over.
   */
  planOtpVerified(consumed: Otp): AuditRowPlan {
    if (consumed.consumedAtUtcMs === null) {
      return defect('a verified-challenge row needs a consumed challenge');
    }
    const action = AuditAction.IdentityOtpVerified;
    const resourceId = AuditResourceId.forOtp(consumed.id);
    return {
      row: {
        recordedAtUtcMs: consumed.consumedAtUtcMs,
        resourceId,
        auditOperationId: null,
        ...IDENTITY_CALLABLE,
        ...AuditContext.otpVerified(
          consumed.otpDestinationType,
          consumed.otpPurpose,
          consumed.attemptCount,
        ),
        ...AuditTargetRef.none(),
      },
      idBasis: AuditSystem.idBasisOf(
        action,
        resourceId,
        null,
        AuditSystem.changeKey.otpVerified(consumed.id),
      ),
    };
  },

  /**
   * The row a recorded wrong code writes: `recorded` is the challenge WITH
   * the attempt (`OtpSystem.attempt`'s write), so its count is the count
   * after this attempt — the id's key, distinct for every recorded attempt
   * and the same for a retried one; `reason` is
   * `OtpSystem.refusalReasonOf`'s answer.
   */
  planOtpRefused(
    recorded: Otp,
    reason: OtpRefusalReason,
    nowUtcMs: UtcEpochMs,
  ): AuditRowPlan {
    const action = AuditAction.IdentityOtpRefused;
    const resourceId = AuditResourceId.forOtp(recorded.id);
    return {
      row: {
        recordedAtUtcMs: nowUtcMs,
        resourceId,
        auditOperationId: null,
        ...IDENTITY_CALLABLE,
        ...AuditContext.otpRefused(
          recorded.otpDestinationType,
          recorded.otpPurpose,
          reason,
          recorded.attemptCount,
          recorded.maxAttempts,
        ),
        ...AuditTargetRef.none(),
      },
      idBasis: AuditSystem.idBasisOf(
        action,
        resourceId,
        null,
        AuditSystem.changeKey.otpRefused(recorded.id, recorded.attemptCount),
      ),
    };
  },

  /**
   * The row a sign-in token writes, AFTER the mint and before the answer
   * (P3-RU-12): on the account's timeline (`users/<uid>`, target the
   * account), keyed by the challenge it consumed, naming the call's
   * operation (`null` when the call sent none — RU-21).
   */
  planSessionIssued(
    otp: Otp,
    userId: UserId,
    sessionKind: SessionKind,
    operationId: OperationId | null,
    nowUtcMs: UtcEpochMs,
  ): AuditRowPlan {
    const action = AuditAction.IdentitySessionIssued;
    const resourceId = AuditResourceId.forUser(userId);
    return {
      row: {
        recordedAtUtcMs: nowUtcMs,
        resourceId,
        auditOperationId: operationId,
        ...IDENTITY_CALLABLE,
        ...AuditContext.sessionIssued(sessionKind, otp.otpDestinationType),
        ...AuditTargetRef.user(userId),
      },
      idBasis: AuditSystem.idBasisOf(
        action,
        resourceId,
        userId,
        AuditSystem.changeKey.sessionIssued(otp.id),
      ),
    };
  },

  /**
   * The row an account's FIRST registration writes, credited to the
   * verified caller (`Actor.forCaller` over the stored roles the transaction
   * read — the command carries none, P3-RU-10), on the account's timeline,
   * naming the call's operation. A re-run plans no row (the pipeline's
   * `Registration.isRegistered` check), so one key per account.
   */
  planRegistrationCompleted(
    userId: UserId,
    roles: readonly unknown[],
    channel: IdentifierChannel,
    operationId: OperationId | null,
    nowUtcMs: UtcEpochMs,
  ): AuditRowPlan {
    const action = AuditAction.IdentityRegistrationCompleted;
    const resourceId = AuditResourceId.forUser(userId);
    return {
      row: {
        recordedAtUtcMs: nowUtcMs,
        resourceId,
        auditOperationId: operationId,
        ...Actor.forCaller(userId, roles),
        ...AuditContext.registrationCompleted(channel),
        ...AuditTargetRef.user(userId),
      },
      idBasis: AuditSystem.idBasisOf(
        action,
        resourceId,
        userId,
        AuditSystem.changeKey.registration(userId),
      ),
    };
  },
} as const;
