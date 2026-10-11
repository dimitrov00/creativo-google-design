/** The placement tags — the ONLY source of these strings. */
const PLACEMENT = {
  /** The client booked it themselves. */
  Self: 'SELF',
  /** The shop placed it on the client's behalf. */
  Staff: 'STAFF',
} as const;

/**
 * Who put a booking in the book (R33) — the dictionary of the appointment's
 * `placement` and `inferredPlacement` fields (`Placement | null`; was
 * `PlacementKind`, flatten-spec §3.1 — the fields keep their names, which
 * are not banned). `placement` is the COMMIT's own stamp;
 * `inferredPlacement` is the backfill's reconstruction from the commit audit
 * row and is never promoted to a stamp. `null` on either is "nobody may read
 * this as either" — a row written before the field. The stored documents keep
 * the lowercase `'self' | 'staff'` until the booking-core flip; the shims
 * convert.
 */
export type Placement = (typeof PLACEMENT)[keyof typeof PLACEMENT];

export const Placement = {
  ...PLACEMENT,

  /** The edge guard: a value that is one of the two tags, else `null`. */
  parse(raw: unknown): Placement | null {
    return raw === PLACEMENT.Self || raw === PLACEMENT.Staff ? raw : null;
  },

  isSelf(placement: Placement | null): boolean {
    return placement === PLACEMENT.Self;
  },

  isStaff(placement: Placement | null): boolean {
    return placement === PLACEMENT.Staff;
  },
} as const;
