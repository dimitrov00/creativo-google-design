import type { AppointmentId } from '@core/primitives';
import { VisitEditWrite } from '@core/components';
import type { VisitEditWritePorts } from '@core/ports';
import { type StaffSaveInput, StaffEditPlanSystem } from '@core/systems';

/**
 * One write of the staff visit sheet — a save, or a save's undo — and the
 * visit it writes: the plan's input ({@link StaffSaveInput}) beside the
 * appointment's id. The store hands its row and its live sides in AS IS.
 */
export type SaveVisitEditCommand = StaffSaveInput & {
  readonly appointmentId: AppointmentId;
};

/**
 * THE VISIT SHEET'S WRITE (OR-4; moved from the staff dashboard's
 * `writeFromEditor`, Law 8.4) — the store calls it for «Запази» and for
 * the receipt's «Отмени» alike, binding the ports to its own `staffEdit`,
 * `saveTeamNote` and `recordTip`. The sandwich, with the write half in a
 * fixed order:
 *
 * 1. pure compute — the plan (`StaffEditPlanSystem.savePlan`); a write it
 *    refuses goes out as it is, and NOTHING is sent: `STALE` (a note or a
 *    tip a colleague changed under the draft), or `BATCH_REFUSED` with the
 *    refusal (a placement the call cannot carry), for the store to file;
 * 2. ⚠ THE BATCH GOES FIRST, AND ALONE DECIDES (round 5): it claims the
 *    revision the commit was drawn from (`expectedVersion`), so a
 *    colleague's save since is refused, never overwritten — and a refused
 *    batch is `BATCH_REFUSED` with nothing beside it written (the store has
 *    filed the server's answer on the row). An empty batch sends nothing;
 *    today the chair-wide move and resize always ride along, so every write
 *    the plan admits sends one;
 * 3. THE TEAM NOTE, beside the batch and only once it landed — a staff-only
 *    sibling document no placement decision holds hostage; written only
 *    when the plan carries it;
 * 4. THE TIP, last — a stamp on the seat the plan names, the row's first
 *    that the batch KEPT; written only when the plan carries it;
 * 5. `WRITTEN`, saying whether every side document due landed
 *    (`sidesWritten`). A note that did not land does not stop the tip.
 */
export const saveVisitEdit =
  (ports: VisitEditWritePorts) =>
  async (cmd: SaveVisitEditCommand): Promise<VisitEditWrite> => {
    const plan = StaffEditPlanSystem.savePlan(cmd);
    if (plan.refusal !== null) return plan.refusal;

    if (plan.commands.length > 0) {
      const landed = await ports.sendStaffEdit({
        appointmentId: cmd.appointmentId,
        commands: plan.commands,
        acknowledgedOverlap: false,
        expectedVersion: cmd.commit.revision,
        operationId: null,
      });
      if (!landed) return VisitEditWrite.batchRefused(null);
    }

    const noteWritten = plan.writes.note
      ? await ports.saveTeamNoteText(cmd.appointmentId, cmd.commit.note)
      : true;
    const tipWritten =
      plan.tipSeat === null
        ? true
        : await ports.sendSeatTip({
            appointmentId: cmd.appointmentId,
            seatId: plan.tipSeat,
            amountCents: cmd.commit.tipCents,
          });

    return VisitEditWrite.written(noteWritten && tipWritten);
  };
