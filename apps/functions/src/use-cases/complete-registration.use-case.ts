import { User } from '@creativo/domain/models';
import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  DEFAULT_AUTH_STRATEGY,
  RegistrationField,
  activeClaims,
  authStrategyRequires,
  roleFromPrimitive,
} from '@creativo/domain/identity';
import {
  AuthTokenPort,
  UserRepositoryPort,
  otpDestinationFromRaw,
} from '@creativo/application/identity';
import { DEFAULT_TENANT_ID } from '../lib/otp/tenant';
import {
  ClaimsPromotionFailure,
  CompleteRegistrationError,
  InvalidInputError,
  MissingRegistrationFieldError,
  RepositoryFailure,
  UserNotFoundError,
  UserValidationFailure,
} from './complete-registration.errors';
import { TenantId } from '@creativo/domain/models';

export interface CompleteRegistrationInput {
  kind: 'phone' | 'email';
  value: string;
  fields: Partial<Record<RegistrationField, string>>;
}

function parseInput(
  raw: unknown,
): Result<CompleteRegistrationInput, InvalidInputError> {
  if (typeof raw !== 'object' || raw === null) {
    return fail(new InvalidInputError('payload must be an object'));
  }
  const { kind, value, fields } = raw as Record<string, unknown>;
  if (kind !== 'phone' && kind !== 'email') {
    return fail(new InvalidInputError('kind must be "phone" or "email"'));
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fail(new InvalidInputError('missing or empty value'));
  }
  if (typeof fields !== 'object' || fields === null) {
    return fail(new InvalidInputError('missing fields'));
  }
  return ok({
    kind,
    value,
    fields: fields as Partial<Record<RegistrationField, string>>,
  });
}

/**
 * Finalizes a `new`-session sign-up: fills in the `AuthStrategy`-required
 * profile fields onto the user record `verifyOtpChallenge` already
 * provisioned, then mints+returns a *fresh* custom token carrying
 * `active` claims (mirrors `RegisterUserUseCase`'s client-side field
 * check — the server independently re-validates, never trusting the
 * caller). The client signs in again with this token (same pattern
 * `verifyOtpChallenge` already uses).
 *
 * Deliberately `createCustomToken` only — never *also*
 * `setUserClaims`/`setCustomUserClaims` on the same uid in the same
 * request: back-to-back Admin SDK claims-set + custom-token-mint calls
 * for one uid reliably produce `auth/internal-error` on the Auth
 * emulator's subsequent `signInWithCustomToken`. Minting a token with the
 * claims embedded directly avoids the conflict and needs no separate
 * claims-set call anyway — the fresh sign-in carries them regardless of
 * whatever the user's stored claims were before this call.
 */
export class CompleteRegistrationUseCase {
  constructor(
    private readonly userRepository: UserRepositoryPort,
    private readonly authToken: AuthTokenPort,
  ) {}

  async execute(
    rawInput: unknown,
  ): Promise<Result<{ customToken: string }, CompleteRegistrationError>> {
    const inputResult = parseInput(rawInput);
    if (inputResult.isFailure()) {
      return fail(inputResult.error);
    }
    const input = inputResult.value;

    // The identifier itself already satisfies whichever of phone/email is
    // the login channel — the client never has to re-submit it as a form
    // field for the requirement to be met.
    const effectiveFields: Partial<Record<RegistrationField, string>> = {
      ...input.fields,
      [input.kind]: input.fields[input.kind] ?? input.value,
    };

    for (const field of DEFAULT_AUTH_STRATEGY.required) {
      if (!authStrategyRequires(DEFAULT_AUTH_STRATEGY, field)) continue;
      // eslint-disable-next-line security/detect-object-injection -- `field` is always one of the four `RegistrationField` literals off `strategy.required`, never external input.
      const value = effectiveFields[field];
      if (!value?.trim()) {
        return fail(new MissingRegistrationFieldError(field));
      }
    }

    const destinationResult = otpDestinationFromRaw(
      input.value,
      input.kind === 'phone' ? 'sms' : 'email',
    );
    if (destinationResult.isFailure()) {
      return fail(new InvalidInputError('invalid identifier value'));
    }
    const destination = destinationResult.value;

    const userResult = await this.userRepository.findByDestination(destination);
    if (userResult.isFailure()) {
      return fail(new RepositoryFailure(userResult.error));
    }
    const user = userResult.value;
    if (!user) {
      return fail(new UserNotFoundError());
    }

    const firstName = effectiveFields['firstName']?.trim() ?? '';
    const lastName = effectiveFields['lastName']?.trim() ?? '';
    const displayName = `${firstName} ${lastName}`.trim();
    const email = effectiveFields['email']?.trim();
    const phone = effectiveFields['phone']?.trim();

    const updatedResult = User.reconstitute({
      id: user.id.value,
      displayName,
      email: email ?? user.email?.value,
      phone: phone ?? user.phone ?? undefined,
      referralCode: user.referralCode,
      gamificationPoints: user.gamificationPoints,
      tenantMemberships: user.tenantMemberships.map((membership) => ({
        tenantId: membership.tenantId.value,
        role: membership.role,
      })),
    });
    if (updatedResult.isFailure()) {
      return fail(new UserValidationFailure(updatedResult.error));
    }

    const saveResult = await this.userRepository.save(updatedResult.value);
    if (saveResult.isFailure()) {
      return fail(new RepositoryFailure(saveResult.error));
    }

    const tenantIdResult = TenantId.create(DEFAULT_TENANT_ID);
    if (tenantIdResult.isFailure()) {
      // Unreachable — DEFAULT_TENANT_ID is a known-valid non-empty literal.
      return fail(new InvalidInputError('invalid tenant'));
    }

    const claimsResult = activeClaims([roleFromPrimitive('client')]);
    if (claimsResult.isFailure()) {
      // Unreachable — the literal roles array above is never empty.
      return fail(new InvalidInputError('empty roles'));
    }

    const tokenResult = await this.authToken.createCustomToken(
      user.id,
      tenantIdResult.value,
      claimsResult.value,
    );
    if (tokenResult.isFailure()) {
      return fail(new ClaimsPromotionFailure(tokenResult.error));
    }

    return ok({ customToken: tokenResult.value });
  }
}
