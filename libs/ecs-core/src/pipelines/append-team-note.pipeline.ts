import {
  type AppointmentId,
  type UserId,
  type UtcEpochMs,
  Result,
} from '@core/primitives';
import type { RepositoryError } from '@core/errors';
import type { AppointmentNote } from '@core/entities';
import type { AppointmentNotePorts, ClockPorts } from '@core/ports';
import { VisitSidesSystem } from '@core/systems';

/**
 * The visit's note and the clock that stamps it — both team-note
 * pipelines' ports ({@link appendTeamNote} reads, decides and writes the
 * note in one transaction; {@link saveTeamNote} writes it straight through).
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
 * seat's reason). Moved from `staff-day.store.ts` `appendTeamNote` (Law 8.4);
 * the transaction IS the sandwich (Law 4):
 *
 * 1. a line that says nothing (`VisitSidesSystem.storedNote`) reads and
 *    writes nothing — `ok(null)`;
 * 2. the instant is read ONCE from the injected clock, before the
 *    transaction (a contention re-run keeps the one stamp);
 * 3. ONE transaction (`updateAppointmentNote`) reads the note as stored on
 *    the server and decides, purely, the joined text
 *    (`VisitSidesSystem.appendedNote`) as the one record
 *    ({@link noteRecord}) stamped with the command's author and that
 *    instant, and writes it — a concurrent edit re-runs the decision on the
 *    fresher note, so its words stay above the line;
 * 4. the answer is the note as written, or the transaction's failure —
 *    offline it refuses (`REPOSITORY_WRITE_FAILED`), never overwrites.
 */
export const appendTeamNote =
  (ports: TeamNotePorts) =>
  async (
    cmd: AppendTeamNoteCommand,
  ): Promise<Result<AppointmentNote | null, RepositoryError>> => {
    if (VisitSidesSystem.storedNote(cmd.line) === null) return Result.ok(null);
    const writtenAtUtcMs = ports.nowUtcMs();
    return ports.updateAppointmentNote(cmd.appointmentId, (stored) => {
      const text = VisitSidesSystem.appendedNote(
        stored?.text ?? null,
        cmd.line,
      );
      // A line that says something always leaves a note; nothing is written
      // over a note for want of words.
      return text === null
        ? null
        : noteRecord(cmd.appointmentId, text, cmd.authorUserId, writtenAtUtcMs);
    });
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
