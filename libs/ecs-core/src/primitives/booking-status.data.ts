/**
 * Lifecycle tags of an appointment's root — the field `bookingStatus`
 * (Law 6.2), the ONLY source of these strings. The legacy stored values
 * were the lower-case forms (`appointment-status.ts:20-32`, `status.kind`),
 * which the legacy shims mapped until the appointment flip.
 */
export const BookingStatus = {
  /** Awaiting confirmation — the gate before a slot holds. */
  Pending: 'PENDING',
  /** Holds the slot. Says the shop accepted, never that the client is present. */
  Confirmed: 'CONFIRMED',
  /** The service happened. Terminal: a delivered cut cannot be undelivered. */
  Completed: 'COMPLETED',
  /**
   * The subject did not turn up. NOT terminal: the client ten minutes late is
   * the most ordinary correction a shop makes, so `NO_SHOW → CONFIRMED` is
   * the one correction edge of the graph.
   */
  NoShow: 'NO_SHOW',
  /** Called off by either side. Terminal. */
  Cancelled: 'CANCELLED',
} as const;
export type BookingStatus = (typeof BookingStatus)[keyof typeof BookingStatus];

/**
 * The edge guard for an untrusted value — a wire scalar, a refusal's server
 * parameter: the stored tag it names, exact match (no case folding, no
 * legacy lower-case form), or `false` for anything else, non-strings
 * included. The one copy of the rule — the staff dashboard's refusal
 * reader and the callable's wire read it.
 */
export function isBookingStatus(value: unknown): value is BookingStatus {
  for (const status of Object.values(BookingStatus)) {
    if (status === value) return true;
  }
  return false;
}
