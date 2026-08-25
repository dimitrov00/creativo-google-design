import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { STAFF_ROLES } from '@creativo/domain/accounts';
import { adminFirestore } from '../firebase-admin';
import { appendAudit } from './audit';

/**
 * Record that the party walked in.
 *
 * ### Why this is not a `transitionAppointment` verb
 * Arriving is not an edge in the lifecycle graph. `transitionAppointment`
 * exists because confirm/complete/no-show/cancel are one fact ("this
 * appointment is now X") guarded by one graph; arrival is a fact recorded
 * ALONGSIDE the status, which is exactly why it survives every later
 * transition and why `canTransition` is not consulted here.
 *
 * ### Why it exists at all
 * `confirmed` used to double as "this person is here" — a reading available
 * only while nothing auto-confirmed. The owner ruling of 2026-08-07 turns
 * auto-confirm on by default, so without this stamp the front desk would LOSE
 * the arrival signal rather than gain one, and no visit served would ever
 * carry a punctuality record. It cannot be backfilled.
 *
 * ### Idempotent
 * The first stamp wins. A second tap on a busy Saturday must not quietly move
 * a client's arrival ten minutes later, and two staff holding phones over the
 * same row is the operating mode, not the edge case.
 */
const ARRIVABLE = ['pending', 'confirmed'];

function isStaffCaller(request: { auth?: { token?: object } }): boolean {
  const token = (request.auth?.token ?? {}) as Record<string, unknown>;
  const roles = Array.isArray(token['roles']) ? token['roles'] : [];
  return roles.some((role) =>
    (STAFF_ROLES as readonly string[]).includes(String(role)),
  );
}

export const markArrived = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in first', {
      code: 'booking.arrived.unauthenticated',
    });
  }
  if (!isStaffCaller(request)) {
    throw new HttpsError('permission-denied', 'Staff only', {
      code: 'booking.arrived.forbidden',
    });
  }

  const payload = (request.data ?? {}) as Record<string, unknown>;
  const appointmentId = String(payload['appointmentId'] ?? '');
  if (appointmentId.length === 0) {
    throw new HttpsError('invalid-argument', 'Invalid request', {
      code: 'booking.arrived.invalid_input',
    });
  }

  const db = adminFirestore();
  let alreadyArrived = false;
  let ownerUserId: string | null = null;

  await db.runTransaction(async (tx) => {
    const ref = db.collection('appointments').doc(appointmentId);
    const snap = await tx.get(ref);
    const data = snap.data();
    if (!data) {
      throw new HttpsError('not-found', 'No such appointment', {
        code: 'booking.arrived.not_found',
      });
    }

    ownerUserId =
      typeof data['ownerUserId'] === 'string' ? data['ownerUserId'] : null;

    const status = (data['status'] ?? {}) as Record<string, unknown>;
    if (!ARRIVABLE.includes(String(status['kind']))) {
      // Arriving after the shop recorded the visit as finished, cancelled or
      // missed is a mis-tap, not a fact.
      throw new HttpsError(
        'failed-precondition',
        'That visit is already settled',
        {
          code: 'booking.arrived.not_allowed',
          params: { from: String(status['kind']), to: 'arrived' },
        },
      );
    }

    if (data['arrivedAt'] != null) {
      alreadyArrived = true;
      return;
    }

    // The SERVER's clock, never the caller's — a device with a wrong clock
    // would otherwise poison every punctuality figure computed downstream.
    // Stored as `{iso, zone}` like `bookedAt`, so a staff surface can render
    // it in shop time rather than the reader's.
    const now = new Date();
    tx.update(ref, {
      arrivedAt: {
        iso: now.toISOString(),
        zone: String(
          (data['timeSlot'] as Record<string, unknown> | undefined)?.['zone'] ??
            'Europe/Sofia',
        ),
      },
    });
  });

  if (!alreadyArrived) {
    void appendAudit({
      actorUserId: uid,
      action: 'booking.staff_arrived',
      resourceId: appointmentId,
      // From the DOCUMENT, never the payload — "who did what to whom" must
      // name the real owner, not whoever the caller claimed.
      targetUserId: ownerUserId ?? undefined,
      atIso: new Date().toISOString(),
    });
  }

  return { appointmentId, alreadyArrived };
});
