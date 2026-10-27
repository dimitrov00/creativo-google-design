import type { Currency, PriceCents } from '@core/primitives';

/**
 * The figure of a tip act — the before and after of a `BOOKING_TIP_RECORDED`
 * / `BOOKING_TIP_CLEARED` row (audit-hardening WS-2), intersected into
 * {@link AuditContext.Tip}: the amount the seat now carries (`null` when the
 * act cleared it — "not recorded", never zero), the amount it carried before
 * (`null` when there was none), in the seat's own currency.
 */
export type TipDelta = {
  readonly tipAmountCents: PriceCents | null;
  readonly tipFromCents: PriceCents | null;
  readonly tipCurrency: Currency;
};
