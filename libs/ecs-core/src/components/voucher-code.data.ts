import { type Brand, EngagementError, Result } from '@core/primitives';

const MIN_LENGTH = 4;
const MAX_LENGTH = 32;
const PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * A shareable redemption code — `FIRST10` on a flyer, a gift voucher's
 * code a client reads off their phone. A brand over the stored plain string
 * (`voucher-code.ts:13`): 4–32 characters of letters, digits, `-` and `_`.
 * Case-preserving as a value; the counter's reading of a TYPED code is
 * trimmed and upper-cased first (`normalize`), so `coupons.code` and
 * `giftVouchers.code` are stored upper-case.
 */
export type VoucherCode = Brand<string, 'VoucherCode'>;

export const VoucherCode = {
  /** The only cast site. Validate untrusted text with `parse` / `parseTyped` first. */
  of(raw: string): VoucherCode {
    return raw as VoucherCode;
  },

  /** A code the way the counter reads it: trimmed and upper-case (`Coupon.normalizeCode`). */
  normalize(raw: string): string {
    return raw.trim().toUpperCase();
  },

  /** The shape guard, exactly as given: 4–32 of `[A-Za-z0-9_-]`. */
  parse(raw: string): Result<VoucherCode, EngagementError.VoucherCodeInvalid> {
    return raw.length >= MIN_LENGTH &&
      raw.length <= MAX_LENGTH &&
      PATTERN.test(raw)
      ? Result.ok(VoucherCode.of(raw))
      : Result.err(EngagementError.voucherCodeInvalid(raw));
  },

  /** What a person typed or a flyer printed: normalised, then guarded. */
  parseTyped(
    raw: string,
  ): Result<VoucherCode, EngagementError.VoucherCodeInvalid> {
    return VoucherCode.parse(VoucherCode.normalize(raw));
  },

  /**
   * A coupon's optional code: `null` or blank is a coupon that reaches
   * people only as grants (`null`); anything else must be a legal code once
   * normalised (`Coupon.validateCode`).
   */
  parseOptional(
    raw: string | null,
  ): Result<VoucherCode | null, EngagementError.VoucherCodeInvalid> {
    if (raw === null || raw.trim().length === 0) return Result.ok(null);
    return VoucherCode.parseTyped(raw);
  },

  equals(a: VoucherCode, b: VoucherCode): boolean {
    return a === b;
  },
} as const;
