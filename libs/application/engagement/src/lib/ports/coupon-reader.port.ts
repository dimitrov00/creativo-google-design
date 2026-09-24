import { InjectionToken } from '@angular/core';
import { Result } from '@creativo/domain/kernel';
import { Coupon } from '@creativo/domain/engagement';
import { RepositoryError } from '@creativo/application/shared';

/**
 * The coupon CATALOGUE, read side — what a code opens.
 *
 * Separate from `CouponGrantRepository`, which is about what a PERSON holds:
 * a code on a flyer belongs to nobody until it is presented, so resolving
 * one is a catalogue question, not a grants question. Two methods, for the
 * two things the counter asks: what a typed code opens (a voucher, a code
 * the client read out), and which codes are LIVE — the book offers the
 * shop's own promotions rather than asking staff to type them (owner,
 * 2026-09-16: "you are the staff, you know the valid promo codes").
 */
export interface CouponReader {
  /**
   * The ENABLED coupon a code opens, or `null` when no such code is live.
   *
   * The code is normalised the way `Coupon` stores it (trimmed, upper-case)
   * before the lookup, so `first10` finds `FIRST10`. A disabled coupon is
   * `null` too — a retired code must read as "no such code", not as a
   * promise the shop stopped keeping.
   */
  findByCode(code: string): Promise<Result<Coupon | null, RepositoryError>>;

  /**
   * The ENABLED coupons that open by a code — the shop's live promotions,
   * for the book to offer at the chair. Coupons that reach a client only
   * as a grant (no code) are not here; they are the person's, not the
   * counter's. A retired code is absent, never listed as "disabled".
   */
  listOpen(): Promise<Result<readonly Coupon[], RepositoryError>>;
}

export const COUPON_READER = new InjectionToken<CouponReader>('CouponReader');
