import type { LocationId } from '@core/primitives';

/**
 * Anything scoped to shops — a service, a barber: its `locationIds`, where an
 * EMPTY list means "available everywhere" (the seed default). A whole
 * `Service` or `Barber` passes straight in.
 */
export type LocationScoped = {
  readonly locationIds: readonly LocationId[];
};

/** More than this many shops, and a visit names the one it is at. */
const SINGLE_SHOP = 1;

/**
 * LocationScopeSystem — which shops a catalogue entry is offered at
 * (`location.ts:289-301` `locationScopeServes`, read by `Service.servesLocation`
 * and `Barber.servesLocation`). ONE predicate, so the services step, the
 * commit's admission and the waitlist matcher can never disagree about what
 * an empty scope means: reading empty as "nowhere" refused every service the
 * shop never bothered to scope, which is most of them.
 *
 * Beside it (pass C): a chair's HOME shop — the first it is scoped to, where
 * the staff dashboard starts a new visit and files a block (`homeOf`) — and
 * whether a tenant has shops to tell apart at all (`isMultiShop`, the visit
 * sheet's «Салон» row; `VisitStorySystem.namesShop` composes it).
 */
export const LocationScopeSystem = {
  /** Empty `scope` ⇒ every shop; otherwise membership decides. */
  serves(scope: readonly LocationId[], locationId: LocationId): boolean {
    return scope.length === 0 || scope.includes(locationId);
  },

  /** Is `entry` (a service, a barber) offered at `locationId`? */
  servesLocation(entry: LocationScoped, locationId: LocationId): boolean {
    return LocationScopeSystem.serves(entry.locationIds, locationId);
  },

  /**
   * The entry's HOME shop — the first one its scope lists (the staff
   * dashboard's `locationIds[0]`: where a new visit on the chair starts and
   * where a block is filed). `null` for an empty scope, which names no shop
   * of its own ("everywhere"): each caller keeps its own fallback.
   */
  homeOf(entry: LocationScoped): LocationId | null {
    return entry.locationIds[0] ?? null;
  },

  /**
   * THE SHOP A CHAIR'S NEW ACT LANDS AT, on the staff dashboard: its home
   * ({@link homeOf}), else the first shop for a chair that serves every shop or
   * that the catalogue no longer lists. `null` only with no shop at all. A
   * visit's first shop and a block's filed shop are both this one.
   */
  homeOrFirst(
    entry: LocationScoped | null,
    shops: readonly { readonly id: LocationId }[],
  ): LocationId | null {
    return (
      (entry === null ? null : LocationScopeSystem.homeOf(entry)) ??
      shops[0]?.id ??
      null
    );
  },

  /**
   * Are there shops to tell apart — more than one? A visit names its shop
   * only then (the visit sheet's «Салон» row, `uiShops().length > 1`).
   */
  isMultiShop(locationCount: number): boolean {
    return locationCount > SINGLE_SHOP;
  },
} as const;
