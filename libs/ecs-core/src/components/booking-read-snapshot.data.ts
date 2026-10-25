/*
 * What a placing pipeline's transactional read half handed its pure
 * decision — the read tag of `bookAppointment`, `rescheduleAppointment` and
 * `editAppointment` (pass D, D-7.7 / D-8.3: one dictionary for the three
 * pipelines' read tags, which each spelled as bare literals). A tag
 * dictionary is a component (D-7); its values are internal — no document,
 * wire field, URL or DOM attribute ever carries them.
 */

/** How a placing pipeline's read half ended — the ONLY source of these strings, the field `bookingReadSnapshot`. */
export const BookingReadSnapshot = {
  /** The named attempt (or intent) already committed: answer its original, write nothing. */
  Replay: 'REPLAY',
  /** Refused by the read half before the decision — the refusal travels with it. */
  Refused: 'REFUSED',
  /** The read set is in: the decision runs. */
  Loaded: 'LOADED',
  /** The request names exactly where the visit already is: nothing to decide (the reschedule). */
  Unchanged: 'UNCHANGED',
} as const;
export type BookingReadSnapshot =
  (typeof BookingReadSnapshot)[keyof typeof BookingReadSnapshot];
