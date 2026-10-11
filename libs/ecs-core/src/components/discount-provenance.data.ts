import type { CouponGrantId } from '@core/primitives';
import type { VoucherCode } from './voucher-code.data';

/**
 * Where a discount on a visit came from — the field `discountSource`, the
 * ONLY source of these strings. Distinct from `DiscountMethod` (WHAT is
 * taken off). The stored legacy values are the lower-case `source` strings
 * (`appointment-document.ts:331-335`).
 */
export const DiscountSource = {
  /** A coupon the CLIENT already held — the shop keeping a promise. */
  Grant: 'GRANT',
  /** A shareable code the shop published, presented at the counter. */
  Code: 'CODE',
  /** A number a human invented at the counter, role-gated. */
  Manual: 'MANUAL',
} as const;
export type DiscountSource =
  (typeof DiscountSource)[keyof typeof DiscountSource];

/**
 * The provenance of a discount on a visit — a flat variant slice of every
 * element of `appointments.discounts[]` (Law 6.3). Each source carries
 * exactly its own evidence, prefixed with its domain (Law 6.2): a `GRANT`
 * names the grant it honoured (`discountGrantId`), a `CODE` the code that
 * was presented (`discountCode`), a `MANUAL` figure nothing. Kept as
 * provenance and never re-resolved: a grant revoked or a code retired since
 * does not change what a booked visit was promised.
 */
export type DiscountProvenance =
  | DiscountProvenance.Grant
  | DiscountProvenance.Code
  | DiscountProvenance.Manual;

const MANUAL: DiscountProvenance.Manual = {
  discountSource: DiscountSource.Manual,
};

export const DiscountProvenance = {
  grant(grantId: CouponGrantId): DiscountProvenance.Grant {
    return { discountSource: DiscountSource.Grant, discountGrantId: grantId };
  },
  code(code: VoucherCode): DiscountProvenance.Code {
    return { discountSource: DiscountSource.Code, discountCode: code };
  },
  manual(): DiscountProvenance.Manual {
    return MANUAL;
  },

  /** The grant a `GRANT` discount honoured; `null` for any other source. */
  grantIdOf(provenance: DiscountProvenance): CouponGrantId | null {
    return provenance.discountSource === DiscountSource.Grant
      ? provenance.discountGrantId
      : null;
  },

  /** The code a `CODE` discount was opened with; `null` for any other source. */
  codeOf(provenance: DiscountProvenance): VoucherCode | null {
    return provenance.discountSource === DiscountSource.Code
      ? provenance.discountCode
      : null;
  },

  /** The same source with the same evidence — the grant, the code, or neither. */
  sameProvenance(a: DiscountProvenance, b: DiscountProvenance): boolean {
    switch (a.discountSource) {
      case DiscountSource.Grant:
        return (
          b.discountSource === DiscountSource.Grant &&
          a.discountGrantId === b.discountGrantId
        );
      case DiscountSource.Code:
        return (
          b.discountSource === DiscountSource.Code &&
          a.discountCode === b.discountCode
        );
      case DiscountSource.Manual:
        return b.discountSource === DiscountSource.Manual;
    }
  },
} as const;

export namespace DiscountProvenance {
  /** A coupon the client already held; the grant honoured is the evidence. */
  export type Grant = {
    readonly discountSource: typeof DiscountSource.Grant;
    readonly discountGrantId: CouponGrantId;
  };
  /** A shop code presented at the counter, stored normalised. */
  export type Code = {
    readonly discountSource: typeof DiscountSource.Code;
    readonly discountCode: VoucherCode;
  };
  /** A figure a human invented at the counter — no evidence beyond the role. */
  export type Manual = {
    readonly discountSource: typeof DiscountSource.Manual;
  };
}
