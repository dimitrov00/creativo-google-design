import type { ParsedIdentifier, RegistrationFields } from '@core/components';
import { IdentityError, type PipelineError, Result } from '@core/primitives';
import type { AuthDeploymentPorts, OtpChallengePorts } from '@core/ports';
import { RegistrationSystem } from '@core/systems';

export type RegisterUserPorts = OtpChallengePorts & AuthDeploymentPorts;

/**
 * THE ABOUT STEP'S SUBMIT (Phase 4a 4A-8; the legacy `RegisterUserUseCase`):
 * every field the deployment's strategy requires must be present before the
 * call is spent — the strategy is the single source of truth, not a
 * hard-coded list. The identifier itself satisfies its own channel's field
 * (`RegistrationSystem.effectiveFields`: the about step never re-collects
 * the number just used to sign in), and optional extras the strategy does
 * not require (a birth date) are forwarded untouched — the server
 * re-validates them at its own boundary. A missing field is refused
 * `IDENTITY_REGISTRATION_FIELD_MISSING` naming it, without calling.
 */
export const registerUser =
  (ports: RegisterUserPorts) =>
  async (
    identifier: ParsedIdentifier,
    fields: RegistrationFields,
  ): Promise<
    Result<void, PipelineError | IdentityError.RegistrationFieldMissing>
  > => {
    const effective = RegistrationSystem.effectiveFields(
      identifier.identifierChannel,
      identifier.identifier,
      fields,
    );
    const missing = RegistrationSystem.missingField(
      ports.authDeployment.strategy,
      effective,
    );
    if (missing !== null) {
      return Result.err(IdentityError.registrationFieldMissing(missing));
    }
    return ports.completeRegistration(identifier, effective);
  };
