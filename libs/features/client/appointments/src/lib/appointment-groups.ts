import type { Appointment } from '@core/entities';
import { WallTime } from '@core/components';
import type { LocalDate } from '@core/primitives';

export interface AppointmentDayGroup {
  /** The shop day the group is (`localDate`, `YYYY-MM-DD`). */
  readonly dayKey: LocalDate;
  readonly appointments: readonly Appointment[];
}

/**
 * Chronological, grouped by the shop's calendar day — the shape the list
 * view renders (one section per day). Ordered on the shop's wall clock
 * (`localDate` + `startMinutes`, Law 7.3), never on an instant.
 */
export function groupAppointmentsByDay(
  appointments: readonly Appointment[],
): readonly AppointmentDayGroup[] {
  const sorted = [...appointments].sort((a, b) =>
    WallTime.compare(
      WallTime.of(a.localDate, a.startMinutes),
      WallTime.of(b.localDate, b.startMinutes),
    ),
  );

  const groups: { dayKey: LocalDate; appointments: Appointment[] }[] = [];
  for (const appointment of sorted) {
    const last = groups.at(-1);
    if (last && last.dayKey === appointment.localDate) {
      last.appointments.push(appointment);
    } else {
      groups.push({
        dayKey: appointment.localDate,
        appointments: [appointment],
      });
    }
  }
  return groups;
}
