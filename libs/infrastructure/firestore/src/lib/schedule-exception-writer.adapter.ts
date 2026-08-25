import { Injectable, inject } from '@angular/core';
import { deleteDoc, setDoc } from 'firebase/firestore';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import {
  ScheduleExceptionWriter,
  exceptionToDocument,
} from '@creativo/application/booking';
import { RepositoryError } from '@creativo/application/shared';
import { BarberId } from '@creativo/domain/catalog';
import { Result, fail, ok } from '@creativo/domain/kernel';
import { ScheduleException } from '@creativo/domain/scheduling';
import { scheduleExceptionDocRef } from './firestore-paths';

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
