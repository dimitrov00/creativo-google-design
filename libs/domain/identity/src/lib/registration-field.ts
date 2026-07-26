/**
 * Fields a user may be asked to provide during registration. The exact
 * set required depends on the `AuthStrategy` — a phone-OTP signup doesn't
 * re-ask for the phone (it's the identifier), but it does ask for
 * first/last name and optionally email.
 *
 * A genuinely closed enum — no value-object wrapper needed (mirrors
 * `models`'s own `Role` type).
 *
 * `birthDate` (ISO `YYYY-MM-DD`, see the `BirthDate` VO) exists so a
 * future strategy MAY require it — no shipped strategy does today
 * (`DEFAULT_AUTH_STRATEGY` leaves it out), so it stays an optional extra
 * the about step forwards when the user chooses to share it.
 */
export const REGISTRATION_FIELDS = [
  'phone',
  'email',
  'firstName',
  'lastName',
  'birthDate',
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
