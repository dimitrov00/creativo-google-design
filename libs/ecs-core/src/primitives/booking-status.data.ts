/**
 * Lifecycle tags of an appointment's root — the field `bookingStatus`
 * (Law 6.2), the ONLY source of these strings. The stored legacy values are
 * the lower-case forms (`appointment-status.ts:20-32`, `status.kind`); the
 * legacy shims map them until the appointment flip.
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
