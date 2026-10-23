import { type Brand, Result } from '@core/primitives';
import { IdentityError } from '@core/errors';

/**
 * How many digits a one-time code has — the ONE source of the OTP's length
 * policy. The `OtpCrypto` adapter draws codes of this length and
 * {@link OtpCode.parse} accepts exactly this length, so the two can never
 * drift apart.
 */
export const OTP_CODE_DIGITS = 6;

/** ASCII digits only; the length is checked against {@link OTP_CODE_DIGITS}. */
const ASCII_DIGITS = /^\d+$/;

/**
 * A six-digit one-time code — what the person types into the verification
 * input — as a brand over the plain string. Never generated here: a code and
 * its salt come from the `OtpCrypto` port (`identity.port.ts`); this only
 * validates an already-produced string.
 */
export type OtpCode = Brand<string, 'OtpCode'>;

export const OtpCode = {
  /** The only cast site — for a value known to be six digits (a generator's output). */
  of: (raw: string): OtpCode => raw as OtpCode,

  /**
   * The edge guard — the ONLY way typed input becomes a code: trimmed, then
   * exactly six digits, or `IDENTITY_OTP_CODE_INVALID` carrying the raw text.
   */
  parse(raw: string): Result<OtpCode, IdentityError> {
    const trimmed = raw.trim();
    return trimmed.length === OTP_CODE_DIGITS && ASCII_DIGITS.test(trimmed)
      ? Result.ok(OtpCode.of(trimmed))
      : Result.err(IdentityError.otpCodeInvalid(raw));
  },

  equals(a: OtpCode, b: OtpCode): boolean {
    return a === b;
  },
} as const;
