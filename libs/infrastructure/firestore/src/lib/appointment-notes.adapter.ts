import {
  type Firestore,
  deleteDoc,
  doc,
  runTransaction,
  setDoc,
} from 'firebase/firestore';
import { Result, defect } from '@core/primitives';
import type { RepositoryError } from '@core/errors';
import { type AppointmentNote, Collections } from '@core/entities';
import type { AppointmentNotePorts } from '@core/ports';
import type { StoredDocument } from '@core/systems';
import {
  admitted,
  attemptWrite,
  entityOf,
  observeDoc,
  type ReadGuard,
  writeFailed,
} from './observe';

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
 *
 * A line APPENDED below the note (a cancel's «Друго…») is one transaction —
 * {@link appointmentNotePorts}' `updateAppointmentNote`: read the note on
 * the server, hand it to the caller's pure decision, `Set` the answer, the
 * SDK re-running read → decide when a concurrent write moved the note. A
 * transaction never reads the persistent cache and writes only at commit,
 * so offline it refuses — `REPOSITORY_WRITE_FAILED`, the SDK's rejection
 * code as the reason — and never writes over the server's copy.
 *
 * Built with a {@link ReadGuard} (the composition root's `guardedReads`),
 * both reads answer the SINGLE rule through
 * `StoredDocumentSystem.appointmentNote` (pass E, E-2): a malformed note —
 * a text that is no string or blank, an author that is no account id, an
 * instant that is no instant — is never handed on. Live, the refusal
 * (`REPOSITORY_MALFORMED`, its path and first offending field) is an
 * emitted value and the listener stays; in the append's transaction it is
 * admitted BEFORE `decide`, so a refused note is never decided on, nothing
 * is `Set`, and the port answers the refusal — reported once per call
 * through the guard's log however often the SDK re-runs the attempt. The
 * guard is REQUIRED (OR-33, DEP-F24, reversing edge hardening DEP-11): a
 * bare `appointmentNotePorts(db)` does not type-check.
 */
export const appointmentNotePorts = (
  db: Firestore,
  guard: ReadGuard,
): AppointmentNotePorts => ({
  observeAppointmentNote: (appointmentId) =>
    observeDoc<AppointmentNote>(
      doc(db, Collections.AppointmentNotes, appointmentId),
      guard,
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

  updateAppointmentNote: async (appointmentId, decide) => {
    const ref = doc(db, Collections.AppointmentNotes, appointmentId);
    // A decision naming another visit is a defect, raised OUTSIDE the
    // transaction so it is never mistaken for the store's failure; the
    // attempt that met it writes nothing.
    let misfiled = null as string | null;
    // The guard's refusal of the note this attempt read — the port's answer,
    // reported once per path however many attempts meet it.
    let refused = null as RepositoryError | null;
    const reported = new Set<string>();
    let written: AppointmentNote | null;
    try {
      written = await runTransaction(db, async (tx) => {
        misfiled = null;
        refused = null;
        const snap = await tx.get(ref);
        const data = snap.data();
        const stored = admitted<AppointmentNote>(
          data === undefined ? null : entityOf<StoredDocument>(snap.id, data),
          Collections.AppointmentNotes,
          guard,
          reported,
        );
        if (!stored.ok) {
          // Never decided on, never written over: the attempt ends here.
          refused = stored.error;
          return null;
        }
        const next = decide(stored.value);
        if (next === null) return null;
        // The note's id IS the appointment's: the body is the entity minus it.
        const { id, ...body } = next;
        if (id !== appointmentId) {
          misfiled = id;
          return null;
        }
        tx.set(ref, body);
        return next;
      });
    } catch (cause) {
      return Result.err(writeFailed(ref.path, cause));
    }
    if (refused !== null) return Result.err(refused);
    if (misfiled !== null) {
      defect(
        `updateAppointmentNote: note ${misfiled} decided for ${appointmentId}`,
      );
    }
    return Result.ok(written);
  },
});
