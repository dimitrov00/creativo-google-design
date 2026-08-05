import type { Firestore } from 'firebase-admin/firestore';
import type { BookingPolicy } from '@creativo/domain/scheduling';
import {
  BOOKING_POLICY_DOC,
  SETTINGS_COLLECTION,
  policyFromDocument,
} from '@creativo/application/booking';

/**
 * The tenant policy, as the SERVER reads it.
 *
 * The same document and the same parser the browser uses
 * (`policyFromDocument`), so the horizon a visitor scrolls and the horizon
 * the commit re-check enforces cannot disagree. Before this existed the
 * server hardcoded `BookingPolicy.default()` in three places — an admin
 * raising the horizon would have widened the calendar while the server kept
 * refusing everything past the default, which is the worst kind of setting:
 * one that looks applied.
 *
 * A plain read, not a transaction read: policy is tuning data, uncontended
 * and eventually consistent by nature, and it must never widen the commit
 * transaction's conflict set.
 */
export async function loadBookingPolicy(db: Firestore): Promise<BookingPolicy> {
  const snap = await db
    .collection(SETTINGS_COLLECTION)
    .doc(BOOKING_POLICY_DOC)
    .get();
  return policyFromDocument(snap.data());
}
