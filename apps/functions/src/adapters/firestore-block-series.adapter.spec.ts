import type { Firestore } from 'firebase-admin/firestore';
import { RecurrenceEnd } from '@core/components';
import { SchedulingError } from '@core/errors';
import { BlockSeriesId, BusyKey, Result } from '@core/primitives';
import { Collections } from '@core/entities';
import { FIXTURE_IDS, localDate } from '@core/testing';
import { createProjectionFirestore } from '../test-support/fake-projection-firestore';
import { firestoreBlockSeriesPorts } from './firestore-block-series.adapter';

/*
 * The daily write-ahead's adapter, over the in-memory Admin SDK: it lists
 * only the series that never end, and writes the days and the series in
 * one transaction — a refusal writes nothing, a `null` deletes.
 */

const DAY = localDate('2026-11-09');
const key = BusyKey.of(FIXTURE_IDS.barber, DAY);
const seriesBody = (recurrenceEnd: string) => ({
  barberId: FIXTURE_IDS.barber,
  recurrenceEnd,
  localDates: [DAY],
});

describe('firestoreBlockSeriesPorts', () => {
  it('lists the series that never end, and only those', async () => {
    const fake = createProjectionFirestore({
      [`${Collections.BlockSeries}/s-endless`]: seriesBody(RecurrenceEnd.Never),
      [`${Collections.BlockSeries}/s-until`]: seriesBody(RecurrenceEnd.Until),
    });
    const ports = firestoreBlockSeriesPorts(fake.db as unknown as Firestore);
    const listed = await ports.listEndlessBlockSeries();
    expect(listed.ok && listed.value.map((series) => series.id)).toEqual([
      's-endless',
    ]);
  });

  it('reads the days and the series together and writes the answer back', async () => {
    const fake = createProjectionFirestore({
      [`${Collections.BlockSeries}/s-1`]: seriesBody(RecurrenceEnd.Never),
    });
    const ports = firestoreBlockSeriesPorts(fake.db as unknown as Firestore);
    const written = await ports.writeBlockSeries(
      [key],
      [BlockSeriesId.of('s-1')],
      (stored) => {
        expect(stored.exceptions).toEqual([null]);
        expect(stored.series[0]?.id).toBe('s-1');
        return Result.ok({
          exceptions: [
            {
              id: key,
              barberId: FIXTURE_IDS.barber,
              localDate: DAY,
            } as never,
          ],
          series: [null],
        });
      },
    );
    expect(written.ok).toBe(true);
    expect(fake.docs.get(`${Collections.ScheduleExceptions}/${key}`)).toEqual({
      barberId: FIXTURE_IDS.barber,
      localDate: DAY,
    });
    expect(fake.docs.has(`${Collections.BlockSeries}/s-1`)).toBe(false);
  });

  it('writes nothing when the decision refuses', async () => {
    const fake = createProjectionFirestore({
      [`${Collections.BlockSeries}/s-1`]: seriesBody(RecurrenceEnd.Never),
    });
    const ports = firestoreBlockSeriesPorts(fake.db as unknown as Firestore);
    const refused = await ports.writeBlockSeries(
      [key],
      [BlockSeriesId.of('s-1')],
      () =>
        Result.err(SchedulingError.blockSeriesMoved(BlockSeriesId.of('s-1'))),
    );
    expect(refused.ok).toBe(false);
    expect(fake.docs.has(`${Collections.BlockSeries}/s-1`)).toBe(true);
    expect(fake.docs.has(`${Collections.ScheduleExceptions}/${key}`)).toBe(
      false,
    );
  });
});
