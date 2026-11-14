import type { BarberId } from '@core/primitives';

/**
 * What a staff act reaches — the field `staffReach`, the ONLY source of
 * these strings (`docs/designs/staff-permissions.md`, P3). The reach
 * decides what an "own only" grant admits. Stage B adds the visit.
 */
export const StaffReach = {
  /** The act names barber records: hours, days off, a profile, a price list. */
  Barbers: 'BARBERS',
  /** The act names no barber: adding one, the Team list. Never "own" by default. */
  Shop: 'SHOP',
} as const;
export type StaffReach = (typeof StaffReach)[keyof typeof StaffReach];

/**
 * THE TARGET OF A STAFF ACT (P3) — what `StaffAccessSystem.admit` weighs
 * an "own only" grant against: the barber records the call names, or the
 * shop. A union of flat variant slices on `staffReach`. (The brief calls
 * it the access target; `AccessTarget` is the route guard's redirect.)
 */
export type StaffTarget = StaffTarget.Barbers | StaffTarget.Shop;

const SHOP: StaffTarget.Shop = { staffReach: StaffReach.Shop };

export const StaffTarget = {
  /** The shop itself — an act that names no barber. */
  SHOP,

  /**
   * The barber records an act names, as the request lists them. "Own
   * only" admits it when EVERY one is the caller's record, so naming none
   * is refused: an empty list is never "own" by default.
   */
  barbers(targetBarberIds: readonly BarberId[]): StaffTarget.Barbers {
    return { staffReach: StaffReach.Barbers, targetBarberIds };
  },
} as const;

export namespace StaffTarget {
  export type Barbers = {
    readonly staffReach: typeof StaffReach.Barbers;
    /** Every barber record the act names — carried as given, never copied. */
    readonly targetBarberIds: readonly BarberId[];
  };
  export type Shop = {
    readonly staffReach: typeof StaffReach.Shop;
  };
}
