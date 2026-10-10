/**
 * The channel a one-time code is delivered over — the stored
 * `otps.destinationType` strings of `firestore-otp-repository.ts:14-27`,
 * unchanged (blueprint §2.6, §2.7). Law 1: read from this dictionary, never
 * a bare `'sms'` at a use site.
 */
export const OtpDestinationType = {
  Email: 'email',
  Sms: 'sms',
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
