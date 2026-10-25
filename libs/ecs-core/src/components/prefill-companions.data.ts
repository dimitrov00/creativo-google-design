/**
 * What becomes of a seat the booker cannot name when a bag is rebuilt from a
 * visit (`BookingCartSystem.prefill`) — the ONLY source of these strings.
 * Moved out of `booking-cart.system.ts` (pass D, D-7.4: a tag dictionary is
 * a component).
 */
export const PrefillCompanions = {
  /** A new booking: a companion account comes back as a guest seat. */
  AsGuests: 'AS_GUESTS',
  /** A move: the server carries them, so they stay out of the cart. */
  CarriedByServer: 'CARRIED_BY_SERVER',
} as const;
export type PrefillCompanions =
  (typeof PrefillCompanions)[keyof typeof PrefillCompanions];
