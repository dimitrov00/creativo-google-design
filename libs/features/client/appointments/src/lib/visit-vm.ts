import { ZonedDateTime } from '@creativo/application/accounts';
import {
  Appointment,
  AppointmentStatusKind,
} from '@creativo/application/booking';

/**
 * One visit, as a row states it: WHEN in the badge, WHAT in the title, WITH
 * WHOM underneath.
 *
 * Built here rather than in the template because every field is a lookup or
 * a format — a template that calls four methods per row re-runs all of them
 * on every change detection, which is what made the booking calendar's day
 * cells slow enough to feel.
 */
export interface VisitVm {
  readonly id: string;
  readonly appointment: Appointment;
  /** "сб" — the weekday, short, in the badge's top line. */
  readonly weekdayShort: string;
  readonly dayOfMonth: number;
  /** The services, joined — what the visit IS. */
  readonly title: string;
  /**
   * The barber, or the party of them. `null` avatar with a group label is
   * what a multi-barber appointment looks like: two faces in one row is a
   * row about faces rather than about a visit.
   */
  readonly barberLabel: string;
  readonly barberAvatarSrc: string | null;
  readonly barberMonogram: string;
  readonly multipleBarbers: boolean;
  readonly timeLabel: string;
  readonly upcoming: boolean;
  readonly status: AppointmentStatusKind;
}

/**
 * A run of visits under one heading — "upcoming", then one per month going
 * back. The `key` is what the jump pills and the scroll spy agree on.
 */
export interface VisitSection {
  readonly key: string;
  /** "Предстоящи" / "Юли" — the heading AND the pill say the same word. */
  readonly label: string;
  readonly visits: readonly VisitVm[];
}

/** `2026-07` — the month a visit belongs to, as a section key. */
export function monthKeyOf(date: ZonedDateTime): string {
  return date.toISODate().slice(0, 7);
}

/**
 * Past visits into month sections, newest month first and newest visit first
 * within it.
 *
 * A month with no visits gets NO section and therefore no pill — the pills
 * are a map of when this person actually came, not a calendar. (HIG's own
 * rule for a filter row: every option leads somewhere.)
 */
export function groupVisitsByMonth(
  visits: readonly VisitVm[],
  labelFor: (date: ZonedDateTime) => string,
): readonly VisitSection[] {
  const byMonth = new Map<string, VisitVm[]>();
  for (const visit of visits) {
    const key = monthKeyOf(visit.appointment.timeSlot.start);
    const bucket = byMonth.get(key);
    if (bucket) bucket.push(visit);
    else byMonth.set(key, [visit]);
  }

  return [...byMonth.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, group]) => ({
      key,
      label: labelFor(group[0]?.appointment.timeSlot.start as ZonedDateTime),
      visits: [...group].sort((a, b) =>
        a.appointment.timeSlot.start.isBefore(b.appointment.timeSlot.start)
          ? 1
          : -1,
      ),
    }));
}
