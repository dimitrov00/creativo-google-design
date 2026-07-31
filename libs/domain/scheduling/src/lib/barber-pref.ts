import { BarberId } from '@creativo/domain/catalog';

/**
 * WHICH barber a booking line WANTS — a pre-commitment *preference*, not an
 * assignment. Ports v2's `BarberPref`.
 *
 * A discriminated union rather than `BarberId | 'any'` so "anyone will do"
 * can never be mistaken for a real id at a call site, and so adding a future
 * tier (`'same_as_previous'`, `'not'`) is a new arm rather than a sentinel.
 *
 * The split from `Seat.barberId` is the load-bearing part: a preference is an
 * INPUT to scheduling, an assignment is a FACT of the appointment. The
 * availability engine consumes prefs and emits resolved `BarberId`s; a
 * committed `Seat` therefore never carries a pref, and a cart line never
 * carries a resolved barber.
 */
export type BarberPref =
  | { readonly kind: 'any' }
  | { readonly kind: 'specific'; readonly barberId: BarberId };

export const BarberPref = {
  any(): BarberPref {
    return { kind: 'any' };
  },

  specific(barberId: BarberId): BarberPref {
    return { kind: 'specific', barberId };
  },

  /** Would `barberId` satisfy this preference? `any` is satisfied by everyone. */
  matches(pref: BarberPref, barberId: BarberId): boolean {
    return pref.kind === 'any' || pref.barberId.equals(barberId);
  },

  equals(a: BarberPref, b: BarberPref): boolean {
    if (a.kind === 'any' || b.kind === 'any') return a.kind === b.kind;
    return a.barberId.equals(b.barberId);
  },

  /** Stable persistence form — `null` is the `any` arm. */
  toBarberIdOrNull(pref: BarberPref): BarberId | null {
    return pref.kind === 'any' ? null : pref.barberId;
  },
} as const;
