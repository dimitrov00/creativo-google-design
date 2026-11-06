import type { DocumentSnapshot, Firestore } from 'firebase-admin/firestore';
import { RecurrenceEnd } from '@core/components';
import {
  type BlockSeries,
  Collections,
  type ScheduleException,
} from '@core/entities';
import type {
  BlockSeriesWritePorts,
  EndlessBlockSeriesPorts,
} from '@core/ports';
import { Result, defect } from '@core/primitives';
import { readFailed, writeFailed } from './store-answer';

/** A stored document as its entity — `{ id, ...data }` (Law 5, no mapper) — or `null` when absent. */
function entityOrNull<E>(snap: DocumentSnapshot): E | null {
  const data = snap.data();
  return data === undefined ? null : ({ id: snap.id, ...data } as E);
}

/**
 * The repeating blocks the daily write-ahead reads and writes (owner,
 * 2026-11-06): `listEndlessBlockSeries` lists every series that never ends
 * (`recurrenceEnd == NEVER`, a single-field query), and `writeBlockSeries`
 * reads every day's exception AND every named series in ONE transaction,
 * hands both to the pure decision and writes its answer — the web adapter's
 * contract (`block-series.adapter.ts`), over the Admin SDK.
 */
export const firestoreBlockSeriesPorts = (
  db: Firestore,
): BlockSeriesWritePorts & EndlessBlockSeriesPorts => ({
  listEndlessBlockSeries: async () => {
    try {
      // A cut ends the old series, so endless ones never accumulate.
      // unbounded-ok: one endless series per chair's repeat (a lunch, an admin hour)
      const snap = await db
        .collection(Collections.BlockSeries)
        .where('recurrenceEnd', '==', RecurrenceEnd.Never)
        .get();
      return Result.ok(
        snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as BlockSeries),
      );
    } catch (error) {
      return Result.err(readFailed(Collections.BlockSeries, error));
    }
  },

  writeBlockSeries: async (keys, seriesIds, decide) => {
    const dayRefs = keys.map((key) =>
      db.collection(Collections.ScheduleExceptions).doc(key),
    );
    const seriesRefs = seriesIds.map((id) =>
      db.collection(Collections.BlockSeries).doc(id),
    );
    try {
      return await db.runTransaction(async (tx) => {
        const refs = [...dayRefs, ...seriesRefs];
        const snaps = refs.length === 0 ? [] : await tx.getAll(...refs);
        const stored = {
          exceptions: snaps
            .slice(0, dayRefs.length)
            .map((snap) => entityOrNull<ScheduleException>(snap)),
          series: snaps
            .slice(dayRefs.length)
            .map((snap) => entityOrNull<BlockSeries>(snap)),
        };
        const decided = decide(stored);
        if (!decided.ok) return decided;
        const write = <E extends { readonly id: string }>(
          at: typeof dayRefs,
          before: readonly (E | null)[],
          after: readonly (E | null)[],
        ): void => {
          if (after.length !== at.length) {
            defect(
              `writeBlockSeries: ${at.length} documents, ${after.length} answers`,
            );
          }
          at.forEach((ref, i) => {
            const next = after.at(i) ?? null;
            if (next !== null) {
              const { id, ...body } = next;
              if (id !== ref.id) {
                defect(`writeBlockSeries: ${id} answered for ${ref.id}`);
              }
              tx.set(ref, body);
            } else if (before.at(i) !== null) {
              tx.delete(ref);
            }
          });
        };
        write(dayRefs, stored.exceptions, decided.value.exceptions);
        write(seriesRefs, stored.series, decided.value.series);
        return Result.ok(undefined);
      });
    } catch (error) {
      return Result.err(writeFailed(Collections.BlockSeries, error));
    }
  },
});
