import {
  type DocumentData,
  type Firestore,
  type QueryConstraint,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import {
  type FirebaseStorage,
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from 'firebase/storage';
import type { Observable } from 'rxjs';
import { subscribeWithRetry } from '@creativo/infrastructure/firestore';
import { PhotoOrigin } from '@core/components';
import { type AppointmentId, Result } from '@core/primitives';
import { RepositoryError } from '@core/errors';
import { type AppointmentPhoto, Collections } from '@core/entities';
import type { AppointmentPhotoPorts } from '@core/ports';
import {
  OBJECT_NOT_FOUND,
  mediaErrorOf,
  storageErrorCode,
} from './storage-error-code';

/** Firestore's cap on the values of one `in` filter. */
const IN_FILTER_MAX = 30;

const PHOTOS = Collections.AppointmentPhotos;

/** A photo document as its entity — the body beside its id (Law 5), no mapping. */
const photoOf = (id: string, data: DocumentData): AppointmentPhoto =>
  ({ id, ...data }) as AppointmentPhoto;

/** Only the visit's own pictures count as its photos — the shop's library pictures never do. */
const isShot = (photo: AppointmentPhoto): boolean =>
  photo.photoOrigin === PhotoOrigin.Shot;

/** Ascending by the instant taken — the order a visit's strip reads in. */
const byTaken = (a: AppointmentPhoto, b: AppointmentPhoto): number =>
  a.takenAtUtcMs - b.takenAtUtcMs;

/** The store's own reason for a failure: the SDK's `code`, else the message. */
function reasonOf(cause: unknown): string | null {
  const code = storageErrorCode(cause);
  if (code !== undefined) return code;
  return cause instanceof Error ? cause.message : null;
}

/** `ids`, each once, in chunks one `in` filter can carry. */
function chunksOf(
  ids: readonly AppointmentId[],
): readonly (readonly AppointmentId[])[] {
  const distinct = [...new Set(ids)];
  const chunks: AppointmentId[][] = [];
  for (let start = 0; start < distinct.length; start += IN_FILTER_MAX) {
    chunks.push(distinct.slice(start, start + IN_FILTER_MAX));
  }
  return chunks;
}

/**
 * The shop's photos of a visit (flip 1, plan §3.4) —
 * `appointmentPhotos/{photoId}` documents beside their bytes at
 * `appointmentPhotos/{appointmentId}/{photoId}` in Storage, staff-only in
 * both places (the two rules files match the one name). The successor of
 * `FirebaseAppointmentPhotos` and `FirebaseClientPhotosReader`.
 *
 * The staff camera and attach flow uploads the bytes first
 * (`uploadPhotoBytes`, answering the path and download URL), then saves
 * the document (`saveAppointmentPhoto`) — the photo arrives whole, its
 * facts and stamps the caller's (session, injected clock), never this
 * adapter's. The download URL rides on the document, so a visit's photos
 * read in one snapshot, never one URL lookup per picture.
 *
 * The live and one-shot document reads follow the firestore lib's
 * `observe.ts` exactly; they are restated here because that module sits in
 * the lib's lazy half, which no other lib may import statically.
 */
export const appointmentPhotoPorts = (
  db: Firestore,
  storage: FirebaseStorage,
): AppointmentPhotoPorts => {
  const photos = collection(db, PHOTOS);

  const readPhotos = async (
    ...constraints: readonly QueryConstraint[]
  ): Promise<Result<readonly AppointmentPhoto[], RepositoryError>> => {
    try {
      const snap = await getDocs(query(photos, ...constraints));
      return Result.ok(
        snap.docs.map((entry) => photoOf(entry.id, entry.data())),
      );
    } catch (cause) {
      return Result.err(RepositoryError.readFailed(PHOTOS, reasonOf(cause)));
    }
  };

  return {
    /**
     * A visit's photos, live, in the order they were taken — an equality
     * alone, sorted here: an `orderBy` beside it would need a composite
     * index for a list never longer than a visit.
     */
    observeAppointmentPhotos: (
      appointmentId,
    ): Observable<Result<readonly AppointmentPhoto[], RepositoryError>> =>
      subscribeWithRetry<readonly AppointmentPhoto[]>(
        (next, error) =>
          onSnapshot(
            query(photos, where('appointmentId', '==', appointmentId)),
            (snap) =>
              next(
                snap.docs
                  .map((entry) => photoOf(entry.id, entry.data()))
                  .sort(byTaken),
              ),
            error,
          ),
        (cause) => RepositoryError.readFailed(PHOTOS, reasonOf(cause)),
      ),

    saveAppointmentPhoto: async (photo) => {
      const { id, ...body } = photo;
      try {
        await setDoc(doc(db, PHOTOS, id), body);
        return Result.ok(undefined);
      } catch (cause) {
        return Result.err(
          RepositoryError.writeFailed(`${PHOTOS}/${id}`, reasonOf(cause)),
        );
      }
    },

    /**
     * The document goes; the bytes go with it only when the photo was SHOT
     * for the visit (`PhotoOrigin.ownsBytes`) — the shop's own library
     * picture stays the shop's. Bytes already gone are gone: the document
     * was the record.
     */
    deleteAppointmentPhoto: async (photo) => {
      try {
        await deleteDoc(doc(db, PHOTOS, photo.id));
      } catch (cause) {
        return Result.err(
          RepositoryError.writeFailed(`${PHOTOS}/${photo.id}`, reasonOf(cause)),
        );
      }
      if (!PhotoOrigin.ownsBytes(photo.photoOrigin))
        return Result.ok(undefined);
      try {
        await deleteObject(ref(storage, photo.path));
        return Result.ok(undefined);
      } catch (cause) {
        return storageErrorCode(cause) === OBJECT_NOT_FOUND
          ? Result.ok(undefined)
          : Result.err(
              RepositoryError.writeFailed(photo.path, reasonOf(cause)),
            );
      }
    },

    /**
     * A client's newest photos across visits, the visits' own shots only —
     * `clientCustomerId ==`, `photoOrigin == SHOT`, `takenAtUtcMs` desc
     * (index #22; the `orderBy` is what makes `limit` keep the newest). The
     * origin is a filter of the query, never of the answer: a library
     * picture adopted onto a visit takes none of the `max` places. No room,
     * no read.
     */
    listClientPhotos: async (clientCustomerId, max) => {
      if (!(max >= 1)) return Result.ok([]);
      return readPhotos(
        where('clientCustomerId', '==', clientCustomerId),
        where('photoOrigin', '==', PhotoOrigin.Shot),
        orderBy('takenAtUtcMs', 'desc'),
        limit(Math.floor(max)),
      );
    },

    /**
     * How many of its own shots each visit holds — `appointmentId in`,
     * thirty ids a query (single-field), counted here. Positions preserved:
     * `out[i]` counts `appointmentIds[i]`; an id is asked once however often
     * it is listed. No ids, no read.
     */
    countPhotosByAppointment: async (appointmentIds) => {
      const reads = await Promise.all(
        chunksOf(appointmentIds).map((batch) =>
          readPhotos(where('appointmentId', 'in', batch)),
        ),
      );
      const counts = new Map<string, number>();
      for (const read of reads) {
        if (!read.ok) return read;
        for (const photo of read.value) {
          if (isShot(photo)) {
            counts.set(
              photo.appointmentId,
              (counts.get(photo.appointmentId) ?? 0) + 1,
            );
          }
        }
      }
      return Result.ok(appointmentIds.map((id) => counts.get(id) ?? 0));
    },

    /**
     * The bytes up to `appointmentPhotos/{appointmentId}/{photoId}` (today's
     * object path, byte for byte), then their download URL. The object
     * carries the photo's six facts as its own metadata (strings only),
     * under the entity's key names: `clientCustomerId` and `takenByUserId`
     * empty when absent, `takenAtUtcMs` in decimal. The limits — an image,
     * at most `storage.rules`' 8 MiB — are the caller's guard BEFORE this
     * call (`media.port.ts`), never this adapter's: whatever slips past it,
     * Storage itself refuses, answered as `MEDIA_FORBIDDEN`.
     */
    uploadPhotoBytes: async (photo, image) => {
      const path = `${PHOTOS}/${photo.appointmentId}/${photo.id}`;
      try {
        const object = ref(storage, path);
        await uploadBytes(object, image, {
          contentType: image.type,
          customMetadata: {
            appointmentId: photo.appointmentId,
            barberId: photo.barberId,
            clientCustomerId: photo.clientCustomerId ?? '',
            clientLabel: photo.clientLabel,
            takenByUserId: photo.takenByUserId ?? '',
            takenAtUtcMs: String(photo.takenAtUtcMs),
          },
        });
        return Result.ok({ path, url: await getDownloadURL(object) });
      } catch (cause) {
        return Result.err(mediaErrorOf(path, cause));
      }
    },
  };
};
