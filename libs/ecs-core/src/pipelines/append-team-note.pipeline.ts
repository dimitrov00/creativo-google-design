import { firstValueFrom } from 'rxjs';
import { type AppointmentId, type UserId, Result } from '@core/primitives';
import { RepositoryError } from '@core/errors';
import type { AppointmentNote } from '@core/entities';
import type { AppointmentNotePorts, ClockPorts } from '@core/ports';
import { VisitSidesSystem } from '@core/systems';

/** The visit's note — read once, written once — and the clock that stamps it. */
export type AppendTeamNotePorts = AppointmentNotePorts & ClockPorts;

/** A line to file below a visit's note, and who files it. */
export type AppendTeamNoteCommand = {
  readonly appointmentId: AppointmentId;
  /** The words as typed — trimmed by the rule, blank is nothing to add. */
  readonly line: string;
  /** The session's account the note's author names — `null` before onboarding. */
  readonly authorUserId: UserId | null;
};

/**
 * A LINE ADDED BELOW THE VISIT'S NOTE, never over it — what a cancel's
 * «Друго…» files (D23: the words staff type are the visit's note, not the
 * seat's reason). Moved from `staff-day.store.ts` `appendTeamNote` (Law 8.4):
 *
 * 1. a line that says nothing (`VisitSidesSystem.storedNote`) reads and
 *    writes nothing — `ok(null)`;
 * 2. the note as stored NOW is read once, off the port the sheet listens on
 *    (its first answer); a read that fails — or a stream that closes
 *    without answering — writes nothing and is the failure: a note this
 *    device could not read would be written over;
 * 3. the joined text (`VisitSidesSystem.appendedNote`) is written in the
 *    stored form, stamped with the command's author and — read after the
 *    note — the clock's instant; the answer is the note as written.
 */
export const appendTeamNote =
  (ports: AppendTeamNotePorts) =>
  async (
    cmd: AppendTeamNoteCommand,
  ): Promise<Result<AppointmentNote | null, RepositoryError>> => {
    if (VisitSidesSystem.storedNote(cmd.line) === null) return Result.ok(null);
    const read = await firstValueFrom(
      ports.observeAppointmentNote(cmd.appointmentId),
      { defaultValue: null },
    );
    if (read === null)
      return Result.err(RepositoryError.readFailed(null, null));
    if (!read.ok) return read;
    const text = VisitSidesSystem.appendedNote(
      read.value?.text ?? null,
      cmd.line,
    );
    // A line that says something always leaves a note; nothing is written
    // over a note for want of words.
    if (text === null) return Result.ok(null);
    const note: AppointmentNote = {
      id: cmd.appointmentId,
      text,
      authorUserId: cmd.authorUserId,
      writtenAtUtcMs: ports.nowUtcMs(),
    };
    const saved = await ports.saveAppointmentNote(cmd.appointmentId, note);
    return saved.ok ? Result.ok(note) : saved;
  };
