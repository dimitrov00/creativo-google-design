import { Injectable, inject } from '@angular/core';
import { deleteDoc, getDoc, setDoc, writeBatch } from 'firebase/firestore';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import {
  ScheduleExceptionWriter,
  coalesceRanges,
  exceptionFromDocument,
  exceptionToDocument,
  withoutRange,
} from '@creativo/application/booking';
import { RepositoryError } from '@creativo/application/shared';
import { BarberId, LocationId } from '@creativo/domain/catalog';
import { Result, fail, ok } from '@creativo/domain/kernel';
import {
  CalendarDay,
  type EmptyExceptionRangesError,
  LocalTimeRange,
  ScheduleException,
  ScheduleExceptionId,
} from '@creativo/domain/scheduling';
import { scheduleExceptionDocRef } from './firestore-paths';

/** Firestore's ceiling on the writes one batch may carry. */
const BATCH_LIMIT = 500;

/**
 * What a day holds once `ranges` are added to it: the union with what is
 * there, coalesced — or `null` when a whole-day absence already covers
 * every minute, so the ranges add nothing and must not demote the day to
 * a partial block. ONE answer for `putRange` and `putSeries`.
 */
function withRanges(
  existing: ScheduleException | null,
  barberId: BarberId,
  locationId: LocationId,
  day: CalendarDay,
  ranges: readonly LocalTimeRange[],
): Result<ScheduleException, EmptyExceptionRangesError> | null {
  if (existing?.isWholeDay()) return null;
  const current =
    existing && 'ranges' in existing.detail ? existing.detail.ranges : [];
  return ScheduleException.create({
    id: ScheduleExceptionId.of(`${barberId.value}__${day.key()}`),
    day,
    barberId,
    locationId,
    detail: {
      kind: 'admin',
      ranges: coalesceRanges([...current, ...ranges]),
      note: '',
    },
  });
}

/**
 * `scheduleExceptions/{barberId}__{dayKey}` — staff's pen on the roster.
 *
 * A plain `setDoc`, deliberately: the collection is `write: if isStaff()` and
 * an exception cannot double-book anything (it only removes sellable time or
 * restates a day's hours), so there is no invariant here that needs a
 * transaction or a server round trip. `rebuildCapacityOnExceptionChange`
 * picks the write up and recomputes the projections.
 *
 * Everything privacy-sensitive is handled one layer up in
 * `exceptionToDocument`, which is total over the kind union — this adapter
 * never sees a reason it could leak.
 */
@Injectable()
export class FirestoreScheduleExceptionWriter implements ScheduleExceptionWriter {
  private readonly db = inject(FIREBASE_FIRESTORE);

  async put(
    exception: ScheduleException,
  ): Promise<Result<void, RepositoryError>> {
    const barberId = exception.barberId;
    if (barberId === null) {
      // A location-wide closure applies to every chair and is not this
      // document's shape — it would need a shop-level doc, which does not
      // exist yet. Refusing beats writing it under an empty barber id, where
      // it would silently match nothing.
      return fail(
        new RepositoryError(
          'A location-wide closure cannot be written per barber',
        ),
      );
    }
    try {
      await setDoc(
        scheduleExceptionDocRef(this.db, barberId, exception.day.key()),
        exceptionToDocument(exception),
      );
      return ok(undefined);
    } catch (cause) {
      return fail(new RepositoryError('Could not save the absence', cause));
    }
  }

  async putRange(
    barberId: string,
    locationId: string,
    dayKey: string,
    zone: string,
    range: LocalTimeRange,
  ): Promise<Result<void, RepositoryError>> {
    const id = BarberId.create(barberId);
    const location = LocationId.create(locationId);
    const day = CalendarDay.create(dayKey, zone);
    if (id.isFailure() || location.isFailure() || day.isFailure()) {
      return fail(new RepositoryError('Bad block address'));
    }
    try {
      const ref = scheduleExceptionDocRef(this.db, id.value, dayKey);
      const snapshot = await getDoc(ref);
      const existing = snapshot.exists()
        ? exceptionFromDocument(snapshot.data())
        : null;
      const exception = withRanges(
        existing,
        id.value,
        location.value,
        day.value,
        [range],
      );
      if (exception === null) return ok(undefined);
      if (exception.isFailure()) {
        return fail(new RepositoryError('Bad block', exception.error));
      }
      await setDoc(ref, exceptionToDocument(exception.value));
      return ok(undefined);
    } catch (cause) {
      return fail(new RepositoryError('Could not save the block', cause));
    }
  }

  async putSeries(
    barberId: string,
    locationId: string,
    dayKeys: readonly string[],
    zone: string,
    ranges: readonly LocalTimeRange[],
  ): Promise<Result<void, RepositoryError>> {
    const id = BarberId.create(barberId);
    const location = LocationId.create(locationId);
    if (id.isFailure() || location.isFailure()) {
      return fail(new RepositoryError('Bad block address'));
    }
    const days: CalendarDay[] = [];
    for (const dayKey of dayKeys) {
      const day = CalendarDay.create(dayKey, zone);
      if (day.isFailure()) {
        return fail(new RepositoryError('Bad block day', day.error));
      }
      days.push(day.value);
    }
    try {
      const refs = days.map((day) =>
        scheduleExceptionDocRef(this.db, id.value, day.key()),
      );
      // A whole day REPLACES what the day held, exactly as `put` does, so
      // there is nothing to read first; ranges merge, so every day is read
      // — in parallel, not one round trip after another.
      const snapshots =
        ranges.length === 0
          ? null
          : await Promise.all(refs.map((ref) => getDoc(ref)));
      const writes: {
        readonly ref: (typeof refs)[number];
        readonly exception: ScheduleException;
      }[] = [];
      for (const [index, day] of days.entries()) {
        const ref = refs[index];
        if (ref === undefined) continue;
        const snapshot = snapshots?.[index];
        const exception =
          snapshots === null
            ? ScheduleException.create({
                id: ScheduleExceptionId.of(`${barberId}__${day.key()}`),
                day,
                barberId: id.value,
                locationId: location.value,
                detail: { kind: 'time_off' },
              })
            : withRanges(
                snapshot?.exists()
                  ? exceptionFromDocument(snapshot.data())
                  : null,
                id.value,
                location.value,
                day,
                ranges,
              );
        if (exception === null) continue;
        if (exception.isFailure()) {
          return fail(new RepositoryError('Bad block', exception.error));
        }
        writes.push({ ref, exception: exception.value });
      }
      for (let from = 0; from < writes.length; from += BATCH_LIMIT) {
        const batch = writeBatch(this.db);
        for (const write of writes.slice(from, from + BATCH_LIMIT)) {
          batch.set(write.ref, exceptionToDocument(write.exception));
        }
        await batch.commit();
      }
      return ok(undefined);
    } catch (cause) {
      return fail(new RepositoryError('Could not save the series', cause));
    }
  }

  async clearRange(
    barberId: string,
    dayKey: string,
    range: LocalTimeRange,
  ): Promise<Result<void, RepositoryError>> {
    const id = BarberId.create(barberId);
    if (id.isFailure()) {
      return fail(new RepositoryError('Bad barber id', id.error));
    }
    try {
      const ref = scheduleExceptionDocRef(this.db, id.value, dayKey);
      const snapshot = await getDoc(ref);
      const existing = snapshot.exists()
        ? exceptionFromDocument(snapshot.data())
        : null;
      if (existing === null) return ok(undefined);
      if (!('ranges' in existing.detail)) {
        // A whole-day absence has no ranges to lift one from; the day-wide
        // clear is the honest path and the sheet offers it as such.
        return fail(new RepositoryError('The day is off, not blocked'));
      }
      const left = withoutRange(existing.detail.ranges, range);
      if (left.length === 0) {
        await deleteDoc(ref);
        return ok(undefined);
      }
      const exception = ScheduleException.create({
        id: existing.id,
        day: existing.day,
        barberId: existing.barberId,
        locationId: existing.locationId,
        detail: { ...existing.detail, ranges: left },
      });
      if (exception.isFailure()) {
        return fail(new RepositoryError('Bad block', exception.error));
      }
      await setDoc(ref, exceptionToDocument(exception.value));
      return ok(undefined);
    } catch (cause) {
      return fail(new RepositoryError('Could not lift the block', cause));
    }
  }

  async clear(
    barberId: string,
    dayKey: string,
  ): Promise<Result<void, RepositoryError>> {
    const id = BarberId.create(barberId);
    if (id.isFailure()) {
      return fail(new RepositoryError('Bad barber id', id.error));
    }
    try {
      await deleteDoc(scheduleExceptionDocRef(this.db, id.value, dayKey));
      return ok(undefined);
    } catch (cause) {
      return fail(new RepositoryError('Could not lift the absence', cause));
    }
  }
}
