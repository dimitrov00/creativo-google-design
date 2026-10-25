import {
  type LocationId,
  LocalDate,
  type EndMinute,
  type MinuteOfDay,
} from '@core/primitives';
import type { SeatAssignment } from './seat-assignment.data';

/**
 * What the schedule step hands to review: WHERE, WHEN and BY WHOM. The
 * envelope (`startMinutes`–`endMinutes` on `localDate`) is first start to
 * last end — derived from the assignments ({@link ScheduleSelection.of}) and
 * never authored separately. Every seat starts on the one shop day (T7).
 * Split out of `booking-flow.data.ts` (pass D, D-7).
 */
export type ScheduleSelection = {
  readonly locationId: LocationId;
  readonly localDate: LocalDate;
  readonly startMinutes: MinuteOfDay;
  readonly endMinutes: EndMinute;
  readonly assignments: readonly SeatAssignment[];
};

const MINUTES_PER_DAY = 1440;

function isSpan(start: unknown, end: unknown): boolean {
  return (
    typeof start === 'number' &&
    typeof end === 'number' &&
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    start < end &&
    end <= MINUTES_PER_DAY
  );
}

function isId(raw: unknown): raw is string {
  return typeof raw === 'string' && raw.length > 0;
}

function isLocalDate(raw: unknown): boolean {
  return typeof raw === 'string' && LocalDate.parse(raw).ok;
}

export const ScheduleSelection = {
  /**
   * A selection with its envelope derived from the assignments — `null` when
   * there are none (an empty selection describes no appointment).
   */
  of(
    locationId: LocationId,
    localDate: LocalDate,
    assignments: readonly SeatAssignment[],
  ): ScheduleSelection | null {
    const first = assignments[0];
    if (first === undefined) return null;
    let startMinutes = first.startMinutes;
    let endMinutes = first.endMinutes;
    for (let i = 1; i < assignments.length; i++) {
      const assignment = assignments[i] as SeatAssignment;
      if (assignment.startMinutes < startMinutes) {
        startMinutes = assignment.startMinutes;
      }
      if (assignment.endMinutes > endMinutes)
        endMinutes = assignment.endMinutes;
    }
    return { locationId, localDate, startMinutes, endMinutes, assignments };
  },

  /** The edge guard: a shop, a real day and envelope, and well-formed assignments. */
  is(raw: unknown): raw is ScheduleSelection {
    if (raw === null || typeof raw !== 'object') return false;
    const selection = raw as Readonly<Record<string, unknown>>;
    if (!isId(selection['locationId'])) return false;
    if (!isLocalDate(selection['localDate'])) return false;
    if (!isSpan(selection['startMinutes'], selection['endMinutes'])) {
      return false;
    }
    const assignments = selection['assignments'];
    if (!Array.isArray(assignments) || assignments.length === 0) return false;
    for (let i = 0; i < assignments.length; i++) {
      const item: unknown = assignments[i];
      if (item === null || typeof item !== 'object') return false;
      const assignment = item as Readonly<Record<string, unknown>>;
      if (
        !isId(assignment['lineId']) ||
        !isId(assignment['barberId']) ||
        !isSpan(assignment['startMinutes'], assignment['endMinutes'])
      ) {
        return false;
      }
    }
    return true;
  },
} as const;
