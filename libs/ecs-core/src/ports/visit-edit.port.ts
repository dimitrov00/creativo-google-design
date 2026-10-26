import type { BookingCall } from '@core/components';
import type { AppointmentId } from '@core/primitives';

/**
 * The staff visit sheet's three writes (OR-4), as the `saveVisitEdit`
 * pipeline (`@core/pipelines`) sequences them for a save and for its undo:
 * the staff-edit batch goes first and alone decides; the team note and then
 * the tip follow only once it has landed (round 5 — written before it, a
 * batch refused as stale would already have put the old screen's note and
 * tip over a colleague's).
 *
 * Implemented by the staff day store over its own writers (`staffEdit`,
 * `saveTeamNote`, `recordTip`), which keep each refusal on the visit's row
 * for the sheet to say — so every port answers only whether its write
 * landed, and the pipeline decides what comes next from that alone.
 */

/**
 * The `staffEditAppointment` batch — ONE request folding every command over
 * the stored seats, claiming the revision the draft was drawn from
 * (`expectedVersion`). `true` once it landed; `false` when it was refused,
 * its refusal kept on the row.
 */
export type SendStaffEdit = (intent: BookingCall.StaffEdit) => Promise<boolean>;

/**
 * The visit's team note, written straight through beside the batch (the
 * staff-only sibling document, never a command); `null` or an empty text
 * deletes it. `true` once written.
 */
export type SaveTeamNoteText = (
  appointmentId: AppointmentId,
  text: string | null,
) => Promise<boolean>;

/**
 * One seat's tip (`recordSeatTip`, `amountCents: null` clears it) — a stamp
 * on a seat the batch KEPT, sent after it. `true` once recorded.
 */
export type SendSeatTip = (request: BookingCall.Tip) => Promise<boolean>;

// ── Focused bundles (Law 9 — composed with `&`, never sliced) ─────────────

/** The staff-edit batch. */
export type StaffEditSendPorts = {
  readonly sendStaffEdit: SendStaffEdit;
};

/** The team note's straight-through save. */
export type TeamNoteSavePorts = {
  readonly saveTeamNoteText: SaveTeamNoteText;
};

/** One seat's tip. */
export type SeatTipSendPorts = {
  readonly sendSeatTip: SendSeatTip;
};

/** Everything a visit-sheet save writes — what `saveVisitEdit` takes. */
export type VisitEditWritePorts = StaffEditSendPorts &
  TeamNoteSavePorts &
  SeatTipSendPorts;
