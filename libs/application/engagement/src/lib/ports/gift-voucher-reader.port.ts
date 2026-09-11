import { InjectionToken } from '@angular/core';
import { Result } from '@creativo/domain/kernel';
import { GiftVoucher } from '@creativo/domain/engagement';
import { RepositoryError } from '@creativo/application/shared';

/**
 * Gift vouchers, read side — what a voucher code is worth right now.
 *
 * The counter's other code lookup, beside `CouponReader`: the barber types
 * whatever code the client presents and the shop works out which it is.
 * Read only; a balance changes only inside the server's own transaction,
 * where the visit that draws it down is written in the same breath.
 */
export interface GiftVoucherReader {
  /** The voucher a code names, whatever its state, or `null` for no such code. */
  findByCode(
    code: string,
  ): Promise<Result<GiftVoucher | null, RepositoryError>>;
}

export const GIFT_VOUCHER_READER = new InjectionToken<GiftVoucherReader>(
  'GiftVoucherReader',
);
