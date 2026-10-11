import {
  AccountLifecycle,
  AuthClaims,
  type AuthStrategy,
  type BirthDate,
  Email,
  type ParsedIdentifier,
  E164,
  Registration,
  RegistrationField,
  type RegistrationFields,
  RegistrationState,
  Role,
} from '@core/components';
import {
  IdentifierChannel,
  type TenantId,
  type UserId,
} from '@core/primitives';
import type { User } from '@core/entities';
import { SearchFieldsSystem } from './search-fields.system';

/**
 * RegistrationSystem — how a provisioned account becomes a registered one
 * (blueprint §2.8: `settle`, `missingField`), the math of
 * `apps/functions/src/use-cases/complete-registration.use-case.ts` and its
 * client twin `RegisterUserUseCase`
 * (`libs/application/identity/src/lib/use-cases/register-user.use-case.ts`),
 * the claims `verifyOtp` mints (`verify-otp.use-case.ts:174-180`) and the
 * contact-channel stub it provisions (`:190-215`).
 *
 * The deployment's `AuthStrategy.required` is the single source of which
 * fields gate submission; the login channel always satisfies its own field.
 * A re-run of the registration (the callable is idempotent) KEEPS what the
 * server granted — the roles, the status, the registered contact channels.
 */

/**
 * What `users/{uid}` already holds that a registration must respect —
 * the stub of a first sign-in, or a registered body on a re-run.
 */
export type RegistrationStanding = Pick<
  User,
  'registrationState' | 'roles' | 'email' | 'phone' | 'birthDate'
>;

/**
 * The registered profile a submission settles to, before the edge parses
 * its contact text: names trimmed (`''` when absent — the name rule then
 * refuses), the phone a kept E.164 or the trimmed form text, the e-mail
 * kept or taken from the form, the birth date the checked one or the
 * stored one, the roles the granted ones.
 */
export type RegistrationSettlement = {
  readonly firstName: string;
  readonly lastName: string;
  readonly phone: string;
  readonly email: string | null;
  readonly birthDate: BirthDate | null;
  readonly roles: readonly Role[];
};

/** The parsed profile a registered body is written from. */
export type RegisteredProfile = {
  readonly firstName: string;
  readonly lastName: string;
  readonly phone: E164;
  readonly email: Email | null;
  readonly birthDate: BirthDate | null;
  readonly roles: readonly Role[];
};

/** The self-registration default: a stub or a pre-roles document grants plain `client`, never nothing. */
const DEFAULT_ROLES: readonly Role[] = [Role.Client];

/** Trimmed text, or `null` for an absent or blank field. */
function trimmedOrNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export const RegistrationSystem = {
  /** The registration field a login channel fills. */
  fieldOf(identifierChannel: IdentifierChannel): RegistrationField {
    return identifierChannel === IdentifierChannel.Phone
      ? RegistrationField.Phone
      : RegistrationField.Email;
  },

  /**
   * The submitted fields with the login channel's own field filled from the
   * identifier when the form left it out — the about step never re-collects
   * the channel just used to sign in. A field the form DID send (even
   * blank) is kept as sent.
   */
  effectiveFields(
    identifierChannel: IdentifierChannel,
    value: string,
    fields: RegistrationFields,
  ): RegistrationFields {
    const field = RegistrationSystem.fieldOf(identifierChannel);
    return { ...fields, [field]: fields[field] ?? value };
  },

  /** The first field the strategy requires that is absent or blank, in the strategy's order; `null` when all are there. */
  missingField(
    strategy: Pick<AuthStrategy, 'required'>,
    fields: RegistrationFields,
  ): RegistrationField | null {
    for (let i = 0; i < strategy.required.length; i++) {
      const field = strategy.required[i] as RegistrationField;
      if (trimmedOrNull(fields[field]) === null) return field;
    }
    return null;
  },

  /** The stored roles, or plain `client` when none were granted. */
  grantedRoles(stored: readonly Role[]): readonly Role[] {
    return stored.length > 0 ? stored : DEFAULT_ROLES;
  },

  /**
   * The registered profile a submission settles to. On a first
   * registration the form supplies the channel the login did not verify; once
   * registered, a phone or e-mail changes only through a verified contact
   * change, never through a re-run's form. `birthDate` is the submission's
   * own, already through `AgeSystem` (or `null` when it sent none — the
   * stored one then stands).
   */
  settle(
    standing: RegistrationStanding,
    fields: RegistrationFields,
    birthDate: BirthDate | null,
  ): RegistrationSettlement {
    const keepContacts = Registration.isRegistered(standing);
    const formEmail = trimmedOrNull(fields[RegistrationField.Email]);
    const formPhone = fields[RegistrationField.Phone];
    return {
      firstName: fields[RegistrationField.FirstName]?.trim() ?? '',
      lastName: fields[RegistrationField.LastName]?.trim() ?? '',
      phone:
        keepContacts && standing.phone !== null
          ? standing.phone
          : (formPhone?.trim() ?? ''),
      email: keepContacts ? standing.email : (formEmail ?? standing.email),
      birthDate: birthDate ?? standing.birthDate,
      roles: RegistrationSystem.grantedRoles(standing.roles),
    };
  },

  /**
   * The claims a sign-in token carries: active with the granted roles once
   * registered — never a hardcoded `client` that would demote staff —
   * onboarding before that (an abandoned registration lands back in
   * onboarding on its next sign-in).
   */
  claimsFor(
    registrationState: RegistrationState,
    storedRoles: readonly Role[],
    tenantId: TenantId,
  ): AuthClaims {
    if (!Registration.isRegistered({ registrationState })) {
      return AuthClaims.onboarding(tenantId);
    }
    const active = AuthClaims.active(
      tenantId,
      RegistrationSystem.grantedRoles(storedRoles),
    );
    // `grantedRoles` is never empty, so `active` never refuses.
    return active.ok ? active.value : AuthClaims.onboarding(tenantId);
  },

  /**
   * The `users/{uid}` stub of a first sign-in: only the login channel,
   * every other key present and empty — no names, no roles, `ACTIVE`, no
   * search keys. `completeRegistration` writes the registered body over it.
   */
  provision(userId: UserId, parsed: ParsedIdentifier): User {
    const isPhone = parsed.identifierChannel === IdentifierChannel.Phone;
    return {
      id: userId,
      registrationState: RegistrationState.Provisioned,
      phone: isPhone ? E164.of(parsed.identifier) : null,
      firstName: null,
      lastName: null,
      roles: [],
      ...AccountLifecycle.active(),
      email: isPhone ? null : Email.of(parsed.identifier),
      birthDate: null,
      searchName: null,
      searchPrefixes: [],
    };
  },

  /**
   * The registered body written over the standing document: the profile,
   * the `REGISTERED` tag and the search keys of the new names and contact
   * channels. The account lifecycle the document holds is kept — a re-run
   * never lifts a pause.
   */
  register(user: User, profile: RegisteredProfile): User {
    const { searchName, searchPrefixes } = SearchFieldsSystem.searchFields(
      profile.firstName,
      profile.lastName,
      profile.phone,
      profile.email,
    );
    return {
      ...user,
      registrationState: RegistrationState.Registered,
      phone: profile.phone,
      firstName: profile.firstName,
      lastName: profile.lastName,
      roles: profile.roles,
      email: profile.email,
      birthDate: profile.birthDate,
      searchName,
      searchPrefixes,
    };
  },
} as const;
