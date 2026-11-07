import { BarberId, StoredFields } from '@core/primitives';

/**
 * Which barber record a staff ACCOUNT is (staff analytics, "Which barber
 * the caller is") — a flat slice of `users/{uid}`. The link lives on the
 * account because `barbers/*` is publicly readable: a uid stored there would
 * publish every staff account. `null` is "not linked": every account that
 * holds no barber role, and a barber whose link an admin has not set yet
 * (or released). Written only by `setRoles`, guarded by the record's lock
 * (`BarberLink`, `barbers/{barberId}/restricted/link`); a partial profile
 * update never touches it.
 */
export type StaffLink = {
  readonly linkedBarberId: BarberId | null;
};

/** No link — what every writer that creates a user document writes. */
const NONE: StaffLink = { linkedBarberId: null };

export const StaffLink = {
  NONE,

  /**
   * The link of a stored `users/{uid}` body: its `linkedBarberId` when it
   * is a barber id, else `null` — an absent field (a document written
   * before the link existed) and a malformed one read as "not linked", so
   * no account is ever treated as a barber record it was not given.
   */
  of(raw: unknown): StaffLink {
    const stored = StoredFields.field(raw, 'linkedBarberId');
    if (typeof stored !== 'string') return NONE;
    const parsed = BarberId.parse(stored);
    return parsed.ok ? { linkedBarberId: parsed.value } : NONE;
  },
} as const;
