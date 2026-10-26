import {
  AuthStrategy,
  AuthStrategyKind,
  type Identifier,
  type OtpDestinationType,
  type OtpPurpose,
  ParsedIdentifier,
} from '@core/components';
import {
  Result,
  type DurationMinutes,
  OtpId,
  type TenantId,
  UtcEpochMs,
} from '@core/primitives';
import { IdentityError, IdentityErrorCode } from '@core/errors';
import type { Otp } from '@core/entities';

/**
 * OtpSystem — the one-time-code challenge as pure math (blueprint §2.8),
 * ported from identity's legacy pure `Otp` (`otp.ts`, deleted in Phase 4b:
 * `issue`, `verify(codeMatches, now)`, `recordFailedAttempt`) and the
 * throttle and channel checks of `apps/functions/src/use-cases/
 * request-otp.use-case.ts`.
 *
 * No code, no salt and no hash is ever made here: the `OtpCrypto` port draws
 * the code and the salt and hashes them, and hands this system the
 * {@link HashedCode}; on verify the pipeline compares the typed code against
 * the stored hash through the same port and passes the `codeMatches`
 * boolean. The clock (`nowUtcMs`) and the id source (`nextId`) are
 * parameters. An OTP has no location, so no shop clock (flatten-spec F-5):
 * its TTL and resend window are T2 rows — lifecycle stamps compared and
 * added in elapsed real time through `UtcEpochMs.compare`/`plusMs` (and
 * the throttle's remainder through `elapsedMs`).
 */

const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60_000;

/** The figures this system applies — named, never magic numbers at a use site. */
export const OtpLimits = {
  /**
   * The resend throttle: one open challenge per destination per 60 seconds.
   * Server-side abuse throttling, deliberately NOT part of the deployment's
   * `AuthStrategy.OtpPolicy` (`request-otp.use-case.ts:25-28`), so a config
   * edit can never widen it by accident. The ONE source of the window
   * (owner ruling OR-9, 2026-10-26): the code step's resend countdown reads
   * this figure, and a throttled resend answers what is left of it
   * ({@link OtpSystem.retryAfterSeconds}).
   */
  ResendWindowSeconds: 60,
  /**
   * The send from which the code step escalates — from its third send of
   * one session it adds the escalation footnote (check spam, or try another
   * address; `auth-flow-design.md` §2.2). Owner ruling OR-10, 2026-10-26:
   * a threshold is a decision (Law 10.2), so it lives here and
   * {@link OtpSystem.escalates} answers it, never a template literal.
   */
  EscalateAfterSends: 3,
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
  readonly otpDestinationType: OtpDestinationType;
  readonly otpPurpose: OtpPurpose;
  readonly ttlMinutes: DurationMinutes;
  readonly maxAttempts: number;
};

/**
 * The four fields the verdict reads — an {@link Otp} satisfies it, and
 * `verify`/`recordAttempt`/`attempt` hand back the same type they were given
 * (a legacy class's counters, read through its shim, included).
 */
export type OtpCounters = Pick<
  Otp,
  'consumedAtUtcMs' | 'expiresAtUtcMs' | 'attemptCount' | 'maxAttempts'
>;

/**
 * What one verification attempt decided: the verdict, and the entity the
 * pipeline must persist — the consumed challenge on success, the challenge
 * with one more recorded attempt on `IDENTITY_OTP_WRONG_CODE`, and `null`
 * (nothing changed) on every other refusal. The verifyOtp transaction's
 * decide step, in one pure call (`verify-otp.use-case.ts:103-126`).
 */
export type OtpAttempt<O extends OtpCounters = Otp> = {
  readonly result: Result<O, IdentityError.Otp>;
  readonly write: O | null;
};

/** The two fields the resend throttle reads — an {@link Otp} satisfies it. */
type ResendFacts = Pick<Otp, 'consumedAtUtcMs' | 'createdAtUtcMs'>;

/**
 * The `createdAtUtcMs` of the newest still-open (unconsumed) challenge
 * created inside the resend window that starts at `sinceUtcMs`, or `null`
 * when none is — the one scan behind {@link OtpSystem.mayIssue} and
 * {@link OtpSystem.retryAfterSeconds}. Both conditions are re-checked here,
 * so a wider read can never loosen the throttle.
 */
function newestOpenUtcMs(
  open: readonly ResendFacts[],
  sinceUtcMs: UtcEpochMs,
): UtcEpochMs | null {
  let newest: UtcEpochMs | null = null;
  for (let i = 0; i < open.length; i++) {
    const otp = open[i] as ResendFacts;
    if (
      otp.consumedAtUtcMs === null &&
      UtcEpochMs.compare(otp.createdAtUtcMs, sinceUtcMs) >= 0 &&
      (newest === null || UtcEpochMs.compare(otp.createdAtUtcMs, newest) > 0)
    ) {
      newest = otp.createdAtUtcMs;
    }
  }
  return newest;
}

export const OtpSystem = {
  /**
   * A fresh challenge: `expiresAtUtcMs = nowUtcMs + ttlMinutes`, no attempt
   * recorded, not consumed, created now. Total — every input was validated
   * at its edge (the destination by `ParsedIdentifier.parse`, the policy by
   * `AuthStrategy.parse`, the hash by the crypto port).
   */
  issue(
    challenge: OtpChallenge,
    code: HashedCode,
    nowUtcMs: UtcEpochMs,
    nextId: () => string,
  ): Otp {
    return {
      id: OtpId.of(nextId()),
      tenantId: challenge.tenantId,
      destination: challenge.destination,
      otpDestinationType: challenge.otpDestinationType,
      otpPurpose: challenge.otpPurpose,
      codeHash: code.codeHash,
      salt: code.salt,
      expiresAtUtcMs: OtpSystem.expiresAtUtcMs(nowUtcMs, challenge.ttlMinutes),
      attemptCount: 0,
      maxAttempts: challenge.maxAttempts,
      consumedAtUtcMs: null,
      createdAtUtcMs: nowUtcMs,
    };
  },

  /** When a challenge issued at `nowUtcMs` under a `ttl` policy stops verifying. */
  expiresAtUtcMs(nowUtcMs: UtcEpochMs, ttl: DurationMinutes): UtcEpochMs {
    return UtcEpochMs.plusMs(nowUtcMs, ttl * MS_PER_MINUTE);
  },

  /**
   * The verdict, in the legacy order: already consumed → expired (strictly
   * past `expiresAtUtcMs`; the expiry instant itself still verifies) →
   * locked out (`attemptCount` reached `maxAttempts`, even with the right
   * code) → wrong code → the consumed challenge. Never records the attempt
   * itself: a wrong code is reported WITHOUT touching `attemptCount`, and
   * the pipeline calls {@link recordAttempt} (or {@link attempt}) to
   * persist it.
   */
  verify<O extends OtpCounters>(
    otp: O,
    codeMatches: boolean,
    nowUtcMs: UtcEpochMs,
  ): Result<O, IdentityError.Otp> {
    if (otp.consumedAtUtcMs !== null) {
      return Result.err(IdentityError.otpAlreadyConsumed());
    }
    if (UtcEpochMs.compare(nowUtcMs, otp.expiresAtUtcMs) > 0) {
      return Result.err(IdentityError.otpExpired());
    }
    if (otp.attemptCount >= otp.maxAttempts) {
      return Result.err(IdentityError.otpLockedOut());
    }
    if (!codeMatches) return Result.err(IdentityError.otpWrongCode());
    return Result.ok({ ...otp, consumedAtUtcMs: nowUtcMs });
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
    nowUtcMs: UtcEpochMs,
  ): OtpAttempt<O> {
    const result = OtpSystem.verify(otp, codeMatches, nowUtcMs);
    if (result.ok) return { result, write: result.value };
    return {
      result,
      write:
        result.error.errorCode === IdentityErrorCode.OtpWrongCode
          ? OtpSystem.recordAttempt(otp)
          : null,
    };
  },

  /**
   * The earliest `createdAtUtcMs` an open challenge may carry and still
   * throttle a resend — inclusive, as index #10's `>=` range reads it.
   */
  resendWindowStartUtcMs(nowUtcMs: UtcEpochMs): UtcEpochMs {
    return UtcEpochMs.plusMs(
      nowUtcMs,
      -OtpLimits.ResendWindowSeconds * MS_PER_SECOND,
    );
  },

  /**
   * Whether a new code may go to a destination now: no still-open challenge
   * (unconsumed) was created inside the resend window. `open` is what the
   * `LoadOpenOtps` port read for the destination; the scan re-checks both
   * conditions, so a wider read can never loosen the throttle.
   */
  mayIssue(open: readonly ResendFacts[], nowUtcMs: UtcEpochMs): boolean {
    return (
      newestOpenUtcMs(open, OtpSystem.resendWindowStartUtcMs(nowUtcMs)) === null
    );
  },

  /**
   * The whole seconds until a new code may go to the destination — what a
   * throttled resend answers (`IDENTITY_OTP_RATE_LIMITED`'s
   * `retryAfterSeconds`, OR-9), so the code step restarts its countdown
   * from the server's own figure: the time left on the NEWEST open,
   * unconsumed challenge's window, rounded up. `0` exactly when
   * {@link mayIssue} is true, and at least `1` while it is false — the
   * window's last instant still throttles (inclusive), so a refusal never
   * says "0 s". The same scan as {@link mayIssue}.
   */
  retryAfterSeconds(
    open: readonly ResendFacts[],
    nowUtcMs: UtcEpochMs,
  ): number {
    const newest = newestOpenUtcMs(
      open,
      OtpSystem.resendWindowStartUtcMs(nowUtcMs),
    );
    if (newest === null) return 0;
    const leftMs = UtcEpochMs.elapsedMs(
      nowUtcMs,
      UtcEpochMs.plusMs(newest, OtpLimits.ResendWindowSeconds * MS_PER_SECOND),
    );
    return Math.max(1, Math.ceil(leftMs / MS_PER_SECOND));
  },

  /**
   * Whether the code step escalates after `sendCount` sends of one session
   * — from the {@link OtpLimits.EscalateAfterSends}th on (OR-10).
   */
  escalates(sendCount: number): boolean {
    return sendCount >= OtpLimits.EscalateAfterSends;
  },

  /**
   * The deployment decides the ONE challenge channel: a phone-OTP deployment
   * must not be drivable over e-mail (and vice versa), and a magic-link
   * deployment issues no code challenges at all.
   */
  channelAccepts(
    strategy: Pick<AuthStrategy, 'authStrategyKind'>,
    otpDestinationType: OtpDestinationType,
  ): boolean {
    return (
      strategy.authStrategyKind !== AuthStrategyKind.EmailLink &&
      ParsedIdentifier.channelOfDestination(otpDestinationType) ===
        AuthStrategy.identifierKind(strategy)
    );
  },
} as const;
