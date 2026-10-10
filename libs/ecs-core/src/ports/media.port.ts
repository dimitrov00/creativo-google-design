import type { MediaError } from '../components/media-errors.data';
import type { MediaRef } from '../components/media-ref.data';
import type { Result } from '../components/result.data';
import type { AppointmentPhotoId } from '../entities/appointment-photo.entity';
import type { AppointmentId } from '../entities/appointment.entity';
import type { UserId } from '../entities/user.entity';

/**
 * The web's Cloud Storage ports (blueprint §4.2): avatars, catalogue media
 * and visit-photo bytes. Every failure is a `MediaError` — `NotFound` and
 * `Forbidden` are Storage's permanent answers (show the placeholder, stop
 * asking), `Transient` is worth a bounded retry. Byte limits and content
 * types are checked by a pure guard BEFORE an upload, never inside the
 * adapter. Successor of `AvatarUploader`, `MediaReader` and the upload half
 * of `AppointmentPhotos.attach`.
 */

/** An object in Storage: its path and a download URL. */
export type StoredFile = {
  readonly path: string;
  readonly url: string;
};

/** One rendition of a catalogue image. */
export type MediaVariant = {
  /** Pixel width of this rendition. */
  readonly width: number;
  readonly url: string;
};

/** Upload (replace) a person's avatar. */
export type UploadAvatar = (
  userId: UserId,
  image: Blob,
) => Promise<Result<StoredFile, MediaError>>;

/** The person's avatar; `null` when none was uploaded. */
export type FindAvatar = (
  userId: UserId,
) => Promise<Result<StoredFile | null, MediaError>>;

export type RemoveAvatar = (
  userId: UserId,
) => Promise<Result<void, MediaError>>;

/** Every rendition of a catalogue image, narrowest first. */
export type ResolveMedia = (
  ref: MediaRef,
) => Promise<Result<readonly MediaVariant[], MediaError>>;

/**
 * Upload a visit photo's bytes to `appointmentPhotos/{appointmentId}/{photoId}`
 * in Storage; the document (`SaveAppointmentPhoto`, `notes-photos.port.ts`)
 * is written after, naming the answered path and URL.
 */
export type UploadPhotoBytes = (
  appointmentId: AppointmentId,
  photoId: AppointmentPhotoId,
  image: Blob,
) => Promise<Result<StoredFile, MediaError>>;

/** The Storage bundle the web binds. */
export type MediaPorts = {
  readonly uploadAvatar: UploadAvatar;
  readonly findAvatar: FindAvatar;
  readonly removeAvatar: RemoveAvatar;
  readonly resolveMedia: ResolveMedia;
  readonly uploadPhotoBytes: UploadPhotoBytes;
};
