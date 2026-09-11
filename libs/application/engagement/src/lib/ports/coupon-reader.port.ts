import { InjectionToken } from '@angular/core';
import { Result } from '@creativo/domain/kernel';
import { Coupon } from '@creativo/domain/engagement';
import { RepositoryError } from '@creativo/application/shared';

/**
 * The coupon CATALOGUE, read side — what a code opens.
 *
 * Separate from `CouponGrantRepository`, which is about what a PERSON holds:
 * a code on a flyer belongs to nobody until it is presented, so resolving
 * one is a catalogue question, not a grants question. One method, because
 * one surface asks it: the counter, typing a code the client read out.
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
}

export const COUPON_READER = new InjectionToken<CouponReader>('CouponReader');
