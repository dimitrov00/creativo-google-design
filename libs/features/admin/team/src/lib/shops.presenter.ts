import type { ShopLocation } from '@core/entities';
import type { Locale, LocationId } from '@core/primitives';
import { shopNameOf } from '@creativo/features/shared/catalog';
import type { ShopRowVm } from './shops.vm';

/*
 * «САЛОНИ», WORDED (Law 10): the catalogue's shops, the draft's ticks and
 * the shops the roster still has hours at in; one row per shop out. It
 * decides nothing: which shops are held is `TeamSystem.rosteredShops`'
 * answer, handed in.
 */

/** What the shop rows are worded from. */
export type ShopRowsInput = {
  /** The catalogue's shops, in its own order. */
  readonly shops: readonly ShopLocation[];
  /** The shops ticked in the draft. */
  readonly picked: readonly LocationId[];
  /** `TeamSystem.rosteredShops` — the shops the roster still has hours at. */
  readonly rostered: readonly LocationId[];
  readonly locale: Locale;
};

/** One row per shop, in the catalogue's order. */
export function shopRows(input: ShopRowsInput): readonly ShopRowVm[] {
  return input.shops.map((shop) => ({
    locationId: shop.id,
    name: shopNameOf(shop, input.locale),
    picked: input.picked.includes(shop.id),
    held: input.rostered.includes(shop.id),
    testId: `member-shop-${shop.id}`,
  }));
}
