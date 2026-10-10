/** The stored placement tags — the ONLY source of these strings. */
const PLACEMENT_KIND = {
  /** The client booked it themselves. */
  Self: 'self',
  /** The shop placed it on the client's behalf. */
  Staff: 'staff',
} as const;

/**
 * Who put a booking in the book (R33) — `appointments.placement` and
 * `appointments.inferredPlacement` (`'self' | 'staff' | null`,
 * `appointment-document.ts:65-78`). `placement` is the COMMIT's own stamp;
 * `inferredPlacement` is the backfill's reconstruction from the commit audit
 * row and is never promoted to a stamp. `null` on either is "nobody may read
 * this as either" — a row written before the field.
 */
export type PlacementKind =
  (typeof PLACEMENT_KIND)[keyof typeof PLACEMENT_KIND];

export const PlacementKind = {
  ...PLACEMENT_KIND,

  /** The edge guard: a stored value that is one of the two tags, else `null`. */
  parse(raw: unknown): PlacementKind | null {
    return raw === PLACEMENT_KIND.Self || raw === PLACEMENT_KIND.Staff
      ? raw
      : null;
  },

  isSelf(kind: PlacementKind | null): boolean {
    return kind === PLACEMENT_KIND.Self;
  },

  isStaff(kind: PlacementKind | null): boolean {
    return kind === PLACEMENT_KIND.Staff;
  },
} as const;
