import type { BarberId } from '../entities/barber.entity';

/** The preference tags — the ONLY source of these strings. */
export const BarberPrefKind = {
  /** Anyone will do — the permission to seat whichever chair is free. */
  Any: 'any',
  /** This barber, by name. */
  Specific: 'specific',
} as const;
export type BarberPrefKind =
  (typeof BarberPrefKind)[keyof typeof BarberPrefKind];

/**
 * WHICH barber a booking line WANTS — a preference, an INPUT to scheduling,
 * never an assignment (`barber-pref.ts:17-27`). The availability engine
 * consumes prefs and emits resolved `BarberId`s.
 *
 * In memory it is this union; a committed seat stores only the TAG
 * (`seats[].barberPref: 'any' | 'specific' | null`) beside its resolved
 * `barberId`, and a stored cart line stores `barberId | null` (`null` is
 * `any`). A seat's `null` tag is "we do not know" and is never read as `any`.
 */
export type BarberPref = BarberPref.Any | BarberPref.Specific;

const ANY: BarberPref.Any = { kind: BarberPrefKind.Any };

export const BarberPref = {
  any(): BarberPref.Any {
    return ANY;
  },

  specific(barberId: BarberId): BarberPref.Specific {
    return { kind: BarberPrefKind.Specific, barberId };
  },

  /** A stored cart line's `barberId | null` → the preference it means. */
  fromBarberId(barberId: BarberId | null): BarberPref {
    return barberId === null ? ANY : BarberPref.specific(barberId);
  },

  /** The stored cart-line form — `null` is the `any` arm. */
  toBarberIdOrNull(pref: BarberPref): BarberId | null {
    return pref.kind === BarberPrefKind.Any ? null : pref.barberId;
  },

  /**
   * A seat's stored tag → the preference it was resolved from, with the
   * seat's own barber as the specific one; an unknown tag is `null`
   * ("we do not know"), never `any`.
   */
  fromSeat(kind: BarberPrefKind | null, barberId: BarberId): BarberPref | null {
    if (kind === BarberPrefKind.Any) return ANY;
    if (kind === BarberPrefKind.Specific) return BarberPref.specific(barberId);
    return null;
  },

  /** The edge guard for a stored tag: one of the two, else `null`. */
  parseKind(raw: unknown): BarberPrefKind | null {
    return raw === BarberPrefKind.Any || raw === BarberPrefKind.Specific
      ? raw
      : null;
  },

  /** Would `barberId` satisfy this preference? `any` is satisfied by everyone. */
  matches(pref: BarberPref, barberId: BarberId): boolean {
    return pref.kind === BarberPrefKind.Any || pref.barberId === barberId;
  },

  equals(a: BarberPref, b: BarberPref): boolean {
    if (a.kind === BarberPrefKind.Any || b.kind === BarberPrefKind.Any) {
      return a.kind === b.kind;
    }
    return a.barberId === b.barberId;
  },
} as const;

export namespace BarberPref {
  export type Any = { readonly kind: typeof BarberPrefKind.Any };
  export type Specific = {
    readonly kind: typeof BarberPrefKind.Specific;
    readonly barberId: BarberId;
  };
}
