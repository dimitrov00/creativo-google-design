/**
 * Registration tags — the ONLY source of these strings, the plain tag field
 * `registrationState` of `users/{uid}` (flatten-spec §3.7: a tag, not a
 * `{ kind }` object — the state carries no variant fields).
 */
export const RegistrationState = {
  /** The `{ email, phone }` stub `verifyOtp` writes on a first sign-in. */
  Provisioned: 'PROVISIONED',
  /** The body `completeRegistration` writes over the stub — names and roles set. */
  Registered: 'REGISTERED',
} as const;
export type RegistrationState =
  (typeof RegistrationState)[keyof typeof RegistrationState];

/**
 * The fields a person may be asked for during registration — the identity
 * `REGISTRATION_FIELDS` vocabulary, re-shaped from a tuple into the
 * dictionary. Its values ARE the user document's field names, so they stay
 * as they are (flatten-spec §3.7). Which of them a deployment REQUIRES is
 * `AuthStrategy.required`; `birthDate` exists so a strategy MAY require it
 * (none does today — the about step forwards it when the person shares it).
 */
export const RegistrationField = {
  Phone: 'phone',
  Email: 'email',
  FirstName: 'firstName',
  LastName: 'lastName',
  BirthDate: 'birthDate',
} as const;
export type RegistrationField =
  (typeof RegistrationField)[keyof typeof RegistrationField];

/** Every registration field, dictionary order — derived, never a second source. */
export const REGISTRATION_FIELDS: readonly RegistrationField[] =
  Object.values(RegistrationField);

/** The edge guard for an untrusted value (a strategy config entry, a form key). */
export function isRegistrationField(
  value: unknown,
): value is RegistrationField {
  for (let i = 0; i < REGISTRATION_FIELDS.length; i++) {
    if (REGISTRATION_FIELDS[i] === value) return true;
  }
  return false;
}

/**
 * The raw values an about step submits, one per field, every key present —
 * `null` for a field the form did not collect (today's
 * `Partial<Record<RegistrationField, string>>`, without the optional keys).
 */
export type RegistrationFields = {
  readonly [K in RegistrationField]: string | null;
};

/**
 * Where `users/{uid}` stands — the slice holding the plain tag field
 * `registrationState` (blueprint §2.6): the provision stub and the
 * registered body were two stored shapes of one document; under `User` both
 * are one type, the stub written with every key present, and this tag says
 * which it is. `completeRegistration` is the only `PROVISIONED` →
 * `REGISTERED` writer. A `User` is a `Registration` by structural typing.
 */
export type Registration = {
  readonly registrationState: RegistrationState;
};

export const Registration = {
  /** Whether the account finished registering — reads the slice of any user. */
  isRegistered(registration: Registration): boolean {
    return registration.registrationState === RegistrationState.Registered;
  },
  /** A form with nothing collected yet — every field `null`. */
  emptyFields(): RegistrationFields {
    return {
      [RegistrationField.Phone]: null,
      [RegistrationField.Email]: null,
      [RegistrationField.FirstName]: null,
      [RegistrationField.LastName]: null,
      [RegistrationField.BirthDate]: null,
    };
  },
} as const;
