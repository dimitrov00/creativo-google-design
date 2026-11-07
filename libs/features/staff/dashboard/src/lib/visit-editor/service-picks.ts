import type { ServiceId, ServiceVariantId } from '@core/primitives';

/** What the service page ticks for one person: an option's key → how many of it. */
export type ServicePicks = ReadonlyMap<string, number>;

/**
 * A seat's option key — the catalogue option it was picked from (the
 * service's id, or `service:variant`), the key the page's cards carry
 * (`serviceOptionsOf`).
 */
export function optionKeyOf(leg: {
  readonly serviceId: ServiceId;
  readonly variantId: ServiceVariantId | null;
}): string {
  return leg.variantId === null
    ? leg.serviceId
    : `${leg.serviceId}:${leg.variantId}`;
}

/**
 * WHAT A PERSON ALREADY HAS, as the page's ticks (owner, 2026-11-06: "it
 * should have pre-checked the service that is already applied") — each of
 * their seats counted by its option, so a cut booked twice opens at «2».
 */
export function picksOf(
  legs: readonly {
    readonly serviceId: ServiceId;
    readonly variantId: ServiceVariantId | null;
    readonly clientId: string;
  }[],
  personId: string,
): ServicePicks {
  const picks = new Map<string, number>();
  for (const leg of legs) {
    if (leg.clientId !== personId) continue;
    const key = optionKeyOf(leg);
    picks.set(key, (picks.get(key) ?? 0) + 1);
  }
  return picks;
}

/** A pick's change from what the person has: seats to add, seats to take off, by option. */
export interface ServicePickDiff {
  readonly add: ReadonlyMap<string, number>;
  readonly remove: ReadonlyMap<string, number>;
  readonly added: number;
  readonly removed: number;
}

/** The ticks against the seats they started from. */
export function pickDiffOf(
  had: ServicePicks,
  picked: ServicePicks,
): ServicePickDiff {
  const add = new Map<string, number>();
  const remove = new Map<string, number>();
  let added = 0;
  let removed = 0;
  for (const key of new Set([...had.keys(), ...picked.keys()])) {
    const delta = (picked.get(key) ?? 0) - (had.get(key) ?? 0);
    if (delta > 0) {
      add.set(key, delta);
      added += delta;
    } else if (delta < 0) {
      remove.set(key, -delta);
      removed -= delta;
    }
  }
  return { add, remove, added, removed };
}

/**
 * The legs with `remove` taken off one person — the newest of each option
 * first, so the seat picked last is the one let go.
 */
export function withoutPicks<
  L extends {
    readonly serviceId: ServiceId;
    readonly variantId: ServiceVariantId | null;
    readonly clientId: string;
  },
>(
  legs: readonly L[],
  personId: string,
  remove: ReadonlyMap<string, number>,
): readonly L[] {
  const left = new Map(remove);
  const kept: L[] = [];
  for (let i = legs.length - 1; i >= 0; i--) {
    const leg = legs[i] as L;
    const key = optionKeyOf(leg);
    const owed = left.get(key) ?? 0;
    if (leg.clientId === personId && owed > 0) {
      left.set(key, owed - 1);
      continue;
    }
    kept.unshift(leg);
  }
  return kept;
}
