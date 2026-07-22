/**
 * Fields a user may be asked to provide during registration. The exact
 * set required depends on the `AuthStrategy` — a phone-OTP signup doesn't
 * re-ask for the phone (it's the identifier), but it does ask for
 * first/last name and optionally email.
 *
 * A genuinely closed enum — no value-object wrapper needed (mirrors
 * `models`'s own `Role` type).
 */
export const REGISTRATION_FIELDS = [
  'phone',
  'email',
  'firstName',
  'lastName',
] as const;

export type RegistrationField = (typeof REGISTRATION_FIELDS)[number];

export function isRegistrationField(
  value: unknown,
): value is RegistrationField {
  return (
    typeof value === 'string' &&
    (REGISTRATION_FIELDS as readonly string[]).includes(value)
  );
}
