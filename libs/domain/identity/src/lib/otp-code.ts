import { Result, fail, ok } from '@creativo/domain/kernel';
import { OtpCodeInvalidError } from './otp-code.errors';

const OTP_CODE_PATTERN = /^\d{6}$/;

/**
 * A 6-digit numeric OTP code — what the user types into the verification
 * input. Invariant: exactly 6 ASCII digits, leading zeros allowed.
 *
 * Deliberately does NOT expose a `generate()` — code generation is a
 * crypto-port concern (`OtpCodeGenerator`, Goal 03's application layer),
 * not something this zero-port pure-domain value object does itself. This
 * type only ever validates/wraps an already-produced 6-digit string,
 * whether it came from user input or a generator.
 */
export class OtpCode {
  private constructor(private readonly _value: string) {}

  /** Validating factory — the ONLY way untrusted input (user-typed) becomes an OtpCode. */
  static create(raw: string): Result<OtpCode, OtpCodeInvalidError> {
    const trimmed = raw.trim();
    if (!OTP_CODE_PATTERN.test(trimmed)) {
      return fail(new OtpCodeInvalidError(raw));
    }
    return ok(new OtpCode(trimmed));
  }

  /** Rebuild from a value already known to be a valid 6-digit code (e.g. a generator's output). */
  static fromPrimitive(trusted: string): OtpCode {
    return new OtpCode(trusted);
  }

  get value(): string {
    return this._value;
  }

  equals(other: OtpCode): boolean {
    return this._value === other._value;
  }

  toString(): string {
    return this._value;
  }
}
