import type { MediaRef } from '@core/components';
import type { MediaError, Result, UserId } from '@core/primitives';
import type { AppointmentPhotoFacts } from '@core/entities';

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
 * Every rendition of a catalogue image, narrowest first — of the `MediaRef`
 * the content service's `MediaRef.parse` guard produced (a named component,
 * never loose scalars; a malformed stored ref never reaches Storage). The
 * adapter reads `ref.mediaPath` and answers one rendition, `ref.mediaWidth`
 * wide, as today's reader did.
 */
export type ResolveMedia = (
  ref: MediaRef,
) => Promise<Result<readonly MediaVariant[], MediaError>>;

/**
 * Upload a visit photo's bytes. The photo arrives as its own facts, every
 * field of the document but the two Storage answers (`path`, `url`): the
 * adapter derives today's object path `appointmentPhotos/{appointmentId}/{id}`
 * and the object's custom metadata from those facts (no argument it could
 * mis-order), and answers the stored path and download URL. The document
 * (`SaveAppointmentPhoto`, `notes-photos.port.ts`) is written after, the
 * facts plus that answer.
 */
export type UploadPhotoBytes = (
  photo: AppointmentPhotoFacts,
  image: Blob,
) => Promise<Result<StoredFile, MediaError>>;

// ── Focused bundles (Law 9 — composed with `&`, never sliced) ─────────────

/** A person's avatar — upload, find, remove. */
export type AvatarPorts = {
  readonly uploadAvatar: UploadAvatar;
  readonly findAvatar: FindAvatar;
  readonly removeAvatar: RemoveAvatar;
};

/** A catalogue image's renditions. */
export type MediaResolvePorts = {
  readonly resolveMedia: ResolveMedia;
};

/** A visit photo's bytes — the Storage half of `AppointmentPhotoPorts`. */
export type PhotoUploadPorts = {
  readonly uploadPhotoBytes: UploadPhotoBytes;
};

/** The Storage bundle the web binds — an intersection of its bundles. */
export type MediaPorts = AvatarPorts & MediaResolvePorts & PhotoUploadPorts;
