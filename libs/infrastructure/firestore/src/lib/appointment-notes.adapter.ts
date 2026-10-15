import { type Firestore, deleteDoc, doc, setDoc } from 'firebase/firestore';
import { defect } from '@core/primitives';
import { type AppointmentNote, Collections } from '@core/entities';
import type { AppointmentNotePorts } from '@core/ports';
import { attemptWrite, observeDoc } from './observe';

/**
 * `appointmentNotes/{appointmentId}` — the team's note on a visit,
 * staff-only (flip 1, plan §3.4), one note per visit so the id IS the
 * appointment's. A plain write, deliberately: the collection is
 * `read, write: if worksTheBook()` and nothing here is the availability
 * engine's business, so no callable stands between the sheet and the
 * document.
 *
 * The note arrives whole: its trimmed text, its author and its instant are
 * the caller's (a system decides blankness; the session and the injected
 * clock stamp it), never this adapter's. `null` deletes the document — a
 * cleared note leaves nothing behind.
 */
export const appointmentNotePorts = (db: Firestore): AppointmentNotePorts => ({
  observeAppointmentNote: (appointmentId) =>
    observeDoc<AppointmentNote>(
      doc(db, Collections.AppointmentNotes, appointmentId),
    ),

  saveAppointmentNote: (appointmentId, note) => {
    const ref = doc(db, Collections.AppointmentNotes, appointmentId);
    if (note === null) return attemptWrite(ref.path, () => deleteDoc(ref));
    // The note's id IS the appointment's: the body is the entity minus it.
    const { id, ...body } = note;
    if (id !== appointmentId) {
      defect(`saveAppointmentNote: note ${id} handed for ${appointmentId}`);
    }
    return attemptWrite(ref.path, () => setDoc(ref, body));
  },
});
