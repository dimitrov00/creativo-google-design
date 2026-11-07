import type { BarberLinkId, UserId } from '@core/primitives';

/**
 * `barbers/{barberId}/restricted/link` — the lock that keeps one barber
 * record linked to at most one account (staff analytics, "Which barber the
 * caller is"). The link itself lives on the account (`StaffLink`,
 * `users/{uid}.linkedBarberId`); this document names the account holding
 * it, so `setRoles` reads it in the same transaction as the user's field
 * and two accounts can never hold one record. Not public: `barbers/*` is
 * readable by anyone, so the uid is kept under `restricted/`, which the
 * rules close to every client (callable-only).
 *
 * The lock decides: an account that was blocked or erased still holds it
 * until its link is cleared (removing the barber role clears it). The id is
 * `BarberLinkId.FIXED` — `restricted/` under a barber holds nothing else.
 */
export type BarberLink = {
  readonly id: BarberLinkId;
  /** The account linked to this barber record. */
  readonly linkedUserId: UserId;
};
