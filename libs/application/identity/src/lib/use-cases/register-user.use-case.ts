import { IdentifierChannel, RegistrationSystem } from '@creativo/ecs-core';
import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  AuthStrategy,
  Identifier,
  RegistrationField,
} from '@creativo/domain/identity';
import { OtpClient, OtpClientError } from '../ports/otp-client.port';
import {
  fromRegistrationFields,
  toRegistrationFields,
} from '../registration-fields.shim';

/*
 * Phase 2 shim (ECS migration): the login channel's own field and the
 * strategy's required-field check are `RegistrationSystem.effectiveFields`
 * and `.missingField` (`@creativo/ecs-core`); the form's partial record
 * crosses through the lib's one converter pair.
 */

export class MissingRegistrationFieldError extends Error {
  constructor(public readonly field: RegistrationField) {
    super(`Missing required registration field: ${field}`);
  }
}

export type RegisterUserError =
  | MissingRegistrationFieldError
  | { readonly kind: 'client_error'; readonly error: OtpClientError };

/**
 * Checks every field the deployment's `AuthStrategy` requires is present
 * before spending the call — the strategy is the single source of truth,
 * not a hardcoded field list. Optional extras the strategy does NOT
 * require (e.g. `birthDate`, ISO `YYYY-MM-DD` validated by the about step
 * through `BirthDate`) are forwarded untouched — the server re-validates
 * them at its own boundary.
 */
export class RegisterUserUseCase {
  constructor(private readonly otpClient: OtpClient) {}

  async execute(
    identifier: Identifier,
    strategy: AuthStrategy,
    fields: Partial<Record<RegistrationField, string>>,
  ): Promise<Result<void, RegisterUserError>> {
    // The identifier itself already satisfies whichever of phone/email is
    // the login channel — the "about" step never re-collects it as a form
    // field for the requirement to be met (mirrors `completeRegistration`'s
    // own server-side check, which applies this same fallback).
    const effective = RegistrationSystem.effectiveFields(
      identifier.kind === 'phone'
        ? IdentifierChannel.Phone
        : IdentifierChannel.Email,
      identifier.value.toString(),
      toRegistrationFields(fields),
    );
    const missing = RegistrationSystem.missingField(strategy, effective);
    if (missing !== null) {
      return fail(new MissingRegistrationFieldError(missing));
    }

    const result = await this.otpClient.completeRegistration(
      identifier,
      fromRegistrationFields(effective),
    );
    if (result.isFailure()) {
      return fail({ kind: 'client_error', error: result.error });
    }
    return ok(undefined);
  }
}
