import type { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';

/**
 * A gift voucher's state — the field `voucherStatus`, the ONLY source of
 * these strings. The stored legacy values are the lower-case
 * `giftVouchers.state.kind` tags (`active`, `void`).
 */
export const VoucherStatus = {
  Active: 'ACTIVE',
  Void: 'VOID',
} as const;
export type VoucherStatus = (typeof VoucherStatus)[keyof typeof VoucherStatus];

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

/**
 * `ACTIVE` until voided (`gift-voucher-document.ts:49-55`) — a flat variant
 * slice of the `GiftVoucher` archetype (was the nested `state`). An EMPTY
 * voucher stays `ACTIVE`: a restore after a cancelled visit can fill it
 * again, and a report wants "spent" and "cancelled by the shop" to be
 * different facts. The transitions (redeem, restore, settle, void) live in
 * VoucherSystem.
 */
export type VoucherLifecycle = VoucherLifecycle.Active | VoucherLifecycle.Void;

const ACTIVE: VoucherLifecycle.Active = { voucherStatus: VoucherStatus.Active };

export const VoucherLifecycle = {
  active(): VoucherLifecycle.Active {
    return ACTIVE;
  },

  voided(voidedAtUtcMs: UtcEpochMs, reason: string): VoucherLifecycle.Void {
    return {
      voucherStatus: VoucherStatus.Void,
      voidedAtUtcMs,
      voidReason: reason,
    };
  },

  isVoid(lifecycle: VoucherLifecycle): lifecycle is VoucherLifecycle.Void {
    return lifecycle.voucherStatus === VoucherStatus.Void;
  },

  /** The lifecycle slice of a value that carries one (a whole voucher), copied. */
  of(lifecycle: VoucherLifecycle): VoucherLifecycle {
    return lifecycle.voucherStatus === VoucherStatus.Void
      ? VoucherLifecycle.voided(lifecycle.voidedAtUtcMs, lifecycle.voidReason)
      : ACTIVE;
  },
} as const;

export namespace VoucherLifecycle {
  export type Active = { readonly voucherStatus: typeof VoucherStatus.Active };
  export type Void = {
    readonly voucherStatus: typeof VoucherStatus.Void;
    readonly voidedAtUtcMs: UtcEpochMs;
    readonly voidReason: string;
  };
}
