/** A gift voucher's state — the stored `giftVouchers.state.kind` tags, unchanged. */
export const VoucherStateKind = {
  Active: 'active',
  Void: 'void',
} as const;
export type VoucherStateKind =
  (typeof VoucherStateKind)[keyof typeof VoucherStateKind];

/**
 * Why a voucher cannot be drawn on now (`GiftVoucher.refusal`): voided,
 * past its expiry, or nothing left. VoucherSystem decides it; the error
 * `engagement.gift_voucher.not_redeemable` carries it as its `reason`.
 */
export const VoucherRefusal = {
  Void: 'void',
  Expired: 'expired',
  Empty: 'empty',
} as const;
export type VoucherRefusal =
  (typeof VoucherRefusal)[keyof typeof VoucherRefusal];

/**
 * `active` until voided (`gift-voucher-document.ts:49-55`). An EMPTY voucher
 * stays `active`: a restore after a cancelled visit can fill it again, and
 * a report wants "spent" and "cancelled by the shop" to be different facts.
 * The transitions (redeem, restore, settle, void) live in VoucherSystem.
 */
export type VoucherState = VoucherState.Active | VoucherState.Void;

export const VoucherState = {
  active(): VoucherState.Active {
    return { kind: VoucherStateKind.Active };
  },

  voided(voidedAtMs: number, reason: string): VoucherState.Void {
    return { kind: VoucherStateKind.Void, voidedAtMs, reason };
  },

  isVoid(state: VoucherState): state is VoucherState.Void {
    return state.kind === VoucherStateKind.Void;
  },
} as const;

export namespace VoucherState {
  export type Active = { readonly kind: typeof VoucherStateKind.Active };
  export type Void = {
    readonly kind: typeof VoucherStateKind.Void;
    readonly voidedAtMs: number;
    readonly reason: string;
  };
}
