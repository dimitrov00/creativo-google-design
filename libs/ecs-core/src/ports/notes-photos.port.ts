import type { Observable } from 'rxjs';
import type { Result, AppointmentId, CustomerId } from '@core/primitives';
import type { RepositoryError } from '@core/errors';
import type { AppointmentNote, AppointmentPhoto } from '@core/entities';
import type { PhotoUploadPorts } from './media.port';

/**
 * The visit's staff-only notes and photos (blueprint §4.2) —
 * `appointmentNotes/{appointmentId}` and `appointmentPhotos/{id}`, each an
 * entity straight from `snap.data()`. Successor of `AppointmentNotes`,
 * `AppointmentPhotos` and `ClientPhotosReader`. The photo bytes go through
 * `UploadPhotoBytes` (`media.port.ts`) first; the stamps (`takenAtUtcMs`,
 * `writtenAtUtcMs`, the author) are filled by the caller from its injected
 * clock and session, never by the adapter.
 */

// ── Photos ────────────────────────────────────────────────────────────────

/**
 * A visit's photos, live — `appointmentId ==`, single-field — every origin
 * (an adopted library picture included), ascending by `takenAtUtcMs`
 * (stably; the adapter's `byTaken` sort stands in for an `orderBy`, which
 * would need a composite index): the order the visit's strip reads in.
 */
export type ObserveAppointmentPhotos = (
  appointmentId: AppointmentId,
) => Observable<Result<readonly AppointmentPhoto[], RepositoryError>>;

/** `appointmentPhotos/{id}` `Set` — a shot or adopted photo, after its bytes are stored. */
export type SaveAppointmentPhoto = (
  photo: AppointmentPhoto,
) => Promise<Result<void, RepositoryError>>;

/**
 * Delete the photo's document and, when the bytes are the visit's own
 * (under its `appointmentPhotos/{appointmentId}/` folder), its Storage
 * object — an adopted reference keeps its original.
 */
export type DeleteAppointmentPhoto = (
  photo: AppointmentPhoto,
) => Promise<Result<void, RepositoryError>>;

/**
 * A client record's newest photos across visits, the visits' own shots
 * only — `clientCustomerId ==` (D29), `photoOrigin == SHOT`,
 * `orderBy takenAtUtcMs desc`, at most `limit` (index #22). The origin
 * filters the query, so a library picture adopted onto a visit never takes
 * one of the `limit` places; no room (`limit` under one) answers nothing.
 */
export type ListClientPhotos = (
  clientCustomerId: CustomerId,
  limit: number,
) => Promise<Result<readonly AppointmentPhoto[], RepositoryError>>;

/**
 * How many of its own shots each visit holds — a library picture adopted
 * onto it never counts; `appointmentId in`, single-field. Positions
 * preserved: `out[i]` counts `appointmentIds[i]`.
 */
export type CountPhotosByAppointment = (
  appointmentIds: readonly AppointmentId[],
) => Promise<Result<readonly number[], RepositoryError>>;

// ── Notes ─────────────────────────────────────────────────────────────────

/**
 * `appointmentNotes/{appointmentId}`, live — `null` when the visit has no
 * note. A stored note that is not its entity (the read-time guard,
 * `StoredDocumentSystem.appointmentNote`, pass E — when the adapter is built
 * guarded) emits `RepositoryError.malformed(path, field)` as a value and
 * the listener stays: a corrected note emits `ok` again.
 */
export type ObserveAppointmentNote = (
  appointmentId: AppointmentId,
) => Observable<Result<AppointmentNote | null, RepositoryError>>;

/**
 * `appointmentNotes/{appointmentId}` — `Set` the note, or DELETE the
 * document when `note` is `null` (a cleared note leaves nothing behind).
 * Whether a typed text is blank is the caller's system decision.
 */
export type SaveAppointmentNote = (
  appointmentId: AppointmentId,
  note: AppointmentNote | null,
) => Promise<Result<void, RepositoryError>>;

/**
 * `appointmentNotes/{appointmentId}` read → decided → written in ONE
 * transaction — the transaction IS the sandwich (Law 4): the note as stored
 * on the server (`null` when the visit has none) is handed to the PURE
 * `decide`, and its answer is `Set` in the same transaction. `decide` may
 * run more than once — a concurrent write to the note re-runs read →
 * decide on the fresher note, so nothing a colleague wrote meanwhile is
 * lost — and must not stamp, read a clock or touch anything outside its
 * argument. `decide` answering `null` writes nothing (this port never
 * deletes). The answer is the note as written, or `null` when nothing was.
 *
 * Every failure — the server unreachable (offline: a transaction never reads
 * the cache, so nothing is ever written over the server's copy), contention
 * past the store's attempts, a rule denial — is
 * `RepositoryError.writeFailed(path, reason)` and nothing is written. A
 * stored note that is not its entity (the read-time guard,
 * `StoredDocumentSystem.appointmentNote`, pass E — when the adapter is built
 * guarded) is `RepositoryError.malformed(path, field)`: `decide` is never
 * handed it, and nothing is written.
 */
export type UpdateAppointmentNote = (
  appointmentId: AppointmentId,
  decide: (stored: AppointmentNote | null) => AppointmentNote | null,
) => Promise<Result<AppointmentNote | null, RepositoryError>>;

// ── Focused bundles (Law 9 — composed with `&`, never sliced) ─────────────

/** A visit's note — the bundle the web's `APPOINTMENT_NOTE_PORTS` token binds. */
export type AppointmentNotePorts = {
  readonly observeAppointmentNote: ObserveAppointmentNote;
  readonly saveAppointmentNote: SaveAppointmentNote;
  readonly updateAppointmentNote: UpdateAppointmentNote;
};

/** A visit's photo documents and a client record's strip — Firestore's half. */
export type AppointmentPhotoRecordPorts = {
  readonly observeAppointmentPhotos: ObserveAppointmentPhotos;
  readonly saveAppointmentPhoto: SaveAppointmentPhoto;
  readonly deleteAppointmentPhoto: DeleteAppointmentPhoto;
  readonly listClientPhotos: ListClientPhotos;
  readonly countPhotosByAppointment: CountPhotosByAppointment;
};

/**
 * A visit's photos — the bundle the web's `APPOINTMENT_PHOTO_PORTS` token
 * binds: the documents plus `uploadPhotoBytes` (`media.port.ts`), which the
 * staff camera/attach flow uploads the bytes through before it saves the
 * document.
 */
export type AppointmentPhotoPorts = AppointmentPhotoRecordPorts &
  PhotoUploadPorts;

/** The notes-and-photos whole port suite — an intersection of its bundles. */
export type NotesPhotosPorts = AppointmentNotePorts & AppointmentPhotoPorts;
