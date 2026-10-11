/**
 * Why a voucher cannot be drawn on now (`VoucherSystem.refusal`): voided,
 * past its expiry, or nothing left. The error
 * `ENGAGEMENT_GIFT_VOUCHER_NOT_REDEEMABLE` carries it as its reason.
 */
export const VoucherRefusal = {
  Void: 'VOID',
  Expired: 'EXPIRED',
  Empty: 'EMPTY',
} as const;
export type VoucherRefusal =
  (typeof VoucherRefusal)[keyof typeof VoucherRefusal];
