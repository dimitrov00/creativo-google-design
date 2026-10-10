import { IdentityError } from './identity-errors.data';
import { Result } from './result.data';

/** Exactly six ASCII digits; leading zeros allowed. */
const OTP_CODE_PATTERN = /^\d{6}$/;

/**
 * A six-digit one-time code — what the person types into the verification
 * input — as a brand over the plain string. Never generated here: a code and
 * its salt come from the `OtpCrypto` port (`identity.port.ts`); this only
 * validates an already-produced string.
 */
export type OtpCode = string & { readonly __brand: unique symbol };

export const OtpCode = {
  /** The only cast site — for a value known to be six digits (a generator's output). */
  of: (raw: string): OtpCode => raw as OtpCode,

  /**
   * The edge guard — the ONLY way typed input becomes a code: trimmed, then
   * exactly six digits, or `identity.otp_code.invalid` carrying the raw text.
   */
  parse(raw: string): Result<OtpCode, IdentityError> {
    const trimmed = raw.trim();
    return OTP_CODE_PATTERN.test(trimmed)
      ? Result.ok(OtpCode.of(trimmed))
      : Result.err(IdentityError.otpCodeInvalid(raw));
  },

  equals(a: OtpCode, b: OtpCode): boolean {
    return a === b;
  },
} as const;
