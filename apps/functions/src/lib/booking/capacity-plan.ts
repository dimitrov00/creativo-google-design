import { type LocationDayHours } from '@creativo/domain/catalog';
import {
  CalendarDay,
  Interval,
  type ScheduleException,
  type ShopDayHours,
  StaffScheduleHistory,
  buildDayWindows,
  shopDayHours,
} from '@creativo/domain/scheduling';
import { LocationId } from '@creativo/domain/catalog';
import {
  type CapacityContribution,
  type PersistedSlot,
  busyIntervalsOf,
  capacityMonthKey,
} from '@creativo/application/booking';

/**
 * The PURE half of the capacity rebuild: geometry in, write plan out.
 *
 * Everything that decides a number lives here, with no SDK anywhere in
 * sight, so the math is exercised by plain unit tests on every commit. The
 * I/O shell in `rebuild-capacity.ts` only fetches these inputs and applies
 * the plan — its own hazard (Firestore's merge-vs-replace semantics) is
 * covered by the emulator suite, because THAT hazard cannot be faked: the
 * critical bug this split descends from would have passed green against any
 * in-memory Firestore stand-in that merged the way its author assumed.
 */
export interface CapacityPlanInput {
  readonly barberId: string;
  readonly dayKeys: readonly string[];
  readonly zone: string;
  /** Parsed roster, or `null` when the barber has none — every day deletes. */
  readonly schedule: {
    readonly history: StaffScheduleHistory;
    readonly turnaroundMinutes: number;
  } | null;
  /** ACTIVE locations only — an archived shop must not sell hours. */
  readonly hoursByLocation: ReadonlyMap<string, readonly LocationDayHours[]>;
  readonly busyByDay: ReadonlyMap<string, readonly PersistedSlot[]>;
  readonly exceptionByDay: ReadonlyMap<string, ScheduleException | null>;
}

/** `contribution: null` means "delete this barber's entry for the day". */
export interface PlannedEntry {
  readonly dayKey: string;
  readonly contribution: CapacityContribution | null;
}

export interface CapacityMonthPlan {
  readonly month: string;
  readonly entries: readonly PlannedEntry[];
}

export function planBarberCapacity(
  input: CapacityPlanInput,
): readonly CapacityMonthPlan[] {
  const byMonth = new Map<string, PlannedEntry[]>();
  for (const dayKey of input.dayKeys) {
    const contribution = input.schedule
      ? contributionFor(input, input.schedule, dayKey)
      : null;
    const month = capacityMonthKey(dayKey);
    const entries = byMonth.get(month) ?? [];
    entries.push({ dayKey, contribution });
    byMonth.set(month, entries);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, entries]) => ({ month, entries }));
}

function contributionFor(
  input: CapacityPlanInput,
  schedule: NonNullable<CapacityPlanInput['schedule']>,
  dayKey: string,
): CapacityContribution | null {
  const day = CalendarDay.create(dayKey, input.zone);
  if (day.isFailure()) return null;

  const hours = new Map<string, ShopDayHours | null>();
  for (const [locationId, weekly] of input.hoursByLocation) {
    hours.set(locationId, shopDayHoursFor(day.value, locationId, weekly));
  }

  const exception = input.exceptionByDay.get(dayKey) ?? null;
  const windows = buildDayWindows({
    day: day.value,
    schedule: schedule.history,
    exceptions: exception ? [exception] : [],
    shopHours: hours,
  });
  if (windows.length === 0) return null;

  // Padded exactly as the calendar's retired fan-out padded — turnaround on
  // both sides, then normalized.
  const padded = Interval.normalize(
    busyIntervalsOf(input.busyByDay.get(dayKey) ?? [], input.zone).map(
      (interval) =>
        Interval.pad(
          interval,
          schedule.turnaroundMinutes,
          schedule.turnaroundMinutes,
        ),
    ),
  );

  const intervalsByLocation = new Map<string, Interval[]>();
  for (const window of windows) {
    // A segment rostered at a shop the active set does not know — archived,
    // or a typo — contributes NOTHING. `buildDayWindows` treats an absent
    // hours entry as "publishes no bound", which is right for a shop that
    // simply never authored hours and wrong for one that was retired: an
    // archived shop's chair must not sell unclamped hours into "any shop".
    if (!input.hoursByLocation.has(window.locationId.value)) continue;
    const list = intervalsByLocation.get(window.locationId.value) ?? [];
    list.push(window.interval);
    intervalsByLocation.set(window.locationId.value, list);
  }

  const byLocation: Record<string, number> = {};
  for (const [locationId, intervals] of intervalsByLocation) {
    const free = Interval.totalMinutes(Interval.subtract(intervals, padded));
    if (free > 0) byLocation[locationId] = free;
  }
  return Object.keys(byLocation).length > 0 ? byLocation : null;
}

function shopDayHoursFor(
  day: CalendarDay,
  locationId: string,
  hours: readonly LocationDayHours[],
): ShopDayHours | null {
  const parsed = LocationId.create(locationId);
  return parsed.isSuccess() ? shopDayHours(day, parsed.value, hours) : null;
}

/**
 * Inclusive `YYYY-MM-DD` walk — zone-free, the keys are already calendar
 * days. `truncated` (instead of logging here) keeps the module pure; the
 * shell owns the warning.
 */
export function dayKeysBetween(
  fromKey: string,
  toKey: string,
): { readonly keys: readonly string[]; readonly truncated: boolean } {
  const keys: string[] = [];
  const cursor = new Date(`${fromKey}T12:00:00Z`);
  const end = new Date(`${toKey}T12:00:00Z`);
  while (cursor.getTime() <= end.getTime()) {
    if (keys.length >= 500) return { keys, truncated: true };
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return { keys, truncated: false };
}

/** `2026-10-31` → `2026-11-30`: last day of the following month. */
export function horizonSpanEndKey(horizonEndKey: string): string {
  const year = Number(horizonEndKey.slice(0, 4));
  const month = Number(horizonEndKey.slice(5, 7));
  const lastOfNext = new Date(Date.UTC(year, month + 1, 0));
  return lastOfNext.toISOString().slice(0, 10);
}
