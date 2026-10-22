import {
  LocalizedText,
  type CourseInput,
  type PositionInput,
  type ShopEventInput,
} from '@core/components';
import type {
  Course,
  Position,
  ShopEvent,
  ShopEventContent,
  ShopLocation,
} from '@core/entities';
import {
  DateTimeInvalidReason,
  EngagementError,
  EngagementErrorCode,
  LocalDate,
  LocationId,
  MinuteOfDay,
  Result,
  TimeError,
  type CourseId,
  type EventId,
  type PositionId,
  type ProgramFieldError,
  type TimeZone,
  type UtcEpochMs,
} from '@core/primitives';

/**
 * The admin programs form, judged (flip 4, F4-5) — pure: the raw
 * `PositionInput` / `CourseInput` / `ShopEventInput` in, the flat entity (or
 * EVERY field refusal at once, in the form's order) out. The checks are
 * the legacy domain classes' exactly: both locales of every text trimmed and
 * non-blank (`LocalizedText.parse`, `en` first); a sort order that is an
 * integer `>= 0`; an apply URL trimmed, blank = none, otherwise one the URL
 * parser accepts, stored trimmed; a location id trimmed, blank = none,
 * otherwise `LocationId.parse` (F-3).
 *
 * The event's start is the shop's wall clock (`localDate` + `startMinutes`)
 * read from the exact form `<input type="datetime-local">` emits. No zone is
 * touched here (Law 7.3): the save pipeline reads the zone's location, asks
 * {@link ProgramsSystem.zoneOf} for the zone, converts ONCE with
 * `ZonedTimeSystem.toUtc`, and hands the instant to
 * {@link ProgramsSystem.shopEvent}.
 */

/** The event's start on the shop's wall clock — the parsed `startsAt`. */
type WallStart = {
  readonly localDate: LocalDate;
  readonly startMinutes: MinuteOfDay;
};

/** A field's verdict: its value, or the refusals it adds to the list. */
type FieldResult<T> = Result<T, readonly ProgramFieldError[]>;

/** `YYYY-MM-DDTHH:mm` — what a `datetime-local` input without a `step` emits (F4-1 (f)). */
const STARTS_AT = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;

/** Every refusal of the given verdicts, in argument order. */
function refusalsOf(
  ...verdicts: readonly FieldResult<unknown>[]
): readonly ProgramFieldError[] {
  const out: ProgramFieldError[] = [];
  for (let i = 0; i < verdicts.length; i++) {
    const verdict = verdicts[i] as FieldResult<unknown>;
    if (!verdict.ok) out.push(...verdict.error);
  }
  return out;
}

/** An integer `>= 0` — the list order an admin sets. */
function sortOrderOf(
  raw: number,
  errorCode: EngagementError.ProgramCode,
): FieldResult<number> {
  return Number.isInteger(raw) && raw >= 0
    ? Result.ok(raw)
    : Result.err([EngagementError.program(errorCode, raw)]);
}

/** Does the URL parser accept `text`? (`URL.canParse` is not used: older Safari lacks it.) */
function parsesAsUrl(text: string): boolean {
  try {
    new URL(text);
    return true;
  } catch {
    return false;
  }
}

/** Trimmed; blank = none; otherwise it must parse as a URL — stored trimmed. */
function applyUrlOf(
  raw: string,
  errorCode: EngagementError.ProgramCode,
): FieldResult<string | null> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return Result.ok(null);
  return parsesAsUrl(trimmed)
    ? Result.ok(trimmed)
    : Result.err([EngagementError.program(errorCode, trimmed)]);
}

/** Both locales blank = no label; otherwise both must be filled. */
function startsLabelOf(raw: LocalizedText): FieldResult<LocalizedText | null> {
  if (raw.bg.trim().length === 0 && raw.en.trim().length === 0) {
    return Result.ok(null);
  }
  return LocalizedText.parse(raw);
}

/** Every id parsed (F-3); every refusal collected, in list order. */
function locationIdsOf(
  raws: readonly string[],
): FieldResult<readonly LocationId[]> {
  const ids: LocationId[] = [];
  const refusals: ProgramFieldError[] = [];
  for (let i = 0; i < raws.length; i++) {
    const parsed = LocationId.parse(raws[i] as string);
    if (parsed.ok) ids.push(parsed.value);
    else refusals.push(parsed.error);
  }
  return refusals.length > 0 ? Result.err(refusals) : Result.ok(ids);
}

/** Trimmed; blank = not tied to one shop; otherwise a parsed id (F-3). */
function locationIdOf(raw: string): FieldResult<LocationId | null> {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return Result.ok(null);
  const parsed = LocationId.parse(trimmed);
  return parsed.ok ? parsed : Result.err([parsed.error]);
}

/**
 * `YYYY-MM-DDTHH:mm` on the shop's wall clock: any other form is
 * `UNPARSABLE`; a date that is not on the calendar or a time past 23:59 is
 * `OUT_OF_RANGE`. No zone is consulted.
 */
function wallStartOf(raw: string): FieldResult<WallStart> {
  const match = STARTS_AT.exec(raw);
  if (match === null) {
    return Result.err([
      TimeError.invalidDateTime(raw, DateTimeInvalidReason.Unparsable),
    ]);
  }
  const localDate = LocalDate.parse(match[1] as string);
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  const startMinutes = MinuteOfDay.of(hours * 60 + minutes);
  if (!localDate.ok || hours >= 24 || minutes >= 60 || !startMinutes.ok) {
    return Result.err([
      TimeError.invalidDateTime(raw, DateTimeInvalidReason.OutOfRange),
    ]);
  }
  return Result.ok({
    localDate: localDate.value,
    startMinutes: startMinutes.value,
  });
}

export const ProgramsSystem = {
  /**
   * A role from the admin form — sortOrder, title, summary, each location
   * id, apply URL, every refusal at once in that order. The status is the
   * form's chip, taken as typed.
   */
  position(
    id: PositionId,
    input: PositionInput,
  ): Result<Position, readonly ProgramFieldError[]> {
    const sortOrder = sortOrderOf(
      input.sortOrder,
      EngagementErrorCode.PositionSortOrderInvalid,
    );
    const title = LocalizedText.parse(input.title);
    const summary = LocalizedText.parse(input.summary);
    const locationIds = locationIdsOf(input.locationIds);
    const applyUrl = applyUrlOf(
      input.applyUrl,
      EngagementErrorCode.PositionApplyUrlInvalid,
    );
    if (
      !sortOrder.ok ||
      !title.ok ||
      !summary.ok ||
      !locationIds.ok ||
      !applyUrl.ok
    ) {
      return Result.err(
        refusalsOf(sortOrder, title, summary, locationIds, applyUrl),
      );
    }
    return Result.ok({
      id,
      title: title.value,
      summary: summary.value,
      locationIds: locationIds.value,
      positionStatus: input.positionStatus,
      applyUrl: applyUrl.value,
      sortOrder: sortOrder.value,
    });
  },

  /**
   * A course from the admin form — sortOrder, title, description, starts
   * label (both locales blank = none, one alone refused), apply URL, every
   * refusal at once in that order.
   */
  course(
    id: CourseId,
    input: CourseInput,
  ): Result<Course, readonly ProgramFieldError[]> {
    const sortOrder = sortOrderOf(
      input.sortOrder,
      EngagementErrorCode.CourseSortOrderInvalid,
    );
    const title = LocalizedText.parse(input.title);
    const description = LocalizedText.parse(input.description);
    const startsLabel = startsLabelOf(input.startsLabel);
    const applyUrl = applyUrlOf(
      input.applyUrl,
      EngagementErrorCode.CourseApplyUrlInvalid,
    );
    if (
      !sortOrder.ok ||
      !title.ok ||
      !description.ok ||
      !startsLabel.ok ||
      !applyUrl.ok
    ) {
      return Result.err(
        refusalsOf(sortOrder, title, description, startsLabel, applyUrl),
      );
    }
    return Result.ok({
      id,
      title: title.value,
      description: description.value,
      enrollmentStatus: input.enrollmentStatus,
      startsLabel: startsLabel.value,
      applyUrl: applyUrl.value,
      sortOrder: sortOrder.value,
    });
  },

  /**
   * An event's fields from the admin form, before its instant — the start
   * (wall clock), sortOrder, title, description, location id, apply URL,
   * every refusal at once in that order.
   */
  eventFields(
    input: ShopEventInput,
  ): Result<ShopEventContent, readonly ProgramFieldError[]> {
    const start = wallStartOf(input.startsAt);
    const sortOrder = sortOrderOf(
      input.sortOrder,
      EngagementErrorCode.ShopEventSortOrderInvalid,
    );
    const title = LocalizedText.parse(input.title);
    const description = LocalizedText.parse(input.description);
    const locationId = locationIdOf(input.locationId);
    const applyUrl = applyUrlOf(
      input.applyUrl,
      EngagementErrorCode.ShopEventApplyUrlInvalid,
    );
    if (
      !start.ok ||
      !sortOrder.ok ||
      !title.ok ||
      !description.ok ||
      !locationId.ok ||
      !applyUrl.ok
    ) {
      return Result.err(
        refusalsOf(start, sortOrder, title, description, locationId, applyUrl),
      );
    }
    return Result.ok({
      title: title.value,
      description: description.value,
      localDate: start.value.localDate,
      startMinutes: start.value.startMinutes,
      locationId: locationId.value,
      applyUrl: applyUrl.value,
      sortOrder: sortOrder.value,
    });
  },

  /** The location to read for the event's zone (F-4): its own, else the default shop. */
  zoneLocationOf(
    fields: ShopEventContent,
    defaultLocationId: LocationId,
  ): LocationId {
    return fields.locationId ?? defaultLocationId;
  },

  /**
   * The zone that places the event, or the refusal: the named location's
   * zone; else (a typed id naming no document) the default shop's; neither
   * → `ENGAGEMENT_SHOP_EVENT_ZONE_UNKNOWN` naming `defaultLocationId`.
   */
  zoneOf(
    named: ShopLocation | null,
    fallback: ShopLocation | null,
    defaultLocationId: LocationId,
  ): Result<TimeZone, EngagementError.ShopEventZoneUnknown> {
    if (named !== null) return Result.ok(named.timeZone);
    if (fallback !== null) return Result.ok(fallback.timeZone);
    return Result.err(EngagementError.shopEventZoneUnknown(defaultLocationId));
  },

  /** The event with the instant the ingestion boundary computed — a pure assembler. */
  shopEvent(
    id: EventId,
    fields: ShopEventContent,
    utcEpochMs: UtcEpochMs,
  ): ShopEvent {
    return {
      id,
      title: fields.title,
      description: fields.description,
      localDate: fields.localDate,
      startMinutes: fields.startMinutes,
      utcEpochMs,
      locationId: fields.locationId,
      applyUrl: fields.applyUrl,
      sortOrder: fields.sortOrder,
    };
  },
} as const;
