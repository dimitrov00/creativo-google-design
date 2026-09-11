import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { ZonedDateTime } from '@creativo/domain/kernel';
import {
  type AppointmentStatus,
  type CancellationReason,
  canTransition,
  rootCancellationReason,
  seatCancelled,
} from '@creativo/domain/scheduling';
import { seatOutcomeToDocument } from '@creativo/application/booking';
import { adminFirestore } from '../firebase-admin';
import { loadBookingPolicy } from './load-booking-policy';
import { appendAudit } from './audit';
import { applyVoucherRestore, planVoucherRestore } from './voucher-restore';

/**
 * The cancellation write path — a callable, like `commitBooking`, and for the
 * same reason: the browser must not write appointments.
 *
 * The direct-write cancel the rules briefly allowed (owner flips
 * `status.kind` to `'cancelled'`) was a trap with two jaws. Nothing in the
 * client could USE it — the browser repository refuses `save()` outright —
 * so every user cancel errored; and even a successful direct write would
 * have left the public `barberBusy` projection untouched, blocking the slot
 * forever and starving the waitlist matcher of the one event it watches
 * for. Cancelling here writes the appointment; the `rebuildBusy` trigger
 * then recomputes the projection, which is also what finally makes the
 * matcher's "a booking cancelled" story true.
 *
 * The owner comes from `request.auth`, never the payload — the same rule as
 * every other identity in this app.
 */
export const cancelAppointment = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError(
      'unauthenticated',
      'Sign in to cancel an appointment',
      { code: 'booking.cancel.unauthenticated' },
    );
  }

  const payload = (request.data ?? {}) as Record<string, unknown>;
  const appointmentId = String(payload['appointmentId'] ?? '');
  const reason = String(payload['reason'] ?? '').trim();
  if (appointmentId.length === 0) {
    throw new HttpsError('invalid-argument', 'appointmentId is required', {
      code: 'booking.cancel.invalid_input',
    });
  }

  const db = adminFirestore();
  // The tenant's window, read OUTSIDE the transaction — policy is tuning
  // data and must not widen the conflict set.
  const policy = await loadBookingPolicy(db);

  await db.runTransaction(async (tx) => {
    const ref = db.collection('appointments').doc(appointmentId);
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!data) {
      throw new HttpsError('not-found', 'No such appointment', {
        code: 'booking.cancel.not_found',
      });
    }
    if (data['ownerUserId'] !== uid) {
      // Indistinguishable from not-found on purpose: confirming that an
      // appointment id EXISTS to someone who does not own it is a leak.
      throw new HttpsError('not-found', 'No such appointment', {
        code: 'booking.cancel.not_found',
      });
    }

    const status = (data['status'] ?? {}) as AppointmentStatus;
    // The domain's own lifecycle graph, not a re-encoded copy: completed,
    // no-show and already-cancelled appointments refuse the transition.
    if (!canTransition(status, 'cancelled')) {
      throw new HttpsError(
        'failed-precondition',
        'This appointment can no longer be cancelled',
        { code: 'booking.cancel.not_cancellable' },
      );
    }

    // What gift vouchers paid comes back with the visit — read now, before
    // any write, and written after the status below.
    const timeSlotZone = String(
      (data['timeSlot'] as Record<string, unknown> | undefined)?.['zone'] ??
        'Europe/Sofia',
    );
    const restore = await planVoucherRestore(tx, db, data, {
      iso: new Date().toISOString(),
      zone: timeSlotZone,
    });

    // The free-cancellation window (`BookingPolicy.mayCancelAt` — the SAME
    // rule the appointments page renders as a deadline and disables its
    // button by). The policy carried this number from day one and nothing
    // enforced it: a client could cancel five minutes before the chair.
    // A start that fails to parse falls OPEN (cancellable): refusing a
    // cancel over a malformed date would trap someone in a booking forever.
    const timeSlot = (data['timeSlot'] ?? {}) as Record<string, unknown>;
    const start = ZonedDateTime.fromISO(
      String(timeSlot['startIso'] ?? ''),
      String(timeSlot['zone'] ?? 'Europe/Sofia'),
    );
    if (
      start.isSuccess() &&
      !policy.mayCancelAt(start.value.toMillis(), Date.now())
    ) {
      throw new HttpsError(
        'failed-precondition',
        'The free-cancellation window has closed — call the shop instead',
        {
          code: 'booking.cancel.window_closed',
          params: { windowHours: String(policy.cancellationWindowHours) },
        },
      );
    }

    /*
     * THE SEATS SAY WHO AND WHEN (2026-09-11). This path wrote the root and
     * nothing else, so every seat of a client's cancellation read back as
     * derived — stamped by the shop, at the seat's own end time, with the
     * root's stand-in string for a reason — and the staff sheet, once it
     * began to say what became of a visit, said all three wrong. The
     * client's sentence rides as `other`, in their words; nothing typed is
     * `unspecified`, the same bucket the shop's own unexplained cancels use.
     */
    const cancellation: CancellationReason =
      reason.length > 0
        ? { kind: 'other', note: reason }
        : { kind: 'unspecified' };
    const outcome = seatOutcomeToDocument(
      seatCancelled(Date.now(), 'client', cancellation),
    );
    const seats = Array.isArray(data['seats'])
      ? (data['seats'] as Record<string, unknown>[])
      : [];
    const isResolved = (seat: Record<string, unknown>): boolean => {
      const kind = (seat['outcome'] as Record<string, unknown> | undefined)?.[
        'kind'
      ];
      return typeof kind === 'string' && kind !== 'scheduled';
    };

    tx.update(ref, {
      status: {
        kind: 'cancelled',
        // The root keeps the client's own sentence when there is one — the
        // seats hold the code — and the code alone when there is not.
        reason:
          reason.length > 0 ? reason : rootCancellationReason(cancellation),
      },
      seats: seats.map((seat) =>
        isResolved(seat) ? seat : { ...seat, outcome },
      ),
      ...(restore ? { voucherRedemptions: restore.voucherRedemptions } : {}),
    });
    if (restore) applyVoucherRestore(tx, restore);
  });

  void appendAudit({
    actorUserId: uid,
    action: 'booking.cancelled',
    resourceId: appointmentId,
    atIso: new Date().toISOString(),
    context: reason ? { reason } : undefined,
  });

  return { appointmentId };
});
