/**
 * Why a one-time code was issued — the OTP's field `otpPurpose` (N15; the
 * legacy `purpose` strings, upper-snaked), stored as these values on
 * `otps/{id}`. A tag dictionary only, not a brand (blueprint §2.7): the
 * ONLY source of these strings.
 */
export const OtpPurpose = {
  /** A known account signing in. */
  Login: 'LOGIN',
  /** A first sign-in that provisions the account. */
  Signup: 'SIGNUP',
} as const;
export type OtpPurpose = (typeof OtpPurpose)[keyof typeof OtpPurpose];
