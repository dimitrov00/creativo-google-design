import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import { Result } from '@creativo/domain/kernel';
import { RepositoryError } from '@creativo/application/shared';

/**
 * A PHOTO of a visit — the cut as it left the chair, the beard before, the
 * colour to match next time — with the shop's facts stamped on it: which
 * visit, which chair, which client, who pressed the shutter and when
 * (owner, 2026-09-17: "attach / take pictures to an appointment, with meta
 * on them: who — barber, client, appointment").
 *
 * ⚠ NOT on the appointment, for the team note's reason: the appointment
 * document is readable by its owner, and the shop's pictures of a client
 * are the shop's. They live in a sibling collection only people who work
 * the book can read or write — one document per photo, pointing at the
 * visit — and the bytes sit in Storage under the same rule. The facts are
 * written twice on purpose: on the document, and as custom metadata on the
 * object, so the file says who even with no document beside it.
 */
export interface AppointmentPhoto {
  readonly photoId: string;
  readonly appointmentId: string;
  /** The chair the visit was in. */
  readonly barberId: string;
  /** The client's account, when they have one, and the name as the visit had it. */
  readonly clientUserId: string | null;
  readonly clientLabel: string;
  /** Who pressed the shutter — the staff account — and when. */
  readonly takenByUid: string | null;
  readonly takenAtIso: string;
  /** Where the bytes are, and the URL that reads them. */
  readonly path: string;
  readonly url: string;
  readonly width: number | null;
  readonly height: number | null;
  /**
   * `shot`: taken or uploaded for this visit, the bytes the visit's own.
   * `library`: one of the shop's own pictures — a catalogue cover, a work
   * shot — pointed at, never copied; removing the photo drops only the
   * document, the picture stays the shop's.
   */
  readonly origin: 'shot' | 'library';
  /** What the shop's picture is called, for a `library` photo. */
  readonly label: string | null;
}

/** What a shutter press hands in: the image, already sized for the wire, and the visit's facts. */
export interface AppointmentPhotoAttachment {
  readonly appointmentId: string;
  readonly barberId: string;
  readonly clientUserId: string | null;
  readonly clientLabel: string;
  readonly image: Blob;
  readonly width: number | null;
  readonly height: number | null;
}

/** One of the shop's own pictures, assigned to a visit as it stands. */
export interface AppointmentPhotoReference {
  readonly appointmentId: string;
  readonly barberId: string;
  readonly clientUserId: string | null;
  readonly clientLabel: string;
  readonly path: string;
  readonly url: string;
  readonly label: string | null;
  readonly width: number | null;
  readonly height: number | null;
}

export interface AppointmentPhotos {
  /** Live: the visit's photos in the order they were taken; empty while there are none. */
  observe(
    appointmentId: string,
  ): Observable<Result<readonly AppointmentPhoto[], RepositoryError>>;
  /** The bytes up, the document written, the photo back with its URL. */
  attach(
    attachment: AppointmentPhotoAttachment,
  ): Promise<Result<AppointmentPhoto, RepositoryError>>;
  /** A picture the shop already has, assigned to the visit: the document written, nothing uploaded. */
  adopt(
    reference: AppointmentPhotoReference,
  ): Promise<Result<AppointmentPhoto, RepositoryError>>;
  /** Drops the document and, for a visit's own picture, the bytes; bytes already gone are gone. */
  remove(photo: AppointmentPhoto): Promise<Result<void, RepositoryError>>;
}

export const APPOINTMENT_PHOTOS = new InjectionToken<AppointmentPhotos>(
  'AppointmentPhotos',
);

/** The one name, once — the rules files match the collection AND the Storage prefix by it. */
export const APPOINTMENT_PHOTOS_COLLECTION = 'appointmentPhotos';
