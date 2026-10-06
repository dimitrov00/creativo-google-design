import { Injectable, inject } from '@angular/core';
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import {
  APPOINTMENT_PHOTOS_COLLECTION,
  type AppointmentPhoto,
  type ClientPhotosReader,
} from '@creativo/application/booking';
import { RepositoryError } from '@creativo/application/shared';
import { Result, fail, ok } from '@creativo/domain/kernel';
import { toPhoto } from './appointment-photos.adapter';

/** Firestore's cap on the values of one `in` filter. */
const IN_FILTER_MAX = 30;

/**
 * A client's past cuts across their visits, from the same staff-only
 * `appointmentPhotos` documents a visit's own photos are — read once, each
 * document read by `toPhoto`, so both readers see a photo one way. Beside
 * `FirebaseAppointmentPhotos` because the photos are that lib's, though
 * nothing here touches the bytes: the stored URL is what renders.
 *
 * Only the visits' own pictures count. `origin` stays out of the queries:
 * a document written before the field existed has none, and `toPhoto`
 * reads that as a shot — a filter on the field would drop exactly those.
 */
@Injectable()
export class FirebaseClientPhotosReader implements ClientPhotosReader {
  private readonly db = inject(FIREBASE_FIRESTORE);

  /**
   * The client's newest photos: `(clientUserId ASC, takenAtIso DESC)`. The
   * `orderBy` is not optional — without it a `limit` keeps the first
   * documents by id, not the newest.
   */
  async listForClient(
    userId: string,
    options: { readonly limit: number },
  ): Promise<Result<readonly AppointmentPhoto[], RepositoryError>> {
    if (userId.trim().length === 0 || options.limit < 1) return ok([]);
    try {
      const snapshot = await getDocs(
        query(
          collection(this.db, APPOINTMENT_PHOTOS_COLLECTION),
          where('clientUserId', '==', userId),
          orderBy('takenAtIso', 'desc'),
          limit(Math.floor(options.limit)),
        ),
      );
      return ok(
        snapshot.docs.flatMap((entry) => {
          const photo = toPhoto(entry.id, entry.data());
          return photo !== null && photo.origin === 'shot' ? [photo] : [];
        }),
      );
    } catch (error) {
      return fail(
        new RepositoryError("Failed to read the client's photos", error),
      );
    }
  }

  /**
   * One history page's marks: `appointmentId in […]`, thirty ids a query,
   * counted here. A single-field filter, so no index of its own.
   */
  async countByAppointment(
    appointmentIds: readonly string[],
  ): Promise<Result<ReadonlyMap<string, number>, RepositoryError>> {
    const counts = new Map(appointmentIds.map((id) => [id, 0]));
    const asked = [...counts.keys()].filter((id) => id.trim().length > 0);
    if (asked.length === 0) return ok(counts);
    try {
      const snapshots = await Promise.all(
        chunks(asked, IN_FILTER_MAX).map((ids) =>
          getDocs(
            query(
              collection(this.db, APPOINTMENT_PHOTOS_COLLECTION),
              where('appointmentId', 'in', ids),
            ),
          ),
        ),
      );
      for (const snapshot of snapshots) {
        for (const entry of snapshot.docs) {
          const photo = toPhoto(entry.id, entry.data());
          const count =
            photo === null ? undefined : counts.get(photo.appointmentId);
          if (
            photo !== null &&
            photo.origin === 'shot' &&
            count !== undefined
          ) {
            counts.set(photo.appointmentId, count + 1);
          }
        }
      }
      return ok(counts);
    } catch (error) {
      return fail(new RepositoryError('Failed to count visit photos', error));
    }
  }
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    out.push(items.slice(start, start + size));
  }
  return out;
}
