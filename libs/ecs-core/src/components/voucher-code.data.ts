import { type Brand, Result } from '@core/primitives';
import { EngagementError } from '@core/errors';

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

  /**
   * The same vouchers in the same order (the staff dashboard's `sameCodes`):
   * as many codes, each equal to its counterpart once both are
   * {@link normalize}d — order is cover order, and it matters.
   */
  sameCover(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (
        VoucherCode.normalize(a[i] as string) !==
        VoucherCode.normalize(b[i] as string)
      ) {
        return false;
      }
    }
    return true;
  },

  /**
   * The vouchers a batch names, in cover order (the callable's
   * `voucherCodesOf`): every code {@link parseTyped} — a blank one fails the
   * shape — and no voucher twice, since a second draw would be measured
   * against a moved balance. The first refusal answers: a malformed code
   * as `ENGAGEMENT_VOUCHER_CODE_INVALID`, a repeat as
   * `ENGAGEMENT_VOUCHER_CODE_DUPLICATE` naming the repeated code as typed
   * (pass D, DEP-18 — its one caller collapses every refusal to `null`).
   */
  distinct(
    codes: readonly string[],
  ): Result<
    readonly VoucherCode[],
    EngagementError.VoucherCodeInvalid | EngagementError.VoucherCodeDuplicate
  > {
    const out: VoucherCode[] = [];
    for (let i = 0; i < codes.length; i++) {
      const raw = codes[i] as string;
      const code = VoucherCode.parseTyped(raw);
      if (!code.ok) return code;
      if (out.includes(code.value)) {
        return Result.err(EngagementError.voucherCodeDuplicate(raw));
      }
      out.push(code.value);
    }
    return Result.ok(out);
  },
} as const;
