import type {
  AuthClaims,
  Identifier,
  ParsedIdentifier,
} from '@core/components';
import type {
  PipelineError,
  RepositoryError,
  Result,
  OtpId,
  TenantId,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import type { AccountContact, Customer, Otp, User } from '@core/entities';

/**
 * The identity context's server ports (blueprint §4.1 `requestOtp`,
 * `verifyOtp`, `completeRegistration`): the `otps` reads and write, the
 * users lookup by destination, the customer record of an account (D29), the
 * Admin-Auth calls, the login-OTP sender and the OTP randomness. Outbound side channels (Auth, the sender) answer
 * `PipelineError`; storage reads answer `RepositoryError`.
 *
 * No `RequestContactChange`/`ConfirmContactChange`: §9 D12(b) — contact
 * change is not shipped, its adapter, port and use case are deleted in
 * Phase 4 with no successor.
 */

// ── OTP challenges ────────────────────────────────────────────────────────

/**
 * The tenant a new challenge belongs to (`Otp.tenantId`, the token
 * claims) — today the single deployment's `DEFAULT_TENANT_ID`
 * (`lib/otp/tenant.ts`), a port so a second tenant changes the root, not the
 * pipeline.
 */
export type LoadTenant = () => Promise<Result<TenantId, RepositoryError>>;

/**
 * Every still-open challenge for one destination created at or after
 * `sinceUtcMs` — `destination ==`, not consumed, created at or after
 * (index #10; `findRecentUnconsumedByDestination`,
 * `otp-repository.port.ts`). OtpSystem decides from them whether a new
 * code may be issued; the port only reads.
 */
export type LoadOpenOtps = (
  destination: Identifier,
  sinceUtcMs: UtcEpochMs,
) => Promise<Result<readonly Otp[], RepositoryError>>;

/** `otps/{id}` — `null` when absent (an unknown or purged challenge). */
export type LoadOtp = (
  id: OtpId,
) => Promise<Result<Otp | null, RepositoryError>>;

/**
 * `otps/{id}` `Set` — the issued or updated challenge; the adapter stamps
 * the root `purgeAt` TTL (`expiresAtUtcMs` + 24 h) beside the entity body.
 */
export type SaveOtp = (otp: Otp) => Promise<Result<void, RepositoryError>>;

/**
 * Deliver a login code — the LOGIN-OTP sender identity, never shared with
 * a campaign sender (`console-otp-sender.adapter.ts` writes it through `Log`
 * today, as `console-otp-sender.ts` does). The destination arrives parsed —
 * its channel is the `identifierChannel` the edge parse or the stored
 * `otpDestinationType` named (`ParsedIdentifier.ofDestination`) — so no
 * adapter ever infers an SMS from an e-mail by sniffing the string.
 */
export type SendOtp = (
  destination: ParsedIdentifier,
  code: string,
) => Promise<Result<void, PipelineError>>;

/**
 * The OTP's randomness and hashing (functions Q3): the pipeline draws a
 * code and a salt, hashes, and hands `OtpSystem.issue` the hash; on verify,
 * `codeMatches` answers the boolean `OtpSystem.verify` takes — the typed
 * code hashed with the stored salt and compared with the stored hash in
 * CONSTANT time (`timingSafeEqual`, as today's `NodeOtpCrypto.verify`), so
 * no pipeline ever compares two hashes with `===`. Implemented by
 * `otp-crypto.adapter.ts` — node, and the fixed-code variant for the
 * emulator (today's `NodeOtpCrypto`/`FixedCodeOtpCrypto`).
 */
export type OtpCrypto = {
  readonly nextCode: () => string;
  readonly nextSalt: () => string;
  readonly hashCode: (code: string, salt: string) => string;
  readonly codeMatches: (
    code: string,
    salt: string,
    expectedHash: string,
  ) => boolean;
};

// ── Accounts by destination, and Admin Auth ───────────────────────────────

/**
 * The account holding a phone or e-mail — the single-field users query
 * `where('phone' | 'email', '==', value)` (`firestore-user-repository.ts:175`,
 * no composite), the field picked by the parsed destination's
 * `identifierChannel`; `null` when none does.
 */
export type FindUserByDestination = (
  destination: ParsedIdentifier,
) => Promise<Result<User | null, RepositoryError>>;

/**
 * The client record of an account, OUTSIDE any transaction — `customers
 * where userId == uid limit 1` (the single-field index on `userId`, D29,
 * flatten-spec §5.5): what the web reads to learn the signed-in account's
 * `CustomerId`; `null` when the account has no record yet (every account
 * registered before the identity flip (2) that never booked). Inside a
 * booking or edit transaction the server reads `customers/{CustomerId.forUser
 * (uid, hash)}` by its derivable path through `ReadTx` instead, and creates
 * a missing one (`FIRST_BOOKING`) in that commit (F1-5).
 */
export type LoadCustomerForUser = (
  userId: UserId,
) => Promise<Result<Customer | null, RepositoryError>>;

/**
 * The FIRST_BOOKING contact snapshot (F1-5) — one NON-transactional
 * `getAll` of `users/{uid}` for the given accounts, read BEFORE the booking
 * or edit transaction opens, so `users/{uid}` never enters its conflict set
 * (a stale name in a first-booking copy is harmless). An account with no
 * document is absent from the map; the order of `userIds` is not kept.
 */
export type LoadAccountContacts = (
  userIds: readonly UserId[],
) => Promise<Result<ReadonlyMap<UserId, AccountContact>, RepositoryError>>;

/**
 * The Firebase Auth user holding a phone or e-mail
 * (`auth.getUserByPhoneNumber` / `getUserByEmail`); `null` when none does.
 * The first-verification race's resolver: after `ProvisionAuthUser` is
 * refused, the winner's uid is read HERE — the users query alone can be
 * `null` while the winner's stub is not written yet.
 */
export type FindAuthUserByDestination = (
  destination: ParsedIdentifier,
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
  destination: ParsedIdentifier,
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
 * The Auth user's display name — what the header/menu account monogram reads
 * through `AuthGateway.currentDisplayName()` (session-cached, no Firestore
 * read). `completeRegistration` calls it after the registered `Update` with
 * `"<firstName> <lastName>"` and IGNORES its Result — best-effort identity
 * chrome that must never fail a complete registration (the monogram falls
 * back to the identifier's initial), as today
 * (`complete-registration.use-case.ts:266-274`).
 */
export type SetDisplayName = (
  uid: UserId,
  displayName: string,
) => Promise<Result<void, PipelineError>>;

// ── Focused bundles (Law 9 — composed with `&`, never sliced) ─────────────

/** The signed-in account's client record — the bundle the web's `CUSTOMER_PORTS` token binds. */
export type CustomerPorts = {
  readonly loadCustomerForUser: LoadCustomerForUser;
};

/** The first-booking contact snapshot (F1-5) — `firestore-accounts.adapter.ts`. */
export type AccountContactPorts = {
  readonly loadAccountContacts: LoadAccountContacts;
};

/** The tenant's configuration. */
export type TenantPorts = {
  readonly loadTenant: LoadTenant;
};

/** The OTP challenges' store. */
export type OtpStorePorts = {
  readonly loadOpenOtps: LoadOpenOtps;
  readonly loadOtp: LoadOtp;
  readonly saveOtp: SaveOtp;
};

/** The login-OTP sender — never a campaign sender. */
export type OtpDeliveryPorts = {
  readonly sendOtp: SendOtp;
};

/** The OTP code's digest and comparison. */
export type OtpCryptoPorts = {
  readonly otpCrypto: OtpCrypto;
};

/** An account by its sign-in destination, in Firestore and in Auth. */
export type UserDirectoryPorts = {
  readonly findUserByDestination: FindUserByDestination;
  readonly findAuthUserByDestination: FindAuthUserByDestination;
};

/** Firebase Auth's admin writes — provision, token, claims, display name. */
export type AuthAdminPorts = {
  readonly provisionAuthUser: ProvisionAuthUser;
  readonly mintCustomToken: MintCustomToken;
  readonly setClaims: SetClaims;
  readonly setDisplayName: SetDisplayName;
};

/**
 * The identity context's whole port suite — an intersection of its
 * bundles. The users stub `Create` and the registered body `Update` are
 * entries of a `CommitPlan` (`tx.port.ts`), never a port of their own; so
 * is a `FIRST_BOOKING` customer `Create` (F1-5).
 */
export type IdentityPorts = CustomerPorts &
  AccountContactPorts &
  TenantPorts &
  OtpStorePorts &
  OtpDeliveryPorts &
  OtpCryptoPorts &
  UserDirectoryPorts &
  AuthAdminPorts;
