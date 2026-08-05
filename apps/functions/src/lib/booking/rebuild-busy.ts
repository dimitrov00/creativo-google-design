import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import type { DocumentData, Firestore } from 'firebase-admin/firestore';
import { Interval } from '@creativo/domain/scheduling';
import { busyContributionsOf, mergeBusy } from '@creativo/application/booking';
import { busyPurgeAt } from '../../adapters/firestore-booking-store';
import { adminFirestore } from '../firebase-admin';

/**
 * Keep `barberBusy` equal to what the appointments actually say.
 *
 * ### Why a rebuild, not a subtraction
 * The projection stores NORMALIZED geometry — touching spans merged so a
 * visitor learns density, never client count. Merging is lossy on purpose,
 * and lossy merges cannot be subtracted from: "remove 14:00–15:00" from a
 * span that also contains someone else's 15:00–16:00 needs to know where one
 * booking ends and the next begins, which is exactly what the projection
 * deliberately forgot. So a change RECOMPUTES each affected (barber, day)
 * doc from every live appointment that touches it. Recomputing is idempotent
 * — two racing runs converge on the same bytes — and it repairs any drift,
 * whatever wrote it.
 *
 * ### What this closes
 * Before this trigger the projection was accumulate-only: the commit
 * transaction unioned intervals in and NOTHING ever took them out. A
 * cancelled appointment kept its slot blocked forever, and the waitlist
 * matcher — which listens to `barberBusy` precisely so it can notice a day
 * freeing up — could never fire for the one event it exists for.
 *
 * The commit transaction still writes the projection synchronously (its
 * conflict check depends on reading it in-tx); this trigger then recomputes
 * the same bytes, which is a no-op. Only a write that REMOVES occupancy — a
 * cancellation — produces a different result, and that write is what wakes
 * `matchWaitlistOnBusyChange` downstream.
 */
export const rebuildBusyOnAppointmentChange = onDocumentWritten(
  'appointments/{appointmentId}',
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();

    // Affected keys from BOTH sides of the write: a reschedule (different
    // day) must free the old doc and fill the new one.
    const keys = new Set<string>([
      ...affectedBusyKeys(before),
      ...affectedBusyKeys(after),
    ]);
    if (keys.size === 0) return;

    const db = adminFirestore();
    for (const key of keys) {
      await rebuildBusyDocument(db, key);
    }
  },
);

/** The doc's own mirror when present, else re-derived from its seats. */
function affectedBusyKeys(data: DocumentData | undefined): readonly string[] {
  if (!data) return [];
  const mirrored = data['busyKeys'];
  if (Array.isArray(mirrored) && mirrored.length > 0) {
    return mirrored.map(String);
  }
  return [...busyContributionsOf(data).keys()];
}

/**
 * Recompute ONE (barber, day) projection doc inside a transaction.
 *
 * The transaction is what serializes this against a concurrent
 * `commitBooking`: the commit reads the busy doc in ITS transaction, so a
 * rebuild racing it either commits first (the commit retries onto the
 * rebuilt base) or loses and re-runs against the committed appointment set.
 * Either order converges, because the input is the appointments themselves.
 */
async function rebuildBusyDocument(db: Firestore, key: string): Promise<void> {
  const separator = key.lastIndexOf('__');
  if (separator <= 0) return;
  const barberId = key.slice(0, separator);
  const dayKey = key.slice(separator + 2);

  try {
    await db.runTransaction(async (tx) => {
      const live = await tx.get(
        db
          .collection('appointments')
          .where('busyKeys', 'array-contains', key)
          .where('status.kind', 'in', ['pending', 'confirmed']),
      );

      let zone: string | null = null;
      const intervals: Interval[] = [];
      for (const doc of live.docs) {
        const contribution = busyContributionsOf(doc.data()).get(key);
        if (!contribution) continue;
        zone = zone ?? contribution.zone;
        intervals.push(...contribution.intervals);
      }

      const ref = db.collection('barberBusy').doc(key);
      if (zone === null) {
        // Nothing live occupies this doc. Delete rather than writing an
        // empty one — readers treat both identically, and a deleted doc is
        // one the anonymous surface cannot even enumerate.
        tx.delete(ref);
        return;
      }

      tx.set(ref, {
        barberId,
        dayKey,
        zone,
        // The same normalize-and-format path the commit write uses, so a
        // rebuild after a no-op change produces byte-identical slots.
        busy: mergeBusy([], intervals, zone),
        purgeAt: busyPurgeAt(dayKey),
      });
    });
  } catch (error) {
    // Surfaced for the operator, not swallowed as success: the projection is
    // repaired by the NEXT write either way (recompute-from-truth), but a
    // persistent failure here means cancelled slots stay blocked.
    logger.error('barberBusy rebuild failed', { key, error });
    throw error;
  }
}
