import type {
  MediaError,
  Result,
  AppointmentId,
  AppointmentPhotoId,
  UserId,
} from '@core/primitives';

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

/**
 * Every rendition of a catalogue image, narrowest first. Resolution reads
 * only the Storage path (flatten-spec §3.8), so a flattened `cover*` /
 * `avatar*` field set and a `photos[]` element both call it without mapping.
 */
export type ResolveMedia = (
  mediaPath: string,
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
