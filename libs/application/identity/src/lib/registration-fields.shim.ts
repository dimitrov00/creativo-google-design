import {
  REGISTRATION_FIELDS,
  type RegistrationFields,
} from '@creativo/ecs-core';
import { RegistrationField } from '@creativo/domain/identity';

/**
 * Phase 2 shim converters (ECS migration) between a form's partial record —
 * an absent key for a field it did not collect — and ecs-core's
 * `RegistrationFields`, where every key is present and absent is `null`.
 * Shared by every shim that hands submitted fields to `RegistrationSystem`
 * or `OnboardingFlowSystem` (register-user, the onboarding flow, the
 * functions' complete-registration), so there is one copy; deleted with the
 * partial-record shape in Phase 4.
 */
export function toRegistrationFields(
  fields: Partial<Record<RegistrationField, string>>,
): RegistrationFields {
  return {
    phone: fields.phone ?? null,
    email: fields.email ?? null,
    firstName: fields.firstName ?? null,
    lastName: fields.lastName ?? null,
    birthDate: fields.birthDate ?? null,
  };
}

/** Back to the partial record: a `null` field is an absent key. */
export function fromRegistrationFields(
  fields: RegistrationFields,
): Partial<Record<RegistrationField, string>> {
  const partial: Partial<Record<RegistrationField, string>> = {};
  for (const field of REGISTRATION_FIELDS) {
    // eslint-disable-next-line security/detect-object-injection -- `field` iterates the closed RegistrationField dictionary.
    const value = fields[field];
    // eslint-disable-next-line security/detect-object-injection -- same closed key set.
    if (value !== null) partial[field] = value;
  }
  return partial;
}
