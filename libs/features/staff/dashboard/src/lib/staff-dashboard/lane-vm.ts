import { WallTime } from '@core/components';
import type { LocalDate } from '@core/primitives';
import { VisitListSystem } from '@core/systems';
import type { BarberDayLane } from '../staff-day.store';
import { startMinuteOf } from './staff-day-save';
import {
  blockRowVm,
  type DayRowContext,
  dayRowVm,
  type GapChair,
  gapRowVm,
} from './staff-day.presenter';
import {
  AgendaRow,
  type DayRowVm,
  type GapRowVm,
  type LaneVm,
  type RunEntryVm,
} from './staff-day.vm';

/**
 * ONE CHAIR'S DAY AS THE PAGE DRAWS IT — its visits (the filter's `drawn`
 * applied), its holes and its blocked time in one clock-ordered run, the
 * next unstarted visit marked. The agenda and the grid both read lanes.
 */
export function laneVmOf(
  lane: BarberDayLane,
  chair: GapChair,
  localDate: LocalDate | null,
  context: DayRowContext,
  drawn: (rows: readonly DayRowVm[]) => readonly DayRowVm[],
): LaneVm {
  const shopNow = context.shopNow;
  const visits = drawn(
    lane.appointments.map((appointment) =>
      dayRowVm(appointment, lane.barberId, context),
    ),
  );
  const gaps: GapRowVm[] = lane.gaps.map((gap) =>
    gapRowVm(gap, chair, localDate, context),
  );
  const blocks =
    localDate === null
      ? []
      : lane.blocks.map((block) =>
          blockRowVm(block, chair, localDate, shopNow, context),
        );
  // One run in clock order, on the shop's wall clock (one shop day per
  // lane). A gap, a block and a visit never share a start minute — a
  // hole or a block holds no visit's start — so the stable sort is total.
  const clockOrder: RunEntryVm[] = [...visits, ...gaps, ...blocks].sort(
    (a, b) => startMinuteOf(a) - startMinuteOf(b),
  );

  // ── The present tense ──────────────────────────────────────────────
  //
  // The run had none: nothing separated a cut finished at ten from one
  // three hours out, and the screen opened at 09:00 on a day already
  // half over. The chair's next unstarted visit is the row the eye
  // should find first; the NOW hairline is where the day actually is.
  // The FIRST in the lane's own order (the envelope order the day's
  // reader delivers) that has not begun on the shop's wall clock
  // (`VisitListSystem.hasStarted`).
  const next =
    shopNow === null
      ? null
      : VisitListSystem.firstOpenInChair(
          visits,
          (row) => ({
            bookingStatus: row.bookingStatus,
            start: WallTime.of(row.localDate, row.startMinute),
          }),
          shopNow,
        );
  const entries: RunEntryVm[] = clockOrder.map((entry) =>
    entry.agendaRow === AgendaRow.Visit && entry.id === next?.id
      ? { ...entry, isNext: true }
      : entry,
  );

  return {
    barberId: lane.barberId,
    barberName: chair.barberName,
    avatarSrc: chair.barberAvatarSrc,
    entries,
    rostered: lane.rostered.length > 0,
    failed: lane.failed,
  };
}
