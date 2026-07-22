import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  AuthStrategy,
  Identifier,
  RegistrationField,
  authStrategyRequires,
} from '@creativo/domain/identity';
import { OtpClient, OtpClientError } from '../ports/otp-client.port';

export class MissingRegistrationFieldError extends Error {
  constructor(public readonly field: RegistrationField) {
    super(`Missing required registration field: ${field}`);
  }
}

export type RegisterUserError =
  | MissingRegistrationFieldError
  | { readonly kind: 'client_error'; readonly error: OtpClientError };

/** Checks every field the deployment's `AuthStrategy` requires is present before spending the call — the strategy is the single source of truth, not a hardcoded field list. */
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
    const effectiveFields: Partial<Record<RegistrationField, string>> = {
      ...fields,
      [identifier.kind]: fields[identifier.kind] ?? identifier.value.toString(),
    };

    for (const field of strategy.required) {
      if (!authStrategyRequires(strategy, field)) continue;
      // `field` is always one of the four `RegistrationField` literals
      // (`strategy.required`'s own element type), never external input.
      // eslint-disable-next-line security/detect-object-injection
      const value = effectiveFields[field];
      if (!value?.trim()) {
        return fail(new MissingRegistrationFieldError(field));
      }
    }

    const result = await this.otpClient.completeRegistration(
      identifier,
      effectiveFields,
    );
    if (result.isFailure()) {
      return fail({ kind: 'client_error', error: result.error });
    }
    return ok(undefined);
  }
}
