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
