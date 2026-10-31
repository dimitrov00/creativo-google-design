/**
 * Why a verification attempt was refused AND recorded — the field
 * `otpRefusalReason` of the `IDENTITY_OTP_REFUSED` audit row (audit-hardening
 * Phase 3, P3-RU-8): only a refusal that changed the challenge (a wrong code
 * counted against it) has a row; an expired, consumed, unknown or already
 * locked challenge changes nothing and has none (P3-L-2). The ONLY source of
 * these strings; a tag dictionary only — readers use `Tag.values` /
 * `Tag.has` over it (the `BlockReason` precedent), and
 * `OtpSystem.refusalReasonOf` is the one place that picks a value.
 */
export const OtpRefusalReason = {
  /** A wrong code, recorded as an attempt; the challenge stays open. */
  WrongCode: 'WRONG_CODE',
  /** A wrong code whose recorded attempt reaches `maxAttempts`: the challenge is now locked. */
  LockedOut: 'LOCKED_OUT',
} as const;
export type OtpRefusalReason =
  (typeof OtpRefusalReason)[keyof typeof OtpRefusalReason];
