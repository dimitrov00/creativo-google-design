import {
  DayExceptionsEdit,
  type DayExceptionsRequest,
  MinuteRange,
  RosterBreak,
  ShiftSegment,
} from '@core/components';
import { AccessError, SchedulingError } from '@core/errors';
import {
  BarberId,
  EndMinute,
  LocalDate,
  LocationId,
  MinuteOfDay,
  Result,
  StoredFields,
  Tag,
  Weekday,
} from '@core/primitives';
import type {
  AmendRosterBreaksCommand,
  SetDayExceptionsCommand,
  SetRosterWeekCommand,
} from '@core/pipelines';
import type { EdgeError } from '../edge';
import { callerIsStaff, callerUserId } from '../lib/booking/caller-roles';
import {
  idOf,
  isRecord,
  listOf,
  operationIdOf,
  type Payload,
  payloadOf,
  type WireRequest,
} from './wire-read';

/**
 * THE ROSTER CALLABLE'S WIRE (owner, 2026-11-06) — `amendRosterBreaks`
 * `{ barberId, locationId, fromLocalDate, weekdays: [1…7], before:
 * { startMinutes, endMinutes } | null, after: … | null, operationId }` →
 * `{ barberId }`. A signed-in caller whose token holds a staff role only
 * (`SCHEDULING_ROSTER_UNAUTHENTICATED`, `ACCESS_NOT_STAFF`) — whose hours a
 * caller may change is the pipeline's question, asked of the STORED
 * account against the owner's permissions (staff permissions P6); every field
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
  if (!callerIsStaff(request)) return Result.err(AccessError.notStaff());
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
 * editor's save. The same door as `amendRosterBreaks`: a signed-in staff
 * caller, every field re-read, the first unreadable one named.
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
  if (!callerIsStaff(request)) return Result.err(AccessError.notStaff());
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

/** A series with an end writes at most a year of days (Law 5: truth is a pattern plus its departures). */
const DAYS_MAX = 366;

/** A day holds a handful of blocks; a longer list is no list. */
const RANGES_MAX = 24;

/** An edited block lands on a handful of chairs. */
const CHAIRS_MAX = 20;

/** One act stays inside one transaction's write limit, its audit rows included. */
const DAY_DOCUMENTS_MAX = 450;

/** A list of real ranges — absent or not a list is `null`, as is a list too long or holding anything else. */
function rangesOf(raw: unknown): readonly MinuteRange[] | null {
  if (!Array.isArray(raw) || raw.length > RANGES_MAX) return null;
  const ranges: MinuteRange[] = [];
  for (const entry of raw as readonly unknown[]) {
    const range = rangeOf(entry);
    if (range === null || range === undefined) return null;
    ranges.push(range);
  }
  return ranges;
}

/** Shop days as sent: at least one, at most {@link DAYS_MAX}, each once in the order given — else `null`. */
function daysOf(raw: unknown): readonly LocalDate[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > DAYS_MAX) {
    return null;
  }
  const days: LocalDate[] = [];
  for (const entry of raw as readonly unknown[]) {
    const day = idOf(entry, LocalDate.parse);
    if (day === null) return null;
    if (!days.includes(day)) days.push(day);
  }
  return days;
}

/** One barber's days at one shop — or the first field that cannot be read. */
function blockDaysOf(raw: Payload): Result<DayExceptionsRequest.Days, string> {
  const barberId = idOf(StoredFields.field(raw, 'barberId'), BarberId.parse);
  if (barberId === null) return Result.err('barberId');
  const locationId = idOf(
    StoredFields.field(raw, 'locationId'),
    LocationId.parse,
  );
  if (locationId === null) return Result.err('locationId');
  const ranges = rangesOf(StoredFields.field(raw, 'ranges'));
  if (ranges === null) return Result.err('ranges');
  const localDates = daysOf(StoredFields.field(raw, 'localDates'));
  if (localDates === null) return Result.err('localDates');
  return Result.ok({ barberId, locationId, ranges, localDates });
}

/** The request half of a `setDayExceptions` payload — or the first field that cannot be read. */
function dayExceptionsOf(
  dayExceptionsEdit: DayExceptionsEdit,
  payload: Payload,
): Result<DayExceptionsRequest, string> {
  switch (dayExceptionsEdit) {
    case DayExceptionsEdit.Block: {
      const days = blockDaysOf(payload);
      return days.ok ? Result.ok({ dayExceptionsEdit, ...days.value }) : days;
    }
    case DayExceptionsEdit.Clear: {
      const barberId = idOf(
        StoredFields.field(payload, 'barberId'),
        BarberId.parse,
      );
      if (barberId === null) return Result.err('barberId');
      const localDate = idOf(
        StoredFields.field(payload, 'localDate'),
        LocalDate.parse,
      );
      if (localDate === null) return Result.err('localDate');
      const range = rangeOf(StoredFields.field(payload, 'range') ?? null);
      return range === undefined
        ? Result.err('range')
        : Result.ok({ dayExceptionsEdit, barberId, localDate, range });
    }
    case DayExceptionsEdit.Move: {
      const liftBarberId = idOf(
        StoredFields.field(payload, 'liftBarberId'),
        BarberId.parse,
      );
      if (liftBarberId === null) return Result.err('liftBarberId');
      const liftLocalDate = idOf(
        StoredFields.field(payload, 'liftLocalDate'),
        LocalDate.parse,
      );
      if (liftLocalDate === null) return Result.err('liftLocalDate');
      const liftRange = rangeOf(StoredFields.field(payload, 'liftRange'));
      if (liftRange === null || liftRange === undefined) {
        return Result.err('liftRange');
      }
      const sent = listOf(payload, 'writes');
      if (sent.length === 0 || sent.length > CHAIRS_MAX) {
        return Result.err('writes');
      }
      const writes: DayExceptionsRequest.Days[] = [];
      let documents = 1;
      for (const raw of sent) {
        const days = isRecord(raw) ? blockDaysOf(raw) : null;
        if (days === null || !days.ok) return Result.err('writes');
        documents += days.value.localDates.length;
        writes.push(days.value);
      }
      return documents > DAY_DOCUMENTS_MAX
        ? Result.err('writes')
        : Result.ok({
            dayExceptionsEdit,
            liftBarberId,
            liftLocalDate,
            liftRange,
            writes,
          });
    }
    case DayExceptionsEdit.DayBreaks: {
      const barberId = idOf(
        StoredFields.field(payload, 'barberId'),
        BarberId.parse,
      );
      if (barberId === null) return Result.err('barberId');
      const locationId = idOf(
        StoredFields.field(payload, 'locationId'),
        LocationId.parse,
      );
      if (locationId === null) return Result.err('locationId');
      const localDate = idOf(
        StoredFields.field(payload, 'localDate'),
        LocalDate.parse,
      );
      if (localDate === null) return Result.err('localDate');
      const sent = StoredFields.field(payload, 'ranges') ?? null;
      const ranges = sent === null ? null : rangesOf(sent);
      return sent !== null && ranges === null
        ? Result.err('ranges')
        : Result.ok({
            dayExceptionsEdit,
            barberId,
            locationId,
            localDate,
            ranges,
          });
    }
  }
}

/**
 * `setDayExceptions` — the staff schedule's four pens (team onboarding O4):
 *
 * - `{ dayExceptionsEdit: 'BLOCK', barberId, locationId, ranges: [],
 *   localDates: [] }` — no range stands each day down whole;
 * - `{ dayExceptionsEdit: 'CLEAR', barberId, localDate, range: … | null }`;
 * - `{ dayExceptionsEdit: 'MOVE', liftBarberId, liftLocalDate, liftRange,
 *   writes: [{ barberId, locationId, ranges, localDates }] }`;
 * - `{ dayExceptionsEdit: 'DAY_BREAKS', barberId, locationId, localDate,
 *   ranges: [] | null }`;
 *
 * each with its `operationId`, → `{ barberIds }`. The roster callables'
 * door: a signed-in staff caller, every field re-read, the
 * first unreadable one named. Whose days a caller may change, and whether
 * a block holds, are the pipeline's questions.
 */
export function decodeSetDayExceptions(
  request: WireRequest,
): Result<SetDayExceptionsCommand, EdgeError> {
  const caller = callerUserId(request);
  if (caller === null) {
    return Result.err(SchedulingError.rosterUnauthenticated());
  }
  if (!callerIsStaff(request)) return Result.err(AccessError.notStaff());
  const payload = payloadOf(request);
  const invalid = (field: string) =>
    Result.err(SchedulingError.rosterInvalidInput(field));
  const dayExceptionsEdit = StoredFields.field(payload, 'dayExceptionsEdit');
  if (!Tag.has(DayExceptionsEdit, dayExceptionsEdit)) {
    return invalid('dayExceptionsEdit');
  }
  const edit = dayExceptionsOf(dayExceptionsEdit, payload);
  if (!edit.ok) return invalid(edit.error);
  const operationId = operationIdOf(payload, 'operationId');
  if (operationId === null) return invalid('operationId');
  return Result.ok({ ...edit.value, callerUserId: caller, operationId });
}
