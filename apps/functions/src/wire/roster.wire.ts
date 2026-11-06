import { MinuteRange } from '@core/components';
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
import type { AmendRosterBreaksCommand } from '@core/pipelines';
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
 * (`SCHEDULING_ROSTER_UNAUTHENTICATED` / `_FORBIDDEN`); every field
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
  if (callerUserId(request) === null) {
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
  if (operationIdOf(payload, 'operationId') === null) {
    return invalid('operationId');
  }
  return Result.ok({
    barberId,
    locationId,
    fromLocalDate,
    weekdays,
    before,
    after,
  });
}
