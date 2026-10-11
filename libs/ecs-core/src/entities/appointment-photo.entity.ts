import type { PhotoOrigin } from '../components/photo-origin.data';
import type {
  AppointmentId,
  AppointmentPhotoId,
  BarberId,
  UserId,
} from '../primitives/ids.primitive';
import type { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';

/*
 * F0 STAGING: `AppointmentPhotoId` lives in `primitives/ids.primitive.ts`
 * (§1.5); the barrel still names this file for it until the integrator drops
 * that line.
 */

/**
 * A picture on a visit — `appointmentPhotos/{id}`, staff-only, a sibling
 * document per photo (`appointment-photos.adapter.ts:119-133,145-158`).
 * `photoOrigin` is load-bearing: deleting the photo removes the Storage
 * object ONLY for a `SHOT`, so the shop's own library picture is never
 * deleted with a visit.
 */
export type AppointmentPhoto = {
  readonly id: AppointmentPhotoId;
  readonly appointmentId: AppointmentId;
  readonly barberId: BarberId;
  /** The client the photo shows — a uid until the appointment flip (1) adds `clientCustomerId` (D29). */
  readonly clientUserId: UserId | null;
  readonly clientLabel: string;
  /** Was `takenByUid` (N11) — who took it, an account. */
  readonly takenByUserId: UserId | null;
  readonly takenAtUtcMs: UtcEpochMs;
  /** The Storage key — under `appointmentPhotos/{appointmentId}/…`, or the library object. */
  readonly path: string;
  /** Kept: an adopted library picture carries the library object's URL, not one derived from `path`. */
  readonly url: string;
  readonly width: number | null;
  readonly height: number | null;
  /** Was `origin` (N15). */
  readonly photoOrigin: PhotoOrigin;
  readonly label: string | null;
};
