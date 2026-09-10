import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { adminFirestore } from '../firebase-admin';
import { appendAudit } from './audit';
import { callerWorksTheBook } from './caller-roles';

/**
 * The inverse of `markArrived` — the desk takes a stamp back.
 *
 * Arrival is a stamp beside the status, never an edge in the lifecycle graph,
 * so clearing it is a one-field write with the same gate as setting it: only
 * a live visit (pending or confirmed) can have its arrival unsaid. A settled
 * visit's arrival is history and stays.
 *
 * Idempotent, like its twin: clearing what was never set is a no-op that
 * returns `alreadyClear`, not an error — the undo toast that calls this has
 * an 8-second life and may outlive a second tap.
 */
const LIVE = ['pending', 'confirmed'];

export const clearArrival = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in first', {
      code: 'booking.arrived.unauthenticated',
    });
  }
  if (!callerWorksTheBook(request)) {
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
  let alreadyClear = false;
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
    if (!LIVE.includes(String(status['kind']))) {
      throw new HttpsError(
        'failed-precondition',
        'That visit is already settled',
        {
          code: 'booking.arrived.not_allowed',
          params: { from: String(status['kind']), to: 'unarrived' },
        },
      );
    }
    if (data['arrivedAt'] == null) {
      alreadyClear = true;
      return;
    }
    tx.update(ref, { arrivedAt: null });
  });

  if (!alreadyClear) {
    void appendAudit({
      actorUserId: uid,
      action: 'booking.staff_unarrived',
      resourceId: appointmentId,
      targetUserId: ownerUserId ?? undefined,
      atIso: new Date().toISOString(),
    });
  }
  return { appointmentId, alreadyClear };
});
