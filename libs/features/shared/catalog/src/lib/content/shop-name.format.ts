import { LocalizedText } from '@core/components';
import type { ShopLocation } from '@core/entities';
import type { RepositoryError } from '@core/errors';
import type { Locale, LocationId, Result } from '@core/primitives';
import { LocationScopeSystem } from '@core/systems';

/*
 * A SHOP BY THE NAME A LINE THAT ALREADY KNOWS THE BUSINESS CALLS IT
 * (OR-37, OR-42, Law 10) — the one wording of a shop's name the programs
 * pages print beside a role or an event and the admin's shop pickers list:
 * its short name, else its name, in the data language. Reuse, never copy:
 * `/careers`, `/events` and `/admin/programs` all read it from here.
 *
 * It decides nothing: whether there are shops to tell apart is
 * `LocationScopeSystem.isMultiShop`'s, and which shop a program is at is
 * `ProgramsSystem`'s — this only names them, once per read.
 */

/** A shop as a row names it — built once per emission, read by every row. */
export type NamedShop = {
  readonly id: LocationId;
  readonly name: string;
};

/** What a line that already knows the business calls the shop — «Център» — in `locale`. */
export function shopNameOf(shop: ShopLocation, locale: Locale): string {
  return LocalizedText.pick(shop.shortName ?? shop.name, locale);
}

/**
 * The shops a row may name, each worded once: none while the shops are
 * unread (`undefined`) or the read failed, and none at a one-shop tenant —
 * there is nothing to tell apart. In the read's order.
 */
export function namedShopsOf(
  shops: Result<readonly ShopLocation[], RepositoryError> | undefined,
  locale: Locale,
): readonly NamedShop[] {
  if (shops === undefined || !shops.ok) return [];
  if (!LocationScopeSystem.isMultiShop(shops.value.length)) return [];
  const named: NamedShop[] = [];
  for (const shop of shops.value) {
    named.push({ id: shop.id, name: shopNameOf(shop, locale) });
  }
  return named;
}
