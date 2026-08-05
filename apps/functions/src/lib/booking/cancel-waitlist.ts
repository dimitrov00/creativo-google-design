import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { adminFirestore } from '../firebase-admin';
import { WAITLIST_COLLECTION } from '../../adapters/firestore-waitlist-store';

/**
 * Withdraw a waitlist request — the callable the client gateway has promised
 * (`httpsCallable('cancelWaitlist')`) since the gateway shipped, and which
 * simply did not exist server-side. The rules briefly carried a direct-write
 * withdraw grant instead; nothing ever used it, and two doors to one
 * transition is one door too many — the grant is gone and this is the path.
 *
 * Idempotent on purpose: cancelling an already-cancelled request succeeds.
 * The user's intent — "stop watching" — is already true, and a retry after a
 * lost response must not read as an error.
 */
export const cancelWaitlist = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in to manage the waitlist', {
      code: 'booking.waitlist.unauthenticated',
    });
  }

  const requestId = String(
    ((request.data ?? {}) as Record<string, unknown>)['requestId'] ?? '',
  );
  if (requestId.length === 0) {
    throw new HttpsError('invalid-argument', 'requestId is required', {
      code: 'booking.waitlist.invalid_request',
    });
  }

  const db = adminFirestore();
  await db.runTransaction(async (tx) => {
    const ref = db.collection(WAITLIST_COLLECTION).doc(requestId);
    const snap = await tx.get(ref);
    const data = snap.data();
    // Not-found and not-yours answer identically — confirming a foreign
    // request id exists is a leak.
    if (!data || data['ownerUserId'] !== uid) {
      throw new HttpsError('not-found', 'No such waitlist request', {
        code: 'booking.waitlist.not_found',
      });
    }

    const status = String(data['status'] ?? '');
    if (status === 'cancelled') return; // already what the caller wants
    if (status !== 'open' && status !== 'matched') {
      // `booked`/`expired` are the matcher's terminal verdicts; rewriting
      // them would falsify history the shop may be looking at.
      throw new HttpsError(
        'failed-precondition',
        'This request has already concluded',
        { code: 'booking.waitlist.not_cancellable' },
      );
    }
    tx.update(ref, { status: 'cancelled' });
  });

  return { requestId };
});
