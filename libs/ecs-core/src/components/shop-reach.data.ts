/** How to reach the shop about a refusal — the i18n keys of the reach phrase. */
const SHOP_REACH = {
  /** There is a number to press: «call the shop». */
  Call: 'booking.reach.call',
  /** The catalogue has no number for this shop: «get in touch». */
  Contact: 'booking.reach.contact',
} as const;

/**
 * Which "reach the shop" phrase a refusal ends with — the `shopReachKey`
 * values (`booking-gateway.port.ts:232`), a shared tag replacing the
 * ~120 bare-literal comparisons of the web client. Its values are i18n keys
 * (flatten-spec §0.4): they stay byte-identical. Split out of
 * `booking-flow.data.ts` (pass D, D-7: one name per file).
 */
export type ShopReach = (typeof SHOP_REACH)[keyof typeof SHOP_REACH];

export const ShopReach = {
  ...SHOP_REACH,

  /** «call» when there is a number to press (`tel:` href), «contact» when there is none. */
  forCallHref(callHref: string | null): ShopReach {
    return callHref === null ? SHOP_REACH.Contact : SHOP_REACH.Call;
  },
} as const;
