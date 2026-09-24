import { Injectable, inject } from '@angular/core';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from 'firebase/storage';
import { Observable } from 'rxjs';
import {
  FIREBASE_AUTH,
  FIREBASE_FIRESTORE,
} from '@creativo/infrastructure/firebase-app';
import { subscribeWithRetry } from '@creativo/infrastructure/firestore';
import {
  APPOINTMENT_PHOTOS_COLLECTION,
  type AppointmentPhoto,
  type AppointmentPhotoAttachment,
  type AppointmentPhotoReference,
  type AppointmentPhotos,
} from '@creativo/application/booking';
import { RepositoryError } from '@creativo/application/shared';
import { Result, fail, ok } from '@creativo/domain/kernel';
import { FIREBASE_STORAGE } from './storage.provider';

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/**
 * `appointmentPhotos/{photoId}` beside `appointmentPhotos/{appointmentId}/
 * {photoId}` in Storage — the shop's photos of a visit, staff-only in both
 * places (the rules files match the one name).
 *
 * A plain `setDoc` after a plain `uploadBytes`, deliberately: like the
 * team's note, nothing here is the availability engine's business, so there
 * is no callable between the shutter and the write. The facts — the visit,
 * the chair, the client, who and when — are stamped here, on the document
 * and on the object's own metadata. The download URL is written with the
 * document so a visit's photos read in one snapshot, never one URL lookup
 * per picture.
 */
@Injectable()
export class FirebaseAppointmentPhotos implements AppointmentPhotos {
  private readonly db = inject(FIREBASE_FIRESTORE);
  private readonly storage = inject(FIREBASE_STORAGE);
  private readonly auth = inject(FIREBASE_AUTH);

  observe(
    appointmentId: string,
  ): Observable<Result<readonly AppointmentPhoto[], RepositoryError>> {
    // An equality alone, sorted here: an `orderBy` beside it would need a
    // composite index for a list that is never longer than a visit.
    const photos = query(
      collection(this.db, APPOINTMENT_PHOTOS_COLLECTION),
      where('appointmentId', '==', appointmentId),
    );
    return subscribeWithRetry<readonly AppointmentPhoto[]>((onNext, onError) =>
      onSnapshot(
        photos,
        (snapshot) => {
          onNext(
            snapshot.docs
              .flatMap((entry) => {
                const photo = toPhoto(entry.id, entry.data());
                return photo === null ? [] : [photo];
              })
              .sort((a, b) => a.takenAtIso.localeCompare(b.takenAtIso)),
          );
        },
        onError,
      ),
    );
  }

  async attach(
    attachment: AppointmentPhotoAttachment,
  ): Promise<Result<AppointmentPhoto, RepositoryError>> {
    const { image } = attachment;
    if (!image.type.startsWith('image/')) {
      return fail(
        new RepositoryError(`"${image.type}" is not an image content type`),
      );
    }
    if (image.size > MAX_PHOTO_BYTES) {
      return fail(
        new RepositoryError(
          `The photo is ${image.size} bytes, over the ${MAX_PHOTO_BYTES}-byte limit`,
        ),
      );
    }
    const photoId = crypto.randomUUID();
    const path = `${APPOINTMENT_PHOTOS_COLLECTION}/${attachment.appointmentId}/${photoId}`;
    const takenByUid = this.auth.currentUser?.uid ?? null;
    const takenAtIso = new Date().toISOString();
    try {
      const objectRef = ref(this.storage, path);
      await uploadBytes(objectRef, image, {
        contentType: image.type,
        // The facts on the object itself, so the file says who and for whom
        // with no document beside it. Metadata is strings only.
        customMetadata: {
          appointmentId: attachment.appointmentId,
          barberId: attachment.barberId,
          clientUserId: attachment.clientUserId ?? '',
          clientLabel: attachment.clientLabel,
          takenByUid: takenByUid ?? '',
          takenAtIso,
        },
      });
      const url = await getDownloadURL(objectRef);
      const photo: AppointmentPhoto = {
        photoId,
        appointmentId: attachment.appointmentId,
        barberId: attachment.barberId,
        clientUserId: attachment.clientUserId,
        clientLabel: attachment.clientLabel,
        takenByUid,
        takenAtIso,
        path,
        url,
        width: attachment.width,
        height: attachment.height,
        origin: 'shot',
        label: null,
      };
      await setDoc(doc(this.db, APPOINTMENT_PHOTOS_COLLECTION, photoId), photo);
      return ok(photo);
    } catch (cause) {
      return fail(new RepositoryError('Could not attach the photo', cause));
    }
  }

  async adopt(
    reference: AppointmentPhotoReference,
  ): Promise<Result<AppointmentPhoto, RepositoryError>> {
    const photoId = crypto.randomUUID();
    const photo: AppointmentPhoto = {
      photoId,
      appointmentId: reference.appointmentId,
      barberId: reference.barberId,
      clientUserId: reference.clientUserId,
      clientLabel: reference.clientLabel,
      takenByUid: this.auth.currentUser?.uid ?? null,
      takenAtIso: new Date().toISOString(),
      path: reference.path,
      url: reference.url,
      width: reference.width,
      height: reference.height,
      origin: 'library',
      label: reference.label,
    };
    try {
      await setDoc(doc(this.db, APPOINTMENT_PHOTOS_COLLECTION, photoId), photo);
      return ok(photo);
    } catch (cause) {
      return fail(new RepositoryError('Could not assign the picture', cause));
    }
  }

  async remove(
    photo: AppointmentPhoto,
  ): Promise<Result<void, RepositoryError>> {
    try {
      await deleteDoc(
        doc(this.db, APPOINTMENT_PHOTOS_COLLECTION, photo.photoId),
      );
      // The shop's own picture stays the shop's: only the visit's own bytes go.
      if (photo.origin === 'library') return ok(undefined);
      try {
        await deleteObject(ref(this.storage, photo.path));
      } catch (error) {
        // Bytes already gone are gone: the document was the record, and it
        // is deleted. Only a REAL storage failure is one.
        if (
          typeof error !== 'object' ||
          error === null ||
          (error as { code?: string }).code !== 'storage/object-not-found'
        ) {
          throw error;
        }
      }
      return ok(undefined);
    } catch (cause) {
      return fail(new RepositoryError('Could not remove the photo', cause));
    }
  }
}

/** A document read back — or nothing, for one that does not say what a photo must. */
function toPhoto(
  photoId: string,
  data: Record<string, unknown> | undefined,
): AppointmentPhoto | null {
  if (data === undefined) return null;
  const text = (key: string): string | null =>
    typeof data[key] === 'string' ? (data[key] as string) : null;
  const size = (key: string): number | null =>
    typeof data[key] === 'number' ? (data[key] as number) : null;
  const appointmentId = text('appointmentId');
  const barberId = text('barberId');
  const takenAtIso = text('takenAtIso');
  const path = text('path');
  const url = text('url');
  if (
    appointmentId === null ||
    barberId === null ||
    takenAtIso === null ||
    path === null ||
    url === null
  ) {
    return null;
  }
  return {
    photoId,
    appointmentId,
    barberId,
    clientUserId: text('clientUserId'),
    clientLabel: text('clientLabel') ?? '',
    takenByUid: text('takenByUid'),
    takenAtIso,
    path,
    url,
    width: size('width'),
    height: size('height'),
    origin: data['origin'] === 'library' ? 'library' : 'shot',
    label: text('label'),
  };
}
