import type { BarberId } from '../primitives/ids.primitive';

/**
 * The preference tags — the ONLY source of these strings, named after the
 * field they type (`barberPreference`, Law 1/N15; was `BarberPrefKind`).
 */
export const BarberPreference = {
  /** Anyone will do — the permission to seat whichever chair is free. */
  Any: 'ANY',
  /** This barber, by name. */
  Specific: 'SPECIFIC',
} as const;
export type BarberPreference =
  (typeof BarberPreference)[keyof typeof BarberPreference];

/**
 * WHICH barber a booking line WANTS — a preference, an INPUT to scheduling,
 * never an assignment (`barber-pref.ts:17-27`). The availability engine
 * consumes prefs and emits resolved `BarberId`s.
 *
 * A flat variant SLICE (Law 6): `{ barberPreference: 'ANY' }` or
 * `{ barberPreference: 'SPECIFIC'; preferredBarberId }`, so a line that
 * carries a preference intersects it at its root. A committed seat stores
 * only the TAG (`seats[].barberPreference: BarberPreference | null`) beside
 * its resolved `barberId`, and a stored cart line stores `barberId | null`
 * (`null` is `ANY`). A seat's `null` tag is "we do not know" and is never
 * read as `ANY`.
 */
export type BarberPref = BarberPref.Any | BarberPref.Specific;

const ANY: BarberPref.Any = { barberPreference: BarberPreference.Any };

export const BarberPref = {
  any(): BarberPref.Any {
    return ANY;
  },

  specific(preferredBarberId: BarberId): BarberPref.Specific {
    return { barberPreference: BarberPreference.Specific, preferredBarberId };
  },

  /** A stored cart line's `barberId | null` → the preference it means. */
  fromBarberId(barberId: BarberId | null): BarberPref {
    return barberId === null ? ANY : BarberPref.specific(barberId);
  },

  /** The stored cart-line form — `null` is the `ANY` arm. */
  toBarberIdOrNull(pref: BarberPref): BarberId | null {
    return pref.barberPreference === BarberPreference.Any
      ? null
      : pref.preferredBarberId;
  },

  /**
   * A seat's stored tag → the preference it was resolved from, with the
   * seat's own barber as the specific one; an unknown tag is `null`
   * ("we do not know"), never `ANY`.
   */
  fromSeat(
    barberPreference: BarberPreference | null,
    barberId: BarberId,
  ): BarberPref | null {
    if (barberPreference === BarberPreference.Any) return ANY;
    if (barberPreference === BarberPreference.Specific) {
      return BarberPref.specific(barberId);
    }
    return null;
  },

  /** The edge guard for a tag: one of the two, else `null`. */
  parsePreference(raw: unknown): BarberPreference | null {
    return raw === BarberPreference.Any || raw === BarberPreference.Specific
      ? raw
      : null;
  },

  /** Would `barberId` satisfy this preference? `ANY` is satisfied by everyone. */
  matches(pref: BarberPref, barberId: BarberId): boolean {
    return (
      pref.barberPreference === BarberPreference.Any ||
      pref.preferredBarberId === barberId
    );
  },

  equals(a: BarberPref, b: BarberPref): boolean {
    if (
      a.barberPreference === BarberPreference.Any ||
      b.barberPreference === BarberPreference.Any
    ) {
      return a.barberPreference === b.barberPreference;
    }
    return a.preferredBarberId === b.preferredBarberId;
  },
} as const;

export namespace BarberPref {
  export type Any = {
    readonly barberPreference: typeof BarberPreference.Any;
  };
  export type Specific = {
    readonly barberPreference: typeof BarberPreference.Specific;
    readonly preferredBarberId: BarberId;
  };
}
