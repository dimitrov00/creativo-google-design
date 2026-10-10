import type { ServiceTerms } from './service-terms.data';

/**
 * Which refusals a placement is exempt from — the "bookable window vs valid
 * placement" ruling (`decide-booking.ts:278-330`). What `buildDayWindows`
 * returns is what a CLIENT may be OFFERED, never a bound on what can exist:
 * a barber taking a regular at 08:00 before the shop opens is real, occupies
 * real time and counts in the statistics; it simply is never publicly
 * bookable.
 *
 * Four flags, each said out loud:
 * - `allowOutsideWindow` — the rostered windows, the shop's published hours,
 *   the booking horizon and the future-start invariant do not apply (a visit
 *   in the chair can still be corrected);
 * - `skipMinNotice` — `minLeadMinutes`, the notice a client owes the shop, does
 *   not apply (a receptionist moving a running-late visit at 10:12 to 10:15);
 * - `allowOverlap` — staff may double-book, but only once they ACKNOWLEDGED it
 *   («Запази въпреки застъпването»), so it is never part of a preset;
 * - `allowConflictingServices` — the catalogue's `conflictsWith` is the
 *   client's self-booking rule, which the shop's own book need not obey.
 */
export type PlacementPolicy = {
  readonly allowOutsideWindow: boolean;
  readonly allowOverlap: boolean;
  readonly allowConflictingServices: boolean;
  readonly skipMinNotice: boolean;
};

const CLIENT_DEFAULT: PlacementPolicy = {
  allowOutsideWindow: false,
  allowOverlap: false,
  allowConflictingServices: false,
  skipMinNotice: false,
};

const STAFF_WALK_IN: PlacementPolicy = {
  allowOutsideWindow: true,
  allowOverlap: false,
  allowConflictingServices: false,
  skipMinNotice: true,
};

export const PlacementPolicy = {
  /** A client booking online: every rule applies. */
  clientDefault(): PlacementPolicy {
    return CLIENT_DEFAULT;
  },

  /**
   * The shop placing a walk-in itself (§9 D18): outside the roster and before
   * the minimum notice are fine; an overlap still needs its acknowledgement
   * and conflicting services stay refused.
   */
  staffWalkIn(): PlacementPolicy {
    return STAFF_WALK_IN;
  },

  /** The same policy with the overlap acknowledged (or withdrawn). */
  withOverlap(policy: PlacementPolicy, allowOverlap: boolean): PlacementPolicy {
    return { ...policy, allowOverlap };
  },

  equals(a: PlacementPolicy, b: PlacementPolicy): boolean {
    return (
      a.allowOutsideWindow === b.allowOutsideWindow &&
      a.allowOverlap === b.allowOverlap &&
      a.allowConflictingServices === b.allowConflictingServices &&
      a.skipMinNotice === b.skipMinNotice
    );
  },
} as const;

/**
 * A seat's terms as STAFF fixed them by hand — the snapshot carried forward
 * plus whatever the command changed, keyed by the requested seat's key (its
 * line id). Each figure replaces the catalogue's; `null` keeps the
 * catalogue's (`decide-booking.ts:223-229` — the staff edit and a client's
 * move carry PARTIAL overrides). Assembled server-side only (the staff edit,
 * or a client's move from the STORED seats), never parsed from a client
 * payload: "name your own price" is the one thing the round trip exists to
 * prevent.
 */
export type StaffTermsOverride = {
  readonly seatKey: string;
  readonly priceMinorUnits: number | null;
  readonly currencyCode: string | null;
  readonly durationMinutes: number | null;
  readonly setupMinutes: number | null;
  readonly cleanupMinutes: number | null;
};

export const StaffTermsOverride = {
  /** Every figure fixed: the seat is written with exactly `terms`. */
  of(seatKey: string, terms: ServiceTerms): StaffTermsOverride {
    return {
      seatKey,
      priceMinorUnits: terms.priceMinorUnits,
      currencyCode: terms.currencyCode,
      durationMinutes: terms.durationMinutes,
      setupMinutes: terms.setupMinutes,
      cleanupMinutes: terms.cleanupMinutes,
    };
  },

  /** No figure fixed — the catalogue's terms, but the seat counts as carried. */
  carried(seatKey: string): StaffTermsOverride {
    return {
      seatKey,
      priceMinorUnits: null,
      currencyCode: null,
      durationMinutes: null,
      setupMinutes: null,
      cleanupMinutes: null,
    };
  },

  /** The override for `seatKey`, or `null` — a seat no one re-priced. */
  find(
    overrides: readonly StaffTermsOverride[],
    seatKey: string,
  ): StaffTermsOverride | null {
    for (let i = 0; i < overrides.length; i++) {
      const override = overrides[i] as StaffTermsOverride;
      if (override.seatKey === seatKey) return override;
    }
    return null;
  },
} as const;
