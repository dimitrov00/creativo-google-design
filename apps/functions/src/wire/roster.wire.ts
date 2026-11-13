import { MinuteRange, RosterBreak, ShiftSegment } from '@core/components';
import { SchedulingError } from '@core/errors';
import {
  BarberId,
  EndMinute,
  LocalDate,
  LocationId,
  MinuteOfDay,
  Result,
  StoredFields,
  Weekday,
} from '@core/primitives';
import type {
  AmendRosterBreaksCommand,
  SetRosterWeekCommand,
} from '@core/pipelines';
import type { EdgeError } from '../edge';
import { callerUserId, callerWorksTheBook } from '../lib/booking/caller-roles';
import {
  idOf,
  isRecord,
  listOf,
  operationIdOf,
  payloadOf,
  type WireRequest,
} from './wire-read';

/**
 * THE ROSTER CALLABLE'S WIRE (owner, 2026-11-06) — `amendRosterBreaks`
 * `{ barberId, locationId, fromLocalDate, weekdays: [1…7], before:
 * { startMinutes, endMinutes } | null, after: … | null, operationId }` →
 * `{ barberId }`. A signed-in caller who works the book only
 * (`SCHEDULING_ROSTER_UNAUTHENTICATED` / `_FORBIDDEN`) — whose hours a
 * caller may change is the pipeline's question, asked of the STORED
 * account (team onboarding D5: a barber only their own); every field
 * re-read through its smart constructor, the first unreadable one named
 * (`SCHEDULING_ROSTER_INVALID_INPUT`). A change that changes nothing —
 * neither a `before` nor an `after` — is no change at all, and refused.
 */

/** A `{ startMinutes, endMinutes }` that is a real range, `null` when sent as `null`, else unreadable. */
function rangeOf(raw: unknown): MinuteRange | null | undefined {
  if (raw === null) return null;
  if (!isRecord(raw)) return undefined;
  const start = StoredFields.field(raw, 'startMinutes');
  const end = StoredFields.field(raw, 'endMinutes');
  return MinuteOfDay.is(start) && EndMinute.is(end) && start < end
    ? MinuteRange.of(start, end)
    : undefined;
}

/** The weekdays as sent — distinct ISO weekdays, at least one — else `null`. */
function weekdaysOf(raw: readonly unknown[]): readonly Weekday[] | null {
  const weekdays: Weekday[] = [];
  for (const day of raw) {
    if (!Weekday.is(day)) return null;
    if (!weekdays.includes(day)) weekdays.push(day);
  }
  return weekdays.length === 0 ? null : weekdays.sort((a, b) => a - b);
}

export function decodeAmendRosterBreaks(
  request: WireRequest,
): Result<AmendRosterBreaksCommand, EdgeError> {
  const caller = callerUserId(request);
  if (caller === null) {
    return Result.err(SchedulingError.rosterUnauthenticated());
  }
  if (!callerWorksTheBook(request)) {
    return Result.err(SchedulingError.rosterForbidden());
  }
  const payload = payloadOf(request);
  const invalid = (field: string) =>
    Result.err(SchedulingError.rosterInvalidInput(field));
  const barberId = idOf(
    StoredFields.field(payload, 'barberId'),
    BarberId.parse,
  );
  if (barberId === null) return invalid('barberId');
  const locationId = idOf(
    StoredFields.field(payload, 'locationId'),
    LocationId.parse,
  );
  if (locationId === null) return invalid('locationId');
  const fromLocalDate = idOf(
    StoredFields.field(payload, 'fromLocalDate'),
    LocalDate.parse,
  );
  if (fromLocalDate === null) return invalid('fromLocalDate');
  const weekdays = weekdaysOf(listOf(payload, 'weekdays'));
  if (weekdays === null) return invalid('weekdays');
  const before = rangeOf(StoredFields.field(payload, 'before') ?? null);
  if (before === undefined) return invalid('before');
  const after = rangeOf(StoredFields.field(payload, 'after') ?? null);
  if (after === undefined) return invalid('after');
  if (before === null && after === null) return invalid('after');
  // The act's name, REQUIRED (WS-4.1) — the web mints one per change.
  const operationId = operationIdOf(payload, 'operationId');
  if (operationId === null) return invalid('operationId');
  return Result.ok({
    barberId,
    locationId,
    fromLocalDate,
    weekdays,
    before,
    after,
    callerUserId: caller,
    operationId,
  });
}

/** A week holds at most this many shifts, and as many breaks — a handful a day. */
const WEEK_ENTRIES_MAX = 42;

/** `{ weekday, startMinutes, endMinutes }` as a weekday and a real range, else `null`. */
function weekdayRangeOf(
  raw: unknown,
): { readonly weekday: Weekday; readonly range: MinuteRange } | null {
  if (!isRecord(raw)) return null;
  const weekday = StoredFields.field(raw, 'weekday');
  const range = rangeOf(raw);
  return Weekday.is(weekday) && range !== null && range !== undefined
    ? { weekday, range }
    : null;
}

/**
 * `setRosterWeek` `{ barberId, locationId, fromLocalDate, segments:
 * [{ weekday, locationId, startMinutes, endMinutes }], breaks: [{ weekday,
 * startMinutes, endMinutes }], operationId }` → `{ barberId }` — the hours
 * editor's save. The same door as `amendRosterBreaks`: a signed-in caller
 * who works the book, every field re-read, the first unreadable one named.
 * Whether the week holds (overlaps, breaks inside shifts) is the system's
 * question, not the wire's.
 */
export function decodeSetRosterWeek(
  request: WireRequest,
): Result<SetRosterWeekCommand, EdgeError> {
  const caller = callerUserId(request);
  if (caller === null) {
    return Result.err(SchedulingError.rosterUnauthenticated());
  }
  if (!callerWorksTheBook(request)) {
    return Result.err(SchedulingError.rosterForbidden());
  }
  const payload = payloadOf(request);
  const invalid = (field: string) =>
    Result.err(SchedulingError.rosterInvalidInput(field));
  const barberId = idOf(
    StoredFields.field(payload, 'barberId'),
    BarberId.parse,
  );
  if (barberId === null) return invalid('barberId');
  const locationId = idOf(
    StoredFields.field(payload, 'locationId'),
    LocationId.parse,
  );
  if (locationId === null) return invalid('locationId');
  const fromLocalDate = idOf(
    StoredFields.field(payload, 'fromLocalDate'),
    LocalDate.parse,
  );
  if (fromLocalDate === null) return invalid('fromLocalDate');
  const rawSegments = listOf(payload, 'segments');
  if (rawSegments.length > WEEK_ENTRIES_MAX) return invalid('segments');
  const segments: ShiftSegment[] = [];
  for (const raw of rawSegments) {
    const read = weekdayRangeOf(raw);
    const shop = idOf(StoredFields.field(raw, 'locationId'), LocationId.parse);
    if (read === null || shop === null) return invalid('segments');
    segments.push(
      ShiftSegment.of(
        read.weekday,
        shop,
        read.range.startMinutes,
        read.range.endMinutes,
      ),
    );
  }
  const rawBreaks = listOf(payload, 'breaks');
  if (rawBreaks.length > WEEK_ENTRIES_MAX) return invalid('breaks');
  const breaks: RosterBreak[] = [];
  for (const raw of rawBreaks) {
    const read = weekdayRangeOf(raw);
    if (read === null) return invalid('breaks');
    breaks.push(RosterBreak.of(read.weekday, read.range));
  }
  const operationId = operationIdOf(payload, 'operationId');
  if (operationId === null) return invalid('operationId');
  return Result.ok({
    barberId,
    locationId,
    fromLocalDate,
    segments,
    breaks,
    callerUserId: caller,
    operationId,
  });
}
