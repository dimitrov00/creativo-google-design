import type { Firestore } from 'firebase-admin/firestore';
import { Result } from '@core/primitives';
import { type CapacityMonth, Collections } from '@core/entities';
import type { CapacityReadPorts } from '@core/ports';
import { readFailed } from './store-answer';

/**
 * The capacity rollup's server read outside any transaction (flip 1,
 * blueprint §4.1 `sampleLeadTime`): several `capacity/{YYYY-MM}` documents
 * in ONE `getAll`, positions preserved (`out[i]` is `months[i]`, `null`
 * before its first rebuild) — read once and shared by every barber. Bodies
 * spread as stored; a read that throws answers a `RepositoryError` value
 * whose `reason` is the failure's canonical code. The rebuild itself reads
 * and writes these documents inside its own transaction (`ReadTx`), never
 * through here.
 */

export const firestoreCapacityPorts = (db: Firestore): CapacityReadPorts => ({
  loadCapacityMonths: async (months) => {
    // The Admin SDK refuses an empty `getAll`: nothing asked, nothing read.
    if (months.length === 0) return Result.ok([]);
    try {
      const snaps = await db.getAll(
        ...months.map((month) =>
          db.collection(Collections.Capacity).doc(month),
        ),
      );
      return Result.ok(
        snaps.map((snap) =>
          snap.exists
            ? ({ id: snap.id, ...snap.data() } as CapacityMonth)
            : null,
        ),
      );
    } catch (error) {
      return Result.err(readFailed(Collections.Capacity, error));
    }
  },
});
