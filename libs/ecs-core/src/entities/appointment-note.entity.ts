import type { AppointmentId, UserId, UtcEpochMs } from '@core/primitives';

/**
 * The staff note on a visit — `appointmentNotes/{appointmentId}`, one note per
 * visit, so the id IS the appointment's (`appointment-notes.adapter.ts:69-75`).
 * Saving an empty note deletes the document; the stored `text` is trimmed and
 * non-empty. Free text a staff member types about a cancellation lives here,
 * never on the seat's reason (§9 D23). The author is an ACCOUNT (D29).
 */
export type AppointmentNote = {
  readonly id: AppointmentId;
  readonly text: string;
  /** Was `authorUid` (N11). */
  readonly authorUserId: UserId | null;
  readonly writtenAtUtcMs: UtcEpochMs;
};
