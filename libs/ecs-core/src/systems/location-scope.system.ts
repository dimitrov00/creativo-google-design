import type { LocationId } from '@core/primitives';

/**
 * Anything scoped to shops — a service, a barber: its `locationIds`, where an
 * EMPTY list means "available everywhere" (the seed default). A whole
 * `Service` or `Barber` passes straight in.
 */
export type LocationScoped = {
  readonly locationIds: readonly LocationId[];
};

/**
 * LocationScopeSystem — which shops a catalogue entry is offered at
 * (`location.ts:289-301` `locationScopeServes`, read by `Service.servesLocation`
 * and `Barber.servesLocation`). ONE predicate, so the services step, the
 * commit's admission and the waitlist matcher can never disagree about what
 * an empty scope means: reading empty as "nowhere" refused every service the
 * shop never bothered to scope, which is most of them.
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
} as const;
