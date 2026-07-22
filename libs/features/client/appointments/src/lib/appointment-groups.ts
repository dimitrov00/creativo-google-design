import { ZonedDateTime } from '@creativo/application/accounts';
import { Appointment } from '@creativo/application/booking';

export interface AppointmentDayGroup {
  readonly dayKey: string;
  readonly date: ZonedDateTime;
  readonly appointments: readonly Appointment[];
}

/** Chronological, grouped by calendar day — the shape the list view renders (one section per day). */
export function groupAppointmentsByDay(
  appointments: readonly Appointment[],
): readonly AppointmentDayGroup[] {
  const sorted = [...appointments].sort((a, b) =>
    a.timeSlot.start.isBefore(b.timeSlot.start) ? -1 : 1,
  );

  const groups: {
    dayKey: string;
    date: ZonedDateTime;
    appointments: Appointment[];
  }[] = [];
  for (const appointment of sorted) {
    const dayKey = appointment.timeSlot.calendarDayKey();
    const last = groups.at(-1);
    if (last && last.dayKey === dayKey) {
      last.appointments.push(appointment);
    } else {
      groups.push({
        dayKey,
        date: appointment.timeSlot.start,
        appointments: [appointment],
      });
    }
  }
  return groups;
}
