import type { PhotoOrigin } from '../components/photo-origin.data';
import type { AppointmentId } from './appointment.entity';
import type { BarberId } from './barber.entity';
import type { UserId } from './user.entity';

/** The stored `photoId`, dropped from the body as the document id. */
export type AppointmentPhotoId = string & { readonly __brand: unique symbol };
export const AppointmentPhotoId = {
  /** The only cast site. Validate the raw string at the edge, not here. */
  of: (raw: string): AppointmentPhotoId => raw as AppointmentPhotoId,
} as const;

/**
 * A picture on a visit — `appointmentPhotos/{id}`, staff-only, a sibling
 * document per photo (`appointment-photos.adapter.ts:119-133,145-158`,
 * `takenAtIso` → `takenAtMs` and nothing else). `origin` is load-bearing:
 * deleting the photo removes the Storage object ONLY for a `shot`, so the
 * shop's own library picture is never deleted with a visit.
 */
export type AppointmentPhotoEntity = {
  readonly id: AppointmentPhotoId;
  readonly appointmentId: AppointmentId;
  readonly barberId: BarberId;
  readonly clientUserId: UserId | null;
  readonly clientLabel: string;
  readonly takenByUid: UserId | null;
  readonly takenAtMs: number;
  /** The Storage key — under `appointmentPhotos/{appointmentId}/…`, or the library object. */
  readonly path: string;
  /** Kept: an adopted library picture carries the library object's URL, not one derived from `path`. */
  readonly url: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly origin: PhotoOrigin;
  readonly label: string | null;
};
