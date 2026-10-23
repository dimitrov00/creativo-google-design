import type { PhotoOrigin } from '@core/components';
import type {
  AppointmentId,
  AppointmentPhotoId,
  BarberId,
  CustomerId,
  UserId,
  UtcEpochMs,
} from '@core/primitives';

/**
 * A visit photo's own facts — every field of the document but the two
 * Storage answers. The upload port takes these (`UploadPhotoBytes`) and
 * answers the `PhotoObject`; the document is the two together.
 */
export type AppointmentPhotoFacts = {
  readonly id: AppointmentPhotoId;
  readonly appointmentId: AppointmentId;
  readonly barberId: BarberId;
  /**
   * The client record the photo shows (D29, flatten-spec §5.4) — the client
   * card's photo strip (`clientCustomerId ==`, `photoOrigin == SHOT`,
   * `takenAtUtcMs desc`, index #22); `null` for a guest seat with no record.
   */
  readonly clientCustomerId: CustomerId | null;
  readonly clientLabel: string;
  /** Was `takenByUid` (N11) — who took it, an account. */
  readonly takenByUserId: UserId | null;
  readonly takenAtUtcMs: UtcEpochMs;
  readonly width: number | null;
  readonly height: number | null;
  /** Was `origin` (N15). */
  readonly photoOrigin: PhotoOrigin;
  readonly label: string | null;
};

/** Where the photo's bytes live — Storage's answer to the upload. */
export type PhotoObject = {
  /** The Storage key — under `appointmentPhotos/{appointmentId}/…`, or the library object. */
  readonly path: string;
  /** Kept: an adopted library picture carries the library object's URL, not one derived from `path`. */
  readonly url: string;
};

/**
 * A picture on a visit — `appointmentPhotos/{id}`, staff-only, a sibling
 * document per photo (`appointment-photos.adapter.ts:119-133,145-158`).
 * `photoOrigin` is load-bearing: deleting the photo removes the Storage
 * object ONLY for a `SHOT`, so the shop's own library picture is never
 * deleted with a visit.
 */
export type AppointmentPhoto = AppointmentPhotoFacts & PhotoObject;
