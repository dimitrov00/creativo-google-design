import {
  AuthStrategy,
  AuthStrategyKind,
} from '../components/auth-strategy.data';
import { type Identifier, IdentifierKind } from '../components/identifier.data';
import {
  IdentityError,
  IdentityErrorCode,
} from '../components/identity-errors.data';
import { OtpDestinationType } from '../components/otp-destination-type.data';
import type { OtpPurpose } from '../components/otp-purpose.data';
import { Result } from '../components/result.data';
import type { TenantId } from '../components/tenant-id.data';
import { type OtpEntity, OtpId } from '../entities/otp.entity';

/**
 * OtpSystem — the one-time-code challenge as pure math (blueprint §2.8),
 * ported from identity's pure `Otp` (`libs/domain/identity/src/lib/otp.ts`:
 * `issue`, `verify(codeMatches, now)`, `recordFailedAttempt`) and the
 * throttle and channel checks of `apps/functions/src/use-cases/
 * request-otp.use-case.ts`.
 *
 * No code, no salt and no hash is ever made here: the `OtpCrypto` port draws
 * the code and the salt and hashes them, and hands this system the
 * {@link HashedCode}; on verify the pipeline compares the typed code against
 * the stored hash through the same port and passes the `codeMatches`
 * boolean. The clock (`nowMs`) and the id source (`nextId`) are parameters.
 */

const MS_PER_MINUTE = 60_000;

/** The figures this system applies — named, never magic numbers at a use site. */
export const OtpLimits = {
  /**
   * The resend throttle: one open challenge per destination per minute.
   * Server-side abuse throttling, deliberately NOT part of the deployment's
   * `OtpPolicy` (`request-otp.use-case.ts:25-28`), so a config edit can never
   * widen it by accident.
   */
  ResendWindowMinutes: 1,
} as const;

/** A code's salted hash, as the `OtpCrypto` port produced it. */
export type HashedCode = {
  readonly codeHash: string;
  readonly salt: string;
};

/**
 * What a new challenge is for, and under which policy — the deployment's
 * narrowed OTP strategy supplies `ttlMinutes` and `maxAttempts`
 * (`AuthStrategy.parse` already refused a non-positive figure).
 */
export type OtpChallenge = {
  readonly tenantId: TenantId;
  readonly destination: Identifier;
  readonly destinationType: OtpDestinationType;
  readonly purpose: OtpPurpose;
  readonly ttlMinutes: number;
  readonly maxAttempts: number;
};

/**
 * The four fields the verdict reads — an {@link OtpEntity} satisfies it, and
 * `verify`/`recordAttempt`/`attempt` hand back the same type they were given
 * (a legacy class's counters, read through its shim, included).
 */
export type OtpCounters = Pick<
  OtpEntity,
  'consumedAtMs' | 'expiresAtMs' | 'attemptCount' | 'maxAttempts'
>;

/**
 * What one verification attempt decided: the verdict, and the entity the
 * pipeline must persist — the consumed challenge on success, the challenge
 * with one more recorded attempt on `identity.otp.wrong_code`, and `null`
 * (nothing changed) on every other refusal. The verifyOtp transaction's
 * decide step, in one pure call (`verify-otp.use-case.ts:103-126`).
 */
export type OtpAttempt<O extends OtpCounters = OtpEntity> = {
  readonly result: Result<O, IdentityError.Otp>;
  readonly write: O | null;
};

/** The identifier kind a stored destination type is delivered over. */
function kindOf(destinationType: OtpDestinationType): IdentifierKind {
  return destinationType === OtpDestinationType.Sms
    ? IdentifierKind.Phone
    : IdentifierKind.Email;
}

export const OtpSystem = {
  /**
   * A fresh challenge: `expiresAtMs = nowMs + ttlMinutes`, no attempt
   * recorded, not consumed, created now. Total — every input was validated
   * at its edge (the destination by `ParsedIdentifier.parse`, the policy by
   * `AuthStrategy.parse`, the hash by the crypto port).
   */
  issue(
    challenge: OtpChallenge,
    code: HashedCode,
    nowMs: number,
    nextId: () => string,
  ): OtpEntity {
    return {
      id: OtpId.of(nextId()),
      tenantId: challenge.tenantId,
      destination: challenge.destination,
      destinationType: challenge.destinationType,
      purpose: challenge.purpose,
      codeHash: code.codeHash,
      salt: code.salt,
      expiresAtMs: OtpSystem.expiresAtMs(nowMs, challenge.ttlMinutes),
      attemptCount: 0,
      maxAttempts: challenge.maxAttempts,
      consumedAtMs: null,
      createdAtMs: nowMs,
    };
  },

  /** When a challenge issued at `nowMs` under a `ttlMinutes` policy stops verifying. */
  expiresAtMs(nowMs: number, ttlMinutes: number): number {
    return nowMs + ttlMinutes * MS_PER_MINUTE;
  },

  /**
   * The verdict, in the legacy order: already consumed → expired (strictly
   * past `expiresAtMs`; the expiry instant itself still verifies) → locked
   * out (`attemptCount` reached `maxAttempts`, even with the right code) →
   * wrong code → the consumed challenge. Never records the attempt itself:
   * a wrong code is reported WITHOUT touching `attemptCount`, and the
   * pipeline calls {@link recordAttempt} (or {@link attempt}) to persist it.
   */
  verify<O extends OtpCounters>(
    otp: O,
    codeMatches: boolean,
    nowMs: number,
  ): Result<O, IdentityError.Otp> {
    if (otp.consumedAtMs !== null) {
      return Result.err(IdentityError.otpAlreadyConsumed());
    }
    if (nowMs > otp.expiresAtMs) return Result.err(IdentityError.otpExpired());
    if (otp.attemptCount >= otp.maxAttempts) {
      return Result.err(IdentityError.otpLockedOut());
    }
    if (!codeMatches) return Result.err(IdentityError.otpWrongCode());
    return Result.ok({ ...otp, consumedAtMs: nowMs });
  },

  /** One more wrong code on record — a new entity, the input untouched. */
  recordAttempt<O extends OtpCounters>(otp: O): O {
    return { ...otp, attemptCount: otp.attemptCount + 1 };
  },

  /**
   * {@link verify} plus the write it implies: a wrong code is a real state
   * change (the lock-out must accrue for exactly the caller it exists to
   * stop), every other refusal changes nothing.
   */
  attempt<O extends OtpCounters>(
    otp: O,
    codeMatches: boolean,
    nowMs: number,
  ): OtpAttempt<O> {
    const result = OtpSystem.verify(otp, codeMatches, nowMs);
    if (result.ok) return { result, write: result.value };
    return {
      result,
      write:
        result.error.code === IdentityErrorCode.OtpWrongCode
          ? OtpSystem.recordAttempt(otp)
          : null,
    };
  },

  /** The earliest `createdAtMs` an open challenge may carry and still throttle a resend. */
  resendWindowStartMs(nowMs: number): number {
    return nowMs - OtpLimits.ResendWindowMinutes * MS_PER_MINUTE;
  },

  /**
   * Whether a new code may go to a destination now: no still-open challenge
   * (unconsumed) was created inside the resend window. `open` is what the
   * `LoadOpenOtps` port read for the destination; the scan re-checks both
   * conditions, so a wider read can never loosen the throttle.
   */
  mayIssue(open: readonly OtpEntity[], nowMs: number): boolean {
    const sinceMs = OtpSystem.resendWindowStartMs(nowMs);
    for (let i = 0; i < open.length; i++) {
      const otp = open[i] as OtpEntity;
      if (otp.consumedAtMs === null && otp.createdAtMs >= sinceMs) return false;
    }
    return true;
  },

  /**
   * The deployment decides the ONE challenge channel: a phone-OTP deployment
   * must not be drivable over e-mail (and vice versa), and a magic-link
   * deployment issues no code challenges at all.
   */
  channelAccepts(
    strategy: AuthStrategy,
    destinationType: OtpDestinationType,
  ): boolean {
    return (
      strategy.kind !== AuthStrategyKind.EmailLink &&
      kindOf(destinationType) === AuthStrategy.identifierKind(strategy)
    );
  },
} as const;
