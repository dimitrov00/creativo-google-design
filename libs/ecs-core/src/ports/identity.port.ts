import type { AuthClaims } from '../components/auth-claims.data';
import type { Identifier } from '../components/identifier.data';
import type { PipelineError } from '../components/pipeline-errors.data';
import type { RepositoryError } from '../components/repository-errors.data';
import type { Result } from '../components/result.data';
import type { TenantId } from '../components/tenant-id.data';
import type { OtpEntity, OtpId } from '../entities/otp.entity';
import type { UserEntity, UserId } from '../entities/user.entity';

/**
 * The identity context's server ports (blueprint §4.1 `requestOtp`,
 * `verifyOtp`, `completeRegistration`): the `otps` reads and write, the
 * users lookup by destination, the Admin-Auth calls, the login-OTP sender
 * and the OTP randomness. Outbound side channels (Auth, the sender) answer
 * `PipelineError`; storage reads answer `RepositoryError`.
 *
 * No `RequestContactChange`/`ConfirmContactChange`: §9 D12(b) — contact
 * change is not shipped, its adapter, port and use case are deleted in
 * Phase 4 with no successor.
 */

// ── OTP challenges ────────────────────────────────────────────────────────

/**
 * The tenant a new challenge belongs to (`OtpEntity.tenantId`, the token
 * claims) — today the single deployment's `DEFAULT_TENANT_ID`
 * (`lib/otp/tenant.ts`), a port so a second tenant changes the root, not the
 * pipeline.
 */
export type LoadTenant = () => Promise<Result<TenantId, RepositoryError>>;

/**
 * Every still-open challenge for one destination created at or after
 * `sinceMs` — `destination ==`, `consumedAtMs == null`, `createdAtMs >=`
 * (index #10; `findRecentUnconsumedByDestination`,
 * `otp-repository.port.ts`). OtpSystem decides from them whether a new
 * code may be issued; the port only reads.
 */
export type LoadOpenOtps = (
  destination: Identifier,
  sinceMs: number,
) => Promise<Result<readonly OtpEntity[], RepositoryError>>;

/** `otps/{id}` — `null` when absent (an unknown or purged challenge). */
export type LoadOtp = (
  id: OtpId,
) => Promise<Result<OtpEntity | null, RepositoryError>>;

/**
 * `otps/{id}` `Set` — the issued or updated challenge; the adapter stamps
 * the root `purgeAt` TTL (`expiresAtMs` + 24 h) beside the entity body.
 */
export type SaveOtp = (
  otp: OtpEntity,
) => Promise<Result<void, RepositoryError>>;

/**
 * Deliver a login code — the LOGIN-OTP sender identity, never shared with
 * a campaign sender (`console-otp-sender.adapter.ts` writes it through `Log`
 * today, as `console-otp-sender.ts` does).
 */
export type SendOtp = (
  destination: Identifier,
  code: string,
) => Promise<Result<void, PipelineError>>;

/**
 * The OTP's randomness and hashing (functions Q3): the pipeline draws a
 * code and a salt, hashes, and hands `OtpSystem.issue` the hash; on verify,
 * `hashCode` computes the `codeMatches` boolean `OtpSystem.verify` takes.
 * Implemented by `otp-crypto.adapter.ts` — node, and the fixed-code variant
 * for the emulator (today's `NodeOtpCrypto`/`FixedCodeOtpCrypto`).
 */
export type OtpCrypto = {
  readonly nextCode: () => string;
  readonly nextSalt: () => string;
  readonly hashCode: (code: string, salt: string) => string;
};

// ── Accounts by destination, and Admin Auth ───────────────────────────────

/**
 * The account holding a phone or e-mail — the single-field users query
 * `where('phone' | 'email', '==', value)` (`firestore-user-repository.ts:175`,
 * no composite); `null` when none does.
 */
export type FindUserByDestination = (
  destination: Identifier,
) => Promise<Result<UserEntity | null, RepositoryError>>;

/**
 * The Firebase Auth user holding a phone or e-mail
 * (`auth.getUserByPhoneNumber` / `getUserByEmail`); `null` when none does.
 * The first-verification race's resolver: after `ProvisionAuthUser` is
 * refused, the winner's uid is read HERE — the users query alone can be
 * `null` while the winner's stub is not written yet.
 */
export type FindAuthUserByDestination = (
  destination: Identifier,
) => Promise<Result<UserId | null, PipelineError>>;

/**
 * Create the Firebase Auth user for a first verification
 * (`auth.createUser({ phoneNumber | email })`) and answer its uid — the
 * stub's document id. `null` when Auth REFUSED because a user already holds
 * the destination (`auth/phone-number-already-exists`,
 * `auth/email-already-exists`): the race loser, who then resolves the winner
 * through {@link FindAuthUserByDestination}. Auth's uniqueness of phone and
 * e-mail is the race guard, not the users document.
 */
export type ProvisionAuthUser = (
  destination: Identifier,
) => Promise<Result<UserId | null, PipelineError>>;

/** A custom sign-in token carrying `claims` (the tenant rides inside them). */
export type MintCustomToken = (
  uid: UserId,
  claims: AuthClaims,
) => Promise<Result<string, PipelineError>>;

/** Replace the user's custom claims — `completeRegistration`'s flip to active. */
export type SetClaims = (
  uid: UserId,
  claims: AuthClaims,
) => Promise<Result<void, PipelineError>>;

/**
 * The identity context's port catalogue. The users stub `Create` and the
 * registered body `Update` are entries of a `CommitPlan` (`tx.port.ts`),
 * never a port of their own.
 */
export type IdentityPorts = {
  readonly loadTenant: LoadTenant;
  readonly loadOpenOtps: LoadOpenOtps;
  readonly loadOtp: LoadOtp;
  readonly saveOtp: SaveOtp;
  readonly sendOtp: SendOtp;
  readonly otpCrypto: OtpCrypto;
  readonly findUserByDestination: FindUserByDestination;
  readonly findAuthUserByDestination: FindAuthUserByDestination;
  readonly provisionAuthUser: ProvisionAuthUser;
  readonly mintCustomToken: MintCustomToken;
  readonly setClaims: SetClaims;
};
