/**
 * Why a one-time code was issued — the OTP's field `otpPurpose` (N15;
 * today's stored `otps.purpose` strings of `models/otp.ts:17`,
 * upper-snaked — the stored bytes stay lowercase until the identity flip).
 * A tag dictionary only, not a brand (blueprint §2.7): the ONLY source of
 * these strings.
 */
export const OtpPurpose = {
  /** A known account signing in. */
  Login: 'LOGIN',
  /** A first sign-in that provisions the account. */
  Signup: 'SIGNUP',
} as const;
export type OtpPurpose = (typeof OtpPurpose)[keyof typeof OtpPurpose];

/** Every purpose, dictionary order — derived, never a second source. */
export const OTP_PURPOSES: readonly OtpPurpose[] = Object.values(OtpPurpose);

/** The edge guard for an untrusted value (a callable payload, a stored field). */
export function isOtpPurpose(value: unknown): value is OtpPurpose {
  for (let i = 0; i < OTP_PURPOSES.length; i++) {
    if (OTP_PURPOSES[i] === value) return true;
  }
  return false;
}
