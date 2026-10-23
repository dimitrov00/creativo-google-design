import {
  type OtpCode,
  ParsedIdentifier,
  SessionKind,
  WriteOp,
} from '@core/components';
import { type OtpId, Result, type UserId } from '@core/primitives';
import {
  IdentityError,
  PipelineError,
  PipelineErrorCode,
  type RepositoryError,
} from '@core/errors';
import { Collections, type Otp, type User } from '@core/entities';
import type {
  AuthAdminPorts,
  AuthUserLookupPorts,
  ClockPorts,
  CommitPorts,
  OtpCryptoPorts,
  TelemetryPorts,
  UserLookupPorts,
} from '@core/ports';
import { type OtpAttempt, OtpSystem, RegistrationSystem } from '@core/systems';
import { parseContactPhone } from './booking-read-set.pipeline';
import { runWithCreateRetry } from './customer-records.pipeline';

/**
 * `verifyOtp` — a typed code against its challenge, and the session it
 * signs into (blueprint §4.1; identity flip (2), F2-9): today's
 * `VerifyOtpUseCase` and the `verifyOtpChallenge` handler, as two
 * transactions around the account lookup.
 *
 * - **tx 1 — the attempt.** `otps/{otpId}` is read inside the transaction,
 *   the typed code is hashed and compared in the read half (`codeMatches`,
 *   constant time), and `OtpSystem.attempt` decides. The decision ALWAYS
 *   answers ok with its plan — `attemptCount` on a wrong code,
 *   `consumedAtUtcMs` on success, nothing for a consumed, expired or locked
 *   challenge — and the verdict rides beside it, so a wrong code's
 *   increment COMMITS and the refusal is answered after (a `Result.err`
 *   from decide would write nothing and silently disable the lock-out).
 *   Root-key `Update`s only: the expiry (and so `purgeAt`) never moves.
 * - **Outside.** The stored destination re-parsed on its channel
 *   (`IDENTITY_OTP_DESTINATION_CORRUPTED` when it no longer parses, F2-10),
 *   then the account holding it (`findUserByDestination`). Found: a
 *   RETURNING session minted from that account as stored.
 * - **tx 2 — a new identity only.** The Auth user is provisioned for the
 *   destination; when Auth refuses because one already holds it (the
 *   first-verification race, or an orphan Auth user), that uid is resolved
 *   (`findAuthUserByDestination`). `users/{uid}` is read inside the
 *   transaction and `RegistrationSystem.adoptStub` decides for EVERY uid:
 *   absent → the flat `PROVISIONED` stub is created; a `PROVISIONED` stub of
 *   this same contact → no write; `REGISTERED`, or another contact →
 *   `IDENTITY_OTP_ACCOUNT_CONFLICT`, nothing written (never a sign-in into
 *   someone else's account). A stub `Create` that loses its race at commit
 *   (`ALREADY_EXISTS`) re-runs tx 2 ONCE (`runWithCreateRetry`), which
 *   re-reads the winner's stub and plans no write; a second conflict is the
 *   answer. A NEW session minted from the in-transaction body.
 *
 * The claims always come from the account the session signs into — the
 * stored roles once registered (an out-of-band staff grant reaches the
 * token), plain `client` for a registered account with none, onboarding
 * before that (`RegistrationSystem.claimsFor`) — and the tenant from the
 * challenge.
 */

export type VerifyOtpPorts = CommitPorts &
  ClockPorts &
  OtpCryptoPorts &
  UserLookupPorts &
  AuthUserLookupPorts &
  AuthAdminPorts &
  TelemetryPorts;

export type VerifyOtpCommand = {
  readonly otpId: OtpId;
  readonly code: OtpCode;
};

export type VerifyOtpAnswer = {
  /** The custom token the client signs in with — the ONLY place it is answered. */
  readonly customToken: string;
  /** `NEW` when no account held the destination, else `RETURNING`. */
  readonly sessionKind: SessionKind;
};

/** A refusal (`IdentityError`), a store failure, or an Admin-Auth failure. */
export type VerifyOtpError = IdentityError | RepositoryError | PipelineError;

/** What tx 1 read: the challenge, and whether the typed code matches its hash. */
type AttemptRead = {
  readonly otp: Otp;
  readonly codeMatches: boolean;
} | null;

/** What tx 1 decided: the verdict, answered after the commit, and the plan that commits regardless. */
type AttemptDecision = {
  readonly verdict: Result<Otp, IdentityError>;
  readonly writes: readonly WriteOp[];
};

/** What tx 2 decided: the account the session signs into, and the stub `Create` when it was absent. */
type AdoptionDecision = {
  readonly user: User;
  readonly writes: readonly WriteOp[];
};

/**
 * The root-key `Update` an attempt's write implies: the consumption stamp
 * on success, the recorded wrong code otherwise — never a `Set`, so the
 * expiry (and its `purgeAt`) is never re-stamped.
 */
function attemptWrites(otpId: OtpId, attempt: OtpAttempt): readonly WriteOp[] {
  if (attempt.write === null) return [];
  const path = [Collections.Otps, otpId];
  return attempt.result.ok
    ? [WriteOp.update(path, { consumedAtUtcMs: attempt.write.consumedAtUtcMs })]
    : [WriteOp.update(path, { attemptCount: attempt.write.attemptCount })];
}

export const verifyOtp =
  (ports: VerifyOtpPorts) =>
  async (
    cmd: VerifyOtpCommand,
  ): Promise<Result<VerifyOtpAnswer, VerifyOtpError>> => {
    // Read once, before the transaction: `decide` may run more than once.
    const nowUtcMs = ports.nowUtcMs();

    // ── tx 1: the attempt ────────────────────────────────────────────────
    const attempted = await ports.commit(
      async (tx): Promise<AttemptRead> => {
        const otp = await tx.get<Otp>([Collections.Otps, cmd.otpId]);
        if (otp === null) return null;
        return {
          otp,
          codeMatches: ports.otpCrypto.codeMatches(
            cmd.code,
            otp.salt,
            otp.codeHash,
          ),
        };
      },
      (read): Result<AttemptDecision, never> => {
        if (read === null) {
          return Result.ok({
            verdict: Result.err(IdentityError.otpNotFound()),
            writes: [],
          });
        }
        const attempt = OtpSystem.attempt(read.otp, read.codeMatches, nowUtcMs);
        return Result.ok({
          verdict: attempt.result,
          writes: attemptWrites(read.otp.id, attempt),
        });
      },
    );
    if (!attempted.ok) return attempted;
    const verdict = attempted.value.verdict;
    if (!verdict.ok) return verdict;
    const otp = verdict.value;

    // ── outside: the destination and the account holding it ────────────
    const parsed = ParsedIdentifier.parse(
      ParsedIdentifier.channelOfDestination(otp.otpDestinationType),
      otp.destination,
      parseContactPhone,
    );
    if (!parsed.ok) {
      return Result.err(IdentityError.otpDestinationCorrupted());
    }
    const destination = parsed.value;

    const found = await ports.findUserByDestination(destination);
    if (!found.ok) return found;

    let user: User;
    let sessionKind: SessionKind;
    if (found.value !== null) {
      user = found.value;
      sessionKind = SessionKind.Returning;
    } else {
      const resolved = await authUidFor(ports, destination);
      if (!resolved.ok) return resolved;
      const uid = resolved.value;

      // ── tx 2: the stub, created only when absent ─────────────────────
      const userPath = [Collections.Users, uid];
      const adopted = await runWithCreateRetry(
        () =>
          ports.commit(
            (tx) => tx.get<User>(userPath),
            (stored): Result<AdoptionDecision, IdentityError> => {
              const decision = RegistrationSystem.adoptStub(
                stored,
                uid,
                destination,
              );
              if (!decision.ok) return decision;
              const { id, ...body } = decision.value.user;
              return Result.ok({
                user: decision.value.user,
                writes: decision.value.createStub
                  ? [WriteOp.create([Collections.Users, id], body)]
                  : [],
              });
            },
          ),
        [Collections.Users],
      );
      if (!adopted.ok) {
        ports.log('warn', 'otp.verify.adoption_refused', {
          uid,
          errorCode: adopted.error.errorCode,
        });
        return adopted;
      }
      user = adopted.value.user;
      sessionKind = SessionKind.New;
    }

    const token = await ports.mintCustomToken(
      user.id,
      RegistrationSystem.claimsFor(
        user.registrationState,
        user.roles,
        otp.tenantId,
      ),
    );
    if (!token.ok) return token;
    return Result.ok({ customToken: token.value, sessionKind });
  };

/**
 * The Auth uid of a destination no account holds: a new Auth user, or —
 * when Auth already holds the destination (the race's winner, an orphan) —
 * that user. Nobody found after the refusal (deleted in between) is an Auth
 * failure, as any provisioning failure is today.
 */
async function authUidFor(
  ports: AuthAdminPorts & AuthUserLookupPorts,
  destination: ParsedIdentifier,
): Promise<Result<UserId, PipelineError>> {
  const provisioned = await ports.provisionAuthUser(destination);
  if (!provisioned.ok) return provisioned;
  if (provisioned.value !== null) return Result.ok(provisioned.value);
  const held = await ports.findAuthUserByDestination(destination);
  if (!held.ok) return held;
  return held.value === null
    ? Result.err(PipelineError.bare(PipelineErrorCode.Unknown))
    : Result.ok(held.value);
}
