import { Result, fail, ok } from '@creativo/domain/kernel';
import { VoucherCodeInvalidError } from './voucher-code.errors';

const MIN_LENGTH = 4;
const MAX_LENGTH = 32;
const PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * A shareable redemption code (ports v2's `primitives/VoucherCode.ts`).
 * Case-preserving — a caller that promises upper-case display (`PROMO-2026`)
 * can rely on the brand to keep the shape as authored.
 */
export class VoucherCode {
  private constructor(private readonly _value: string) {}

  static create(raw: string): Result<VoucherCode, VoucherCodeInvalidError> {
    if (
      raw.length < MIN_LENGTH ||
      raw.length > MAX_LENGTH ||
      !PATTERN.test(raw)
    ) {
      return fail(new VoucherCodeInvalidError(raw));
    }
    return ok(new VoucherCode(raw));
  }

  static fromPrimitive(trusted: string): VoucherCode {
    return new VoucherCode(trusted);
  }

  get value(): string {
    return this._value;
  }

  equals(other: VoucherCode): boolean {
    return this._value === other._value;
  }

  toString(): string {
    return this._value;
  }
}
