import {
  type Firestore,
  collection,
  doc,
  limit,
  orderBy,
  query,
  runTransaction,
  where,
} from 'firebase/firestore';
import type { BlockSeries, ScheduleException } from '@core/entities';
import { Collections } from '@core/entities';
import type {
  BlockSeriesStreamPorts,
  BlockSeriesWritePorts,
} from '@core/ports';
import { Result, defect } from '@core/primitives';
import { observeQuery } from './observe';
import { entityOf, writeFailed } from './stored-entity';

/** How many of a chair's newest series a screen reads — years of lunches and admin hours. */
const SERIES_PER_CHAIR = 100;

/**
 * A chair's repeating blocks (owner, 2026-11-06: "a lunch break is a
 * recurring blocker") — `blockSeries`, staff-only.
 *
 * `observeBlockSeries` reads the chair's series live, the newest first
 * (`barberId ==` over `startLocalDate` descending, a declared composite
 * index): a chair's series end and are cut over the years, and the screen
 * only ever needs the ones still writing days. `writeBlockSeries` reads every day's exception AND
 * every named series inside ONE transaction, hands both to the pure
 * decision and writes its answer back: a `null` answer deletes a document
 * that was there, and one that held nothing and still holds nothing is not
 * written. The arithmetic is `BlockSeriesSystem`'s and
 * `ScheduleExceptionSystem`'s, handed in as `decide` — none of it is here.
 */
export const blockSeriesPorts = (
  db: Firestore,
): BlockSeriesStreamPorts & BlockSeriesWritePorts => ({
  observeBlockSeries: (barberId) =>
    observeQuery<BlockSeries>(
      query(
        collection(db, Collections.BlockSeries),
        where('barberId', '==', barberId),
        orderBy('startLocalDate', 'desc'),
        limit(SERIES_PER_CHAIR),
      ),
      Collections.BlockSeries,
    ),

  writeBlockSeries: async (keys, seriesIds, decide) => {
    const dayRefs = keys.map((key) =>
      doc(db, Collections.ScheduleExceptions, key),
    );
    const seriesRefs = seriesIds.map((id) =>
      doc(db, Collections.BlockSeries, id),
    );
    try {
      return await runTransaction(db, async (tx) => {
        const [daySnaps, seriesSnaps] = await Promise.all([
          Promise.all(dayRefs.map((ref) => tx.get(ref))),
          Promise.all(seriesRefs.map((ref) => tx.get(ref))),
        ]);
        const read = <E>(snap: (typeof daySnaps)[number]): E | null => {
          const data = snap.data();
          return data === undefined ? null : entityOf<E>(snap.id, data);
        };
        const stored = {
          exceptions: daySnaps.map((snap) => read<ScheduleException>(snap)),
          series: seriesSnaps.map((snap) => read<BlockSeries>(snap)),
        };
        const decided = decide(stored);
        if (!decided.ok) return decided;
        const write = <E extends { readonly id: string }>(
          refs: typeof dayRefs,
          before: readonly (E | null)[],
          after: readonly (E | null)[],
        ) => {
          if (after.length !== refs.length) {
            defect(
              `writeBlockSeries: ${refs.length} documents, ${after.length} answers`,
            );
          }
          refs.forEach((ref, i) => {
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
    } catch (cause) {
      return Result.err(writeFailed(Collections.BlockSeries, cause));
    }
  },
});
