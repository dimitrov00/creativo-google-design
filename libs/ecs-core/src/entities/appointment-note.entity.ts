import type { AppointmentId } from './appointment.entity';
import type { UserId } from './user.entity';

/**
 * The staff note on a visit — `appointmentNotes/{appointmentId}`, one note per
 * visit, so the id IS the appointment's (`appointment-notes.adapter.ts:69-75`,
 * `writtenAtIso` → `writtenAtMs` and nothing else). Saving an empty note
 * deletes the document; the stored `text` is trimmed and non-empty. Free text
 * a staff member types about a cancellation lives here, never on the seat's
 * reason (§9 D23).
 */
export type AppointmentNoteEntity = {
  readonly id: AppointmentId;
  readonly text: string;
  readonly authorUid: UserId | null;
  readonly writtenAtMs: number;
};
