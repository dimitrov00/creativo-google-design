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

const STAFF_PLACEMENT: PlacementPolicy = {
  allowOutsideWindow: true,
  allowOverlap: false,
  allowConflictingServices: true,
  skipMinNotice: true,
};

export const PlacementPolicy = {
  /** A client booking online: every rule applies. */
  clientDefault(): PlacementPolicy {
    return CLIENT_DEFAULT;
  },

  /**
   * THE SHOP'S ONE PRESET — the shop placing or moving its OWN book, a
   * walk-in included: the staff booking (`book-appointment.pipeline.ts`)
   * and the staff edit (`edit-appointment.pipeline.ts`, with the overlap
   * acknowledged through {@link withOverlap}). Outside the roster and before
   * the minimum notice are fine, and the catalogue's conflicting services
   * are the client's self-booking rule, not the shop's — the shop's own book
   * trusts the barber (OR-11; DEP-F9 supersedes the conflicting-services
   * half of §9 D18, the live behaviour since flip 1). An overlap still needs
   * its acknowledgement.
   */
  staffPlacement(): PlacementPolicy {
    return STAFF_PLACEMENT;
  },

  /** The same policy with the overlap acknowledged (or withdrawn). */
  withOverlap(policy: PlacementPolicy, allowOverlap: boolean): PlacementPolicy {
    return { ...policy, allowOverlap };
  },
} as const;
