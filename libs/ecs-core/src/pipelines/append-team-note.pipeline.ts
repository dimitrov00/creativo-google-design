import { firstValueFrom } from 'rxjs';
import {
  type AppointmentId,
  type UserId,
  type UtcEpochMs,
  Result,
} from '@core/primitives';
import { RepositoryError } from '@core/errors';
import type { AppointmentNote } from '@core/entities';
import type { AppointmentNotePorts, ClockPorts } from '@core/ports';
import { VisitSidesSystem } from '@core/systems';

/**
 * The visit's note and the clock that stamps it — both team-note
 * pipelines' ports ({@link appendTeamNote} reads the note once and writes
 * it once; {@link saveTeamNote} writes it straight through).
 */
export type TeamNotePorts = AppointmentNotePorts & ClockPorts;

/** The note a visit's sheet saves, and who saves it. */
export type SaveTeamNoteCommand = {
  readonly appointmentId: AppointmentId;
  /** The note as drafted — stored trimmed; blank (or `null`) deletes it. */
  readonly text: string | null;
  /** The session's account the note's author names — `null` before onboarding. */
  readonly authorUserId: UserId | null;
};

/**
 * THE ONE RECORD a team note is stored as (D-10.2: built once, for
 * {@link saveTeamNote} and {@link appendTeamNote} alike) — the visit's id,
 * the text in its stored form, its author and the instant it was written,
 * in that key order.
 */
function noteRecord(
  appointmentId: AppointmentId,
  text: string,
  authorUserId: UserId | null,
  writtenAtUtcMs: UtcEpochMs,
): AppointmentNote {
  return { id: appointmentId, text, authorUserId, writtenAtUtcMs };
}

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
  (ports: TeamNotePorts) =>
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
    const note = noteRecord(
      cmd.appointmentId,
      text,
      cmd.authorUserId,
      ports.nowUtcMs(),
    );
    const saved = await ports.saveAppointmentNote(cmd.appointmentId, note);
    return saved.ok ? Result.ok(note) : saved;
  };

/**
 * THE VISIT'S NOTE, WRITTEN STRAIGHT THROUGH — what the visit sheet's
 * «Запази» writes beside the staff-edit batch (moved from
 * `staff-day.store.ts` `saveTeamNote`, D-10.2):
 *
 * 1. the text in its stored form (`VisitSidesSystem.storedNote`: trimmed,
 *    `null` for none); a note that says nothing DELETES the stored one —
 *    the port is handed `null`, and the clock is not read;
 * 2. otherwise the one record ({@link noteRecord}) stamped with the
 *    command's author and the clock's instant;
 * 3. one write; the answer is the note as written (`null` for a delete),
 *    or the write's failure.
 */
export const saveTeamNote =
  (ports: TeamNotePorts) =>
  async (
    cmd: SaveTeamNoteCommand,
  ): Promise<Result<AppointmentNote | null, RepositoryError>> => {
    const stored = VisitSidesSystem.storedNote(cmd.text);
    const note =
      stored === null
        ? null
        : noteRecord(
            cmd.appointmentId,
            stored,
            cmd.authorUserId,
            ports.nowUtcMs(),
          );
    const saved = await ports.saveAppointmentNote(cmd.appointmentId, note);
    return saved.ok ? Result.ok(note) : saved;
  };
