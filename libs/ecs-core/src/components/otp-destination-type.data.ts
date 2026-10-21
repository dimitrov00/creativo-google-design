/**
 * The channel a one-time code is delivered over — the OTP's field
 * `otpDestinationType` (N15; the legacy `destinationType` strings,
 * upper-snaked), stored as these values on `otps/{id}`. Law 1: read from
 * this dictionary, never a bare `'SMS'` at a use site.
 */
export const OtpDestinationType = {
  Email: 'EMAIL',
  Sms: 'SMS',
} as const;
export type OtpDestinationType =
  (typeof OtpDestinationType)[keyof typeof OtpDestinationType];

/** Every destination type, dictionary order — derived, never a second source. */
export const OTP_DESTINATION_TYPES: readonly OtpDestinationType[] =
  Object.values(OtpDestinationType);

/** The edge guard for an untrusted value (a stored field read back). */
export function isOtpDestinationType(
  value: unknown,
): value is OtpDestinationType {
  for (let i = 0; i < OTP_DESTINATION_TYPES.length; i++) {
    if (OTP_DESTINATION_TYPES[i] === value) return true;
  }
  return false;
}
