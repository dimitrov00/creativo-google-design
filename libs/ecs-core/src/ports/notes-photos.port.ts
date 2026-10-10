import type { Observable } from 'rxjs';
import type { RepositoryError } from '../components/repository-errors.data';
import type { Result } from '../components/result.data';
import type { AppointmentNoteEntity } from '../entities/appointment-note.entity';
import type { AppointmentPhotoEntity } from '../entities/appointment-photo.entity';
import type { AppointmentId } from '../entities/appointment.entity';
import type { UserId } from '../entities/user.entity';

/**
 * The visit's staff-only notes and photos (blueprint §4.2) —
 * `appointmentNotes/{appointmentId}` and `appointmentPhotos/{id}`, each an
 * entity straight from `snap.data()`. Successor of `AppointmentNotes`,
 * `AppointmentPhotos` and `ClientPhotosReader`. The photo bytes go through
 * `UploadPhotoBytes` (`media.port.ts`) first; the stamps (`takenAtMs`,
 * `writtenAtMs`, the author) are filled by the caller from its injected
 * clock and session, never by the adapter.
 */

// ── Photos ────────────────────────────────────────────────────────────────

/** A visit's photos, live — `appointmentId ==`, single-field. */
export type ObserveAppointmentPhotos = (
  appointmentId: AppointmentId,
) => Observable<Result<readonly AppointmentPhotoEntity[], RepositoryError>>;

/** `appointmentPhotos/{id}` `Set` — a shot or adopted photo, after its bytes are stored. */
export type SaveAppointmentPhoto = (
  photo: AppointmentPhotoEntity,
) => Promise<Result<void, RepositoryError>>;

/**
 * Delete the photo's document and, when the bytes are the visit's own
 * (under its `appointmentPhotos/{appointmentId}/` folder), its Storage
 * object — an adopted reference keeps its original.
 */
export type DeleteAppointmentPhoto = (
  photo: AppointmentPhotoEntity,
) => Promise<Result<void, RepositoryError>>;

/**
 * A client's newest photos across visits — `clientUserId ==`,
 * `orderBy takenAtMs desc`, at most `limit` (index #22).
 */
export type ListClientPhotos = (
  clientUserId: UserId,
  limit: number,
) => Promise<Result<readonly AppointmentPhotoEntity[], RepositoryError>>;

/**
 * How many photos each visit holds — `appointmentId ==` count aggregations,
 * single-field. Positions preserved: `out[i]` counts `appointmentIds[i]`.
 */
export type CountPhotosByAppointment = (
  appointmentIds: readonly AppointmentId[],
) => Promise<Result<readonly number[], RepositoryError>>;

// ── Notes ─────────────────────────────────────────────────────────────────

/** `appointmentNotes/{appointmentId}`, live — `null` when the visit has no note. */
export type ObserveAppointmentNote = (
  appointmentId: AppointmentId,
) => Observable<Result<AppointmentNoteEntity | null, RepositoryError>>;

/**
 * `appointmentNotes/{appointmentId}` — `Set` the note, or DELETE the
 * document when `note` is `null` (a cleared note leaves nothing behind).
 * Whether a typed text is blank is the caller's system decision.
 */
export type SaveAppointmentNote = (
  appointmentId: AppointmentId,
  note: AppointmentNoteEntity | null,
) => Promise<Result<void, RepositoryError>>;

/** The notes-and-photos bundle the web binds. */
export type NotesPhotosPorts = {
  readonly observeAppointmentPhotos: ObserveAppointmentPhotos;
  readonly saveAppointmentPhoto: SaveAppointmentPhoto;
  readonly deleteAppointmentPhoto: DeleteAppointmentPhoto;
  readonly listClientPhotos: ListClientPhotos;
  readonly countPhotosByAppointment: CountPhotosByAppointment;
  readonly observeAppointmentNote: ObserveAppointmentNote;
  readonly saveAppointmentNote: SaveAppointmentNote;
};
