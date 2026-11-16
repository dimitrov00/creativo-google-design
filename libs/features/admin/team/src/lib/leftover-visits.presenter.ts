import type { Appointment } from '@core/entities';
import type { AppointmentId, LocalDate, ServiceId } from '@core/primitives';
import { VisitListSystem } from '@core/systems';
import type { StaffEventLine } from '@creativo/features/shared/visits';
import { formatMinute, formatWallClock } from '@creativo/ui/wall-clock';

/**
 * THE VISITS A LAST DAY LEAVES BEHIND, AS THE SCHEDULE WOULD CARD THEM
 * (team onboarding D10) — under the day each falls on, each row the
 * schedule's own visit: the client's face and name first, what was booked
 * under it, the clock at the trailing edge.
 *
 * The barber is not on the row. Every visit here is the same barber's and
 * the screen already says whose (owner, 2026-11-16): a column of one face
 * is noise, and the thing that differs from row to row — who to call — is
 * what leads.
 *
 * It words and decides nothing. Which visits are left is
 * `EmploymentSystem.leftoverVisitsOf`'s answer, handed in oldest first;
 * which day each files under is `VisitListSystem.dayGroups`'s.
 */

/** One visit left behind, as its row prints it. */
export interface LeftoverRowVm {
  readonly id: AppointmentId;
  readonly testId: string;
  /** Who the shop would call — the booking's own contact; `null` for a visit with nobody to call. */
  readonly clientName: string | null;
  /** The client; what was booked when there is nobody to name. */
  readonly title: string;
  /** What was booked, under the client's name — none when it is the title. */
  readonly lines: readonly StaffEventLine[];
  /** «10:00» and «10:30» on the shop's clock. */
  readonly start: string;
  readonly end: string;
  /** The row in one sentence, for a reader: who, what, which day, when. */
  readonly accessibleName: string;
}

/** A shop day and the visits left on it. */
export interface LeftoverSectionVm {
  readonly key: string;
  /** «Сряда, 18 ноември». */
  readonly label: string;
  readonly testId: string;
  readonly rows: readonly LeftoverRowVm[];
}

export interface LeftoverVisitsInput {
  /** The visits left, oldest first — as `EmploymentSystem.leftoverVisitsOf` answered them. */
  readonly visits: readonly Appointment[];
  /** The shop's today: which days are still ahead. */
  readonly today: LocalDate;
  readonly locale: string;
  /** «По-рано» — the heading of the visits before today that nobody closed. */
  readonly earlier: string;
  /** «Услуга» — what a seat is called when the catalogue no longer lists its service. */
  readonly unknownService: string;
  /** A service's name in the catalogue; `null` when it is not listed. */
  readonly serviceName: (id: ServiceId) => string | null;
}

/** «Вторник, 18 ноември» — a heading, so it starts with a capital. */
function headingOf(input: LeftoverVisitsInput, date: LocalDate): string {
  const label = formatWallClock(date, null, input.locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  return label.charAt(0).toLocaleUpperCase(input.locale) + label.slice(1);
}

/** «Подстригване · Оформяне на брада» — what the visit's seats sell, each once, in seat order. */
function servicesOf(visit: Appointment, input: LeftoverVisitsInput): string {
  const names: string[] = [];
  for (const seat of visit.seats) {
    const name = input.serviceName(seat.serviceId) ?? input.unknownService;
    if (!names.includes(name)) names.push(name);
  }
  return names.join(' · ');
}

function rowOf(
  visit: Appointment,
  heading: string,
  input: LeftoverVisitsInput,
): LeftoverRowVm {
  const services = servicesOf(visit, input);
  const clientName = visit.contactName;
  const start = formatMinute(visit.startMinutes, input.locale);
  return {
    id: visit.id,
    testId: `leftover-row-${visit.id}`,
    clientName,
    title: clientName ?? services,
    lines:
      clientName === null
        ? []
        : [{ text: services, testId: 'leftover-line-services' }],
    start,
    end: formatMinute(visit.endMinutes, input.locale),
    accessibleName: [clientName, services, heading, start]
      .filter((part): part is string => part !== null)
      .join(', '),
  };
}

/** The visits under their days: one section per shop day, in the order given. */
export function leftoverSectionsVm(
  input: LeftoverVisitsInput,
): readonly LeftoverSectionVm[] {
  return VisitListSystem.dayGroups(input.visits, input.today).map((group) => {
    const label =
      group.groupDate === null
        ? input.earlier
        : headingOf(input, group.groupDate);
    return {
      key: group.groupKey,
      label,
      testId: `leftover-group-${group.groupKey}`,
      rows: group.visits.map((visit) => rowOf(visit, label, input)),
    };
  });
}
