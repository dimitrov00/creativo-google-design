import { Injectable, inject } from '@angular/core';
import { deleteDoc, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { Observable } from 'rxjs';
import {
  FIREBASE_AUTH,
  FIREBASE_FIRESTORE,
} from '@creativo/infrastructure/firebase-app';
import {
  APPOINTMENT_NOTES_COLLECTION,
  type AppointmentNote,
  type AppointmentNotes,
} from '@creativo/application/booking';
import { RepositoryError } from '@creativo/application/shared';
import { Result, fail, ok } from '@creativo/domain/kernel';
import { subscribeWithRetry } from './subscribe-with-retry';

/**
 * `appointmentNotes/{appointmentId}` — the team's note, staff-only.
 *
 * A plain `setDoc`, deliberately: the collection is `read, write: if
 * worksTheBook()` and the document carries nothing the availability engine
 * has to see, so there is no callable between the sheet and the write. The
 * author and the instant are stamped here so the note can say who wrote it.
 */
@Injectable()
export class FirestoreAppointmentNotes implements AppointmentNotes {
  private readonly db = inject(FIREBASE_FIRESTORE);
  private readonly auth = inject(FIREBASE_AUTH);

  observe(
    appointmentId: string,
  ): Observable<Result<AppointmentNote | null, RepositoryError>> {
    const ref = doc(this.db, APPOINTMENT_NOTES_COLLECTION, appointmentId);
    return subscribeWithRetry<AppointmentNote | null>((onNext, onError) =>
      onSnapshot(
        ref,
        (snapshot) => {
          const data = snapshot.data();
          const text = typeof data?.['text'] === 'string' ? data['text'] : '';
          onNext(
            text.trim().length === 0
              ? null
              : {
                  text,
                  authorUid:
                    typeof data?.['authorUid'] === 'string'
                      ? data['authorUid']
                      : null,
                  writtenAtIso:
                    typeof data?.['writtenAtIso'] === 'string'
                      ? data['writtenAtIso']
                      : null,
                },
          );
        },
        onError,
      ),
    );
  }

  async save(
    appointmentId: string,
    text: string | null,
  ): Promise<Result<void, RepositoryError>> {
    const ref = doc(this.db, APPOINTMENT_NOTES_COLLECTION, appointmentId);
    const trimmed = text?.trim() ?? '';
    try {
      if (trimmed.length === 0) {
        await deleteDoc(ref);
      } else {
        await setDoc(ref, {
          text: trimmed,
          authorUid: this.auth.currentUser?.uid ?? null,
          writtenAtIso: new Date().toISOString(),
        });
      }
      return ok(undefined);
    } catch (cause) {
      return fail(new RepositoryError('Could not save the note', cause));
    }
  }
}
