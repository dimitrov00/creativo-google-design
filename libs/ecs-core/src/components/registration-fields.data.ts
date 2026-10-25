import type { RegistrationField } from './registration.data';

/**
 * The raw values an about step submits, one per field, every key present —
 * `null` for a field the form did not collect (today's
 * `Partial<Record<RegistrationField, string>>`, without the optional keys).
 * Foreign input: `RegistrationSystem` and `completeRegistration` read each
 * value through its own smart constructor. A form with nothing collected
 * yet is `Registration.emptyFields()`.
 */
export type RegistrationFields = {
  readonly [K in RegistrationField]: string | null;
};
