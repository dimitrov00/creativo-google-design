import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { adminFirestore } from '../firebase-admin';
import { type AuditSubject, appendAudit, seatSubjectsOf } from './audit';
import { callerActor, callerWorksTheBook } from './caller-roles';

/**
 * `recordSeatTip` — what the client left, against ONE seat.
 *
 * ### Why this is not a `staffEditAppointment` command
 * It was, and it could never have worked. That path REBUILDS the booking
 * through `decideBooking` and refuses outright unless the appointment is
 * still cancellable — "a completed, no-showed or already-cancelled visit is
 * HISTORY". Both halves are wrong for a tip:
 *
 * - A tip is recorded when the visit is FINISHED. That is when the client
 *   pays and tips, so the one status the edit path refuses is the only one
 *   that matters here. Routed through it, tips could be recorded on every
 *   visit except the ones that actually get tipped.
 * - Re-deciding is pure risk for no gain. A tip changes no placement, no
 *   duration and no price, so re-running availability over a visit that has
 *   already happened can only invent a refusal.
 *
 * `markArrived` is the precedent and the shape is identical: a fact recorded
 * ALONGSIDE the status rather than an edge in the lifecycle graph, written as
 * a targeted patch inside a transaction. This does the same for money.
 *
 * ### Why the seat and not the appointment
 * A party can be two barbers, and a tip belongs to whoever did the work. An
 * appointment-level number could not say whose it was, and every barber's
 * daily total is the sum of their own seats.
 *
 * `null` CLEARS a recording, which is not the same as `0` — a visit nobody
 * has settled up yet and one that genuinely tipped nothing are different
 * facts, and the day's total has to be able to tell them apart.
 */
export const recordSeatTip = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in first', {
      code: 'booking.tip.unauthenticated',
    });
  }
  if (!callerWorksTheBook(request)) {
    throw new HttpsError('permission-denied', 'Staff only', {
      code: 'booking.tip.forbidden',
    });
  }

  const payload = (request.data ?? {}) as Record<string, unknown>;
  const appointmentId = String(payload['appointmentId'] ?? '');
  const seatId = String(payload['seatId'] ?? '');
  const raw = payload['amountMinorUnits'];
  // `null` clears. Anything else must be a whole, non-negative number of
  // minor units: a negative is not a tip and a fraction of a cent is not
  // money. Nothing is rounded into plausibility.
  const amount =
    raw === null || raw === undefined
      ? null
      : typeof raw === 'number' && Number.isInteger(raw) && raw >= 0
        ? raw
        : undefined;

  if (
    appointmentId.length === 0 ||
    seatId.length === 0 ||
    amount === undefined
  ) {
    throw new HttpsError('invalid-argument', 'Invalid request', {
      code: 'booking.tip.invalid_input',
    });
  }

  const db = adminFirestore();
  let subjects: readonly AuditSubject[] = [];
  /** The stored figure already was this one — nothing written, nothing logged. */
  let unchanged = false;
  /** The committed attempt's own instant — with the seat, the audit key. */
  let recordedAtMs = 0;

  await db.runTransaction(async (tx) => {
    const ref = db.collection('appointments').doc(appointmentId);
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!data) {
      throw new HttpsError('not-found', 'No such appointment', {
        code: 'booking.tip.not_found',
      });
    }

    const seats = Array.isArray(data['seats']) ? data['seats'] : [];
    const index = seats.findIndex(
      (seat) =>
        seat != null &&
        typeof seat === 'object' &&
        String((seat as Record<string, unknown>)['id']) === seatId,
    );
    if (index < 0) {
      throw new HttpsError('not-found', 'No such seat', {
        code: 'booking.tip.not_found',
      });
    }

    // THE SAME FIGURE AGAIN is not a change. A retried call (the SDK's, or a
    // second tap on «Запази») used to rewrite the seat and log a second
    // "recorded" row for one act; like `markArrived`'s second tap, it now
    // writes nothing. Absent and `null` are the same "not recorded".
    const stored = (seats.at(index) as Record<string, unknown> | undefined)?.[
      'tipMinorUnits'
    ];
    if ((stored ?? null) === amount) {
      unchanged = true;
      return;
    }
    unchanged = false;
    recordedAtMs = Date.now();

    /*
     * ⚠ The WHOLE seats array is rewritten, with one field changed.
     *
     * Firestore cannot patch an element of an array by index, and the
     * alternative — reading the seat, rebuilding it and writing it back
     * through the document mapper — is what `staffEditAppointment` does and
     * what makes it unable to touch a settled visit. Copying the stored
     * seats verbatim and replacing one number keeps every other field
     * exactly as written, including ones this code has never heard of.
     *
     * Safe under concurrency because it happens inside the transaction: the
     * read above is what the write is conditioned on.
     */
    const next = seats.map((seat, at) =>
      at === index
        ? { ...(seat as Record<string, unknown>), tipMinorUnits: amount }
        : seat,
    );

    tx.update(ref, { seats: next });
    // The tip is the SEAT's, so the row names that seat's person — never the
    // barber who typed it in, never the booker of a companion's cut.
    subjects = seatSubjectsOf(data, seatId);
  });

  if (!unchanged) {
    await appendAudit({
      actor: callerActor(request),
      // The ACT, not the amount — "who recorded tips" and "how much" are
      // different questions, and the second one belongs to the booking
      // rather than to the log.
      action: amount === null ? 'booking.tip_cleared' : 'booking.tip_recorded',
      resourceId: appointmentId,
      subjects,
      atIso: new Date().toISOString(),
      context: { seatId },
      // The seat AND the instant: two seats of one guest tipped in the same
      // millisecond are still two acts.
      changeKey: `tip:${seatId}:${recordedAtMs}`,
    });
  }

  return { appointmentId, seatId, unchanged };
});
