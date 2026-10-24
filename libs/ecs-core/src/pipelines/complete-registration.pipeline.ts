import {
  type BirthDate,
  CustomerOrigin,
  ParsedIdentifier,
  RegistrationField,
  type RegistrationFields,
  WriteOp,
} from '@core/components';
import {
  CustomerId,
  type IdentifierChannel,
  type LocalDate,
  Result,
  type UserId,
} from '@core/primitives';
import {
  type CompleteRegistrationRefusal,
  CompleteRegistrationRefusalCode,
  IdentityError,
  type PipelineError,
  type RepositoryError,
} from '@core/errors';
import { Collections, type Customer, Profile, type User } from '@core/entities';
import type {
  AuthAdminPorts,
  AuthDeploymentPorts,
  ClockPorts,
  CommitPorts,
  HashPorts,
  TelemetryPorts,
  TenantPorts,
  UserLookupPorts,
} from '@core/ports';
import {
  AgeSystem,
  CustomerRecordSystem,
  ProfileEditSystem,
  RegistrationSystem,
} from '@core/systems';
import { customerPath, parseContactPhone } from './booking-read-set.pipeline';
import { runWithCustomerRetry } from './customer-records.pipeline';

/**
 * `completeRegistration` — a provisioned account becomes a registered one
 * (blueprint §4.1; identity flip (2), F2-7b, F2-8): today's
 * `CompleteRegistrationUseCase` and handler, with the settle moved onto an
 * in-transaction read and the client record (D29) created beside it.
 *
 * The order is frozen, refusal by refusal: the caller's verified session
 * (the decoder, before the payload); the deployment strategy's required
 * fields, the login channel filling its own
 * (`IDENTITY_REGISTRATION_FIELD_MISSING`); a non-blank birth date through
 * `AgeSystem.parseIso` on the UTC civil date (F2-7) — its `IdentityError`
 * answered as is (the wire wraps it); the identifier parsed on its channel
 * (`IDENTITY_IDENTIFIER_INVALID`); then, OUTSIDE any transaction, the account
 * holding the identifier (`IDENTITY_REGISTRATION_USER_NOT_FOUND`) and that
 * it is the caller's own (`IDENTITY_REGISTRATION_FORBIDDEN`) — today's
 * classification, unchanged.
 *
 * The transaction reads `users/{uid}` and `customers/{CustomerId.forUser(uid,
 * hash)}` in ONE `getAll` and settles on THAT read (closing today's stale
 * read): `RegistrationSystem.settle` keeps what the server granted — roles,
 * the lifecycle (a re-run never lifts a pause), a registered account's
 * contact channels — and `ProfileEditSystem.registrationProfile` checks and
 * normalises the profile (every refusal collected, today's order) or refuses
 * it as the aggregate {@link CompleteRegistrationRefusal}. The plan: the
 * registered body as ONE `Set` (the entity minus `id`, exactly one
 * lifecycle variant — value-idempotent, so a re-run writes the same body),
 * plus the `REGISTRATION` client record when the read found none
 * (`CustomerRecordSystem.createsFor`). A record `Create` that loses its race
 * at commit re-runs the transaction once (`runWithCustomerRetry`).
 *
 * After the commit: the Auth display name (best-effort — its failure never
 * fails a complete registration, as today) and a fresh custom token with the
 * ACTIVE claims of the granted roles (never a hardcoded `client` that would
 * demote staff; never a `setClaims` beside it — the Auth emulator's next
 * sign-in breaks on a claims-set plus a mint for one uid).
 */

export type CompleteRegistrationPorts = CommitPorts &
  ClockPorts &
  HashPorts &
  UserLookupPorts &
  TenantPorts &
  AuthAdminPorts &
  AuthDeploymentPorts &
  TelemetryPorts;

export type CompleteRegistrationCommand = {
  /** The VERIFIED session's uid — registration is bound to it, never to the payload. */
  readonly callerUserId: UserId;
  /** The login channel the payload's `kind` names. */
  readonly identifierChannel: IdentifierChannel;
  /** The identifier's text as sent — the decoder refused it only when blank. */
  readonly rawIdentifier: string;
  /**
   * The about step's fields, every key present (`null` = not sent). The
   * birth date stays its raw `'YYYY-MM-DD'` text until here (the stated Law
   * 7.4 exception): its refusal needs the age day.
   */
  readonly fields: RegistrationFields;
};

export type CompleteRegistrationAnswer = {
  readonly customToken: string;
};

/** A refusal, a store failure, or the Admin-Auth mint failing. */
export type CompleteRegistrationError =
  IdentityError | CompleteRegistrationRefusal | RepositoryError | PipelineError;

/** The transaction's read: the account and its client record (`null` when absent). */
type RegistrationRead = {
  readonly stored: User | null;
  readonly customer: Customer | null;
};

/** The transaction's decision: the registered account, and its plan. */
type RegistrationDecision = {
  readonly registered: User;
  readonly writes: readonly WriteOp[];
};

/**
 * The OPTIONAL birthday: a blank (or absent) one is no birthday and skips
 * validation entirely; a present one must be a real date, in the past, age
 * 16–120 on `ageDay` (`AgeSystem.parseIso`).
 */
function submittedBirthDate(
  raw: string | null,
  ageDay: LocalDate,
): Result<BirthDate | null, IdentityError> {
  const trimmed = raw?.trim() ?? '';
  return trimmed.length === 0
    ? Result.ok(null)
    : AgeSystem.parseIso(trimmed, ageDay);
}

export const completeRegistration =
  (ports: CompleteRegistrationPorts) =>
  async (
    cmd: CompleteRegistrationCommand,
  ): Promise<Result<CompleteRegistrationAnswer, CompleteRegistrationError>> => {
    // The identifier satisfies whichever of phone/e-mail is the login
    // channel — the form never re-submits it.
    const fields = RegistrationSystem.effectiveFields(
      cmd.identifierChannel,
      cmd.rawIdentifier,
      cmd.fields,
    );
    const missing = RegistrationSystem.missingField(
      ports.authDeployment.strategy,
      fields,
    );
    if (missing !== null) {
      return Result.err(IdentityError.registrationFieldMissing(missing));
    }

    // The age window's day: the UTC civil date, derived once (F2-7).
    const nowUtcMs = ports.nowUtcMs();
    const ageDay = AgeSystem.judgedOn(nowUtcMs);

    const birth = submittedBirthDate(
      fields[RegistrationField.BirthDate],
      ageDay,
    );
    if (!birth.ok) return birth;
    const birthDate = birth.value;

    const parsed = ParsedIdentifier.parse(
      cmd.identifierChannel,
      cmd.rawIdentifier,
      parseContactPhone,
    );
    if (!parsed.ok) return parsed;

    // Outside the transaction, as today: not-found vs not-yours.
    const holder = await ports.findUserByDestination(parsed.value);
    if (!holder.ok) return holder;
    if (holder.value === null) {
      return Result.err(IdentityError.registrationUserNotFound());
    }
    if (holder.value.id !== cmd.callerUserId) {
      return Result.err(IdentityError.registrationForbidden());
    }

    const uid = cmd.callerUserId;
    const customerId = CustomerId.forUser(uid, ports.hash);
    const userPath = [Collections.Users, uid];
    const committed = await runWithCustomerRetry(() =>
      ports.commit(
        async (tx): Promise<RegistrationRead> => {
          const [stored, customer] = await tx.getAll<User | Customer>([
            userPath,
            customerPath(customerId),
          ]);
          return {
            stored: (stored ?? null) as User | null,
            customer: (customer ?? null) as Customer | null,
          };
        },
        (
          read,
        ): Result<
          RegistrationDecision,
          IdentityError | CompleteRegistrationRefusal
        > => {
          if (read.stored === null) {
            return Result.err(IdentityError.registrationUserNotFound());
          }
          const profile = ProfileEditSystem.registrationProfile(
            RegistrationSystem.settle(read.stored, fields, birthDate),
            ageDay,
          );
          if (!profile.ok) {
            return Result.err({
              errorCode: CompleteRegistrationRefusalCode.ProfileInvalid,
              errors: profile.error,
            });
          }
          const registered = RegistrationSystem.register(
            read.stored,
            profile.value,
          );
          const { id, ...body } = registered;
          return Result.ok({
            registered,
            writes: [
              WriteOp.set([Collections.Users, id], body),
              ...CustomerRecordSystem.createsFor(
                new Map([[uid, customerId]]),
                new Map([[customerId, read.customer]]),
                new Map([[uid, registered]]),
                CustomerOrigin.Registration,
                nowUtcMs,
              ),
            ],
          });
        },
      ),
    );
    if (!committed.ok) return committed;
    const registered = committed.value.registered;

    // Best-effort identity chrome: the header's account monogram reads the
    // Auth display name. Its failure never fails the registration.
    const named = await ports.setDisplayName(uid, Profile.fullName(registered));
    if (!named.ok) {
      ports.log('warn', 'registration.display_name_failed', {
        uid,
        errorCode: named.error.errorCode,
      });
    }

    const tenant = await ports.loadTenant();
    if (!tenant.ok) return tenant;

    // The same claims `verifyOtp` mints for a registered account: the
    // granted roles (plain `client` when none). The status is never a claim.
    const token = await ports.mintCustomToken(
      uid,
      RegistrationSystem.claimsFor(
        registered.registrationState,
        registered.roles,
        tenant.value,
      ),
    );
    if (!token.ok) return token;
    return Result.ok({ customToken: token.value });
  };
