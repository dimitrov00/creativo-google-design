import {
  ContactMethod,
  E164,
  Email,
  EnrollmentStatus,
  LocalizedText,
  PositionStatus,
  RichText,
  WorkplaceMode,
  type ContactLink,
  type CourseInput,
  type PositionInput,
  type ProgramContact,
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
  LocalDate,
  Locale,
  LocationId,
  MinuteOfDay,
  Result,
  Tag,
  type CourseId,
  type EventId,
  type PositionId,
  type TimeZone,
  type UtcEpochMs,
} from '@core/primitives';
import {
  DateTimeInvalidReason,
  EngagementError,
  EngagementErrorCode,
  TimeError,
  type ProgramFieldError,
} from '@core/errors';

/**
 * The admin programs form, judged (flip 4, F4-5) — pure: the raw
 * `PositionInput` / `CourseInput` / `ShopEventInput` in, the flat entity (or
 * EVERY field refusal at once, in the form's order) out. The checks are
 * the legacy domain classes' exactly: both locales of every text trimmed and
 * non-blank (`LocalizedText.parse`, `en` first); a sort order that is an
 * integer `>= 0`; each contact trimmed, blank = dropped, otherwise canonical
 * for its method (E.164, an e-mail, an Instagram handle, a URL the parser
 * accepts) and one per method; a location id trimmed, blank = none,
 * otherwise `LocationId.parse` (F-3).
 *
 * The event's start is the shop's wall clock (`localDate` + `startMinutes`)
 * read from the exact form `<input type="datetime-local">` emits. No zone is
 * touched here (Law 7.3): the save pipeline reads the ONE location that
 * places the event, asks {@link ProgramsSystem.zoneOf} for the zone (an
 * event at a shop that is not stored is refused — OR-38), converts ONCE
 * with `ZonedTimeSystem.toUtc`, and hands the instant to
 * {@link ProgramsSystem.shopEvent}.
 *
 * The pages' shop lookups are here too (OR-37, OR-42): the shop an event
 * is at ({@link ProgramsSystem.eventShop}) and the shops a role is open at
 * ({@link ProgramsSystem.positionShops}), each a linear scan of the
 * catalogue's shops — and their complements, the stored shops the
 * catalogue does not list (hidden or deleted) that the admin's pickers
 * keep ({@link ProgramsSystem.eventUnlistedShop},
 * {@link ProgramsSystem.positionUnlistedShops}).
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

/** An Instagram handle: letters, digits, dots and underscores, 30 at most. */
const INSTAGRAM_HANDLE = /^[A-Za-z0-9._]{1,30}$/;
/** A pasted profile address, with or without scheme, `www.` and a trailing slash or query. */
const INSTAGRAM_ADDRESS =
  /^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?#]+)\/?(?:[?#].*)?$/i;

/** The handle of what was typed — `@name`, `name` or the profile's address — or `null`. */
function instagramHandleOf(trimmed: string): string | null {
  const fromAddress = INSTAGRAM_ADDRESS.exec(trimmed)?.[1];
  const handle = fromAddress ?? trimmed.replace(/^@/, '');
  return INSTAGRAM_HANDLE.test(handle) ? handle : null;
}

/** The canonical value of a contact of `method`, or `null` when `trimmed` is not its shape. */
function contactValueOf(method: ContactMethod, trimmed: string): string | null {
  switch (method) {
    case ContactMethod.Phone:
      // The phone field hands over E.164; the number plans are its question.
      return E164.is(trimmed) ? trimmed : null;
    case ContactMethod.Email:
      return Email.parse(trimmed);
    case ContactMethod.Instagram:
      return instagramHandleOf(trimmed);
    case ContactMethod.Link:
      return parsesAsUrl(trimmed) ? trimmed : null;
  }
}

/**
 * The contacts as stored: each value trimmed, a blank one dropped, the rest
 * canonical, in the order typed. A value that is not its method's shape,
 * and a method given a second time, are each a refusal.
 */
function contactsOf(
  raws: readonly ProgramContact[],
  errorCode: EngagementError.ProgramCode,
): FieldResult<readonly ProgramContact[]> {
  const kept: ProgramContact[] = [];
  const refusals: ProgramFieldError[] = [];
  for (let i = 0; i < raws.length; i++) {
    const raw = raws[i] as ProgramContact;
    const trimmed = raw.contactValue.trim();
    if (trimmed.length === 0) continue;
    const contactValue = contactValueOf(raw.contactMethod, trimmed);
    let repeated = false;
    for (let k = 0; k < kept.length; k++) {
      if (kept[k]?.contactMethod === raw.contactMethod) repeated = true;
    }
    if (contactValue === null || repeated) {
      refusals.push(EngagementError.program(errorCode, trimmed));
    } else {
      kept.push({ contactMethod: raw.contactMethod, contactValue });
    }
  }
  return refusals.length > 0 ? Result.err(refusals) : Result.ok(kept);
}

/** The address a tap on a contact opens. */
function contactHrefOf(contact: ProgramContact): string {
  switch (contact.contactMethod) {
    case ContactMethod.Phone:
      return `tel:${contact.contactValue}`;
    case ContactMethod.Email:
      return `mailto:${contact.contactValue}`;
    case ContactMethod.Instagram:
      return `https://www.instagram.com/${contact.contactValue}`;
    case ContactMethod.Link:
      return contact.contactValue;
  }
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
   * The place a NEW thing takes in a list ordered by `sortOrder`: after the
   * last one — one more than the highest place held, `0` in an empty list.
   */
  nextSortOrder(list: readonly { readonly sortOrder: number }[]): number {
    let highest = -1;
    for (const entry of list) {
      if (entry.sortOrder > highest) highest = entry.sortOrder;
    }
    return highest + 1;
  },

  /**
   * A list as it was just arranged, read as places: each thing takes its
   * index as its `sortOrder`, and the answer holds ONLY the things whose
   * place changed, in the new order — what a reorder has to write. Nothing
   * moved, nothing answered.
   */
  resequenced<T extends { readonly sortOrder: number }>(
    arranged: readonly T[],
  ): readonly T[] {
    const moved: T[] = [];
    for (let index = 0; index < arranged.length; index += 1) {
      const entry = arranged[index];
      if (entry !== undefined && entry.sortOrder !== index) {
        moved.push({ ...entry, sortOrder: index });
      }
    }
    return moved;
  },

  /**
   * The ways a page offers to answer a program, each with the address a tap
   * opens, in the stored order. A program with none of its own is answered
   * through the shop's Instagram (`instagramUrl`), so the answer is never
   * empty.
   */
  contactLinks(
    contacts: readonly ProgramContact[],
    instagramUrl: string,
  ): readonly ContactLink[] {
    if (contacts.length === 0) {
      return [{ contactMethod: ContactMethod.Instagram, href: instagramUrl }];
    }
    const links: ContactLink[] = [];
    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i] as ProgramContact;
      links.push({
        contactMethod: contact.contactMethod,
        href: contactHrefOf(contact),
      });
    }
    return links;
  },

  /**
   * A role with its status turned over: an open one closed, a closed one
   * opened. Everything else it holds is kept.
   */
  positionToggled(position: Position): Position {
    return {
      ...position,
      positionStatus:
        position.positionStatus === PositionStatus.Open
          ? PositionStatus.Closed
          : PositionStatus.Open,
    };
  },

  /**
   * A course with its enrolment turned over: an open one closed, and one
   * that is closed or still upcoming opened. Everything else is kept.
   */
  courseToggled(course: Course): Course {
    return {
      ...course,
      enrollmentStatus:
        course.enrollmentStatus === EnrollmentStatus.Open
          ? EnrollmentStatus.Closed
          : EnrollmentStatus.Open,
    };
  },

  /**
   * A description as the editor typed it, judged: the Markdown per
   * language to store; `null` for none — every language blank — whose
   * document is then removed; or what refuses it: written in one language
   * it is owed in each (`LocalizedText.parse`), and no language may hold
   * more than `RichText.BODY_MAX_CHARS`.
   */
  body(raw: LocalizedText): FieldResult<LocalizedText | null> {
    if (raw.bg.trim().length === 0 && raw.en.trim().length === 0) {
      return Result.ok(null);
    }
    const text = LocalizedText.parse(raw);
    if (!text.ok) return text;
    const tooLong: ProgramFieldError[] = [];
    for (const locale of Tag.values(Locale)) {
      const length = text.value[locale].length;
      if (length > RichText.BODY_MAX_CHARS) {
        tooLong.push(
          EngagementError.program(
            EngagementErrorCode.ProgramBodyTooLong,
            length,
          ),
        );
      }
    }
    return tooLong.length > 0 ? Result.err(tooLong) : text;
  },

  /**
   * A list with the thing at `from` moved to `to`, the rest keeping their
   * order. An index outside the list, or a move to its own place, answers
   * the list as it is.
   */
  moved<T>(list: readonly T[], from: number, to: number): readonly T[] {
    const inside = (index: number) =>
      Number.isInteger(index) && index >= 0 && index < list.length;
    if (!inside(from) || !inside(to) || from === to) return list;
    const next = [...list];
    const [entry] = next.splice(from, 1);
    if (entry === undefined) return list;
    next.splice(to, 0, entry);
    return next;
  },

  /**
   * Shown on the public page: a course open now, or opening — never a
   * closed one (`MarketingCourses`' `LISTED_STATUSES`, the values of index
   * #11's `in` filter). The rule's one home (pass D: was the components'
   * free function `isEnrollmentOpenOrUpcoming`).
   */
  isEnrollmentOpenOrUpcoming(status: EnrollmentStatus): boolean {
    return status !== EnrollmentStatus.Closed;
  },

  /**
   * A role from the admin form — sortOrder, title, summary, each location
   * id, contacts, every refusal at once in that order. The status is the
   * form's chip, taken as typed, and so is where the role is worked — but
   * a remote role is tied to no shop, so its location ids are dropped
   * (after they were judged like any others).
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
    const contacts = contactsOf(
      input.contacts,
      EngagementErrorCode.PositionContactInvalid,
    );
    if (
      !sortOrder.ok ||
      !title.ok ||
      !summary.ok ||
      !locationIds.ok ||
      !contacts.ok
    ) {
      return Result.err(
        refusalsOf(sortOrder, title, summary, locationIds, contacts),
      );
    }
    return Result.ok({
      id,
      title: title.value,
      summary: summary.value,
      workplaceMode: input.workplaceMode,
      locationIds:
        input.workplaceMode === WorkplaceMode.Remote ? [] : locationIds.value,
      positionStatus: input.positionStatus,
      contacts: contacts.value,
      sortOrder: sortOrder.value,
    });
  },

  /**
   * A course from the admin form — sortOrder, title, description, starts
   * label (both locales blank = none, one alone refused), contacts, every
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
    const contacts = contactsOf(
      input.contacts,
      EngagementErrorCode.CourseContactInvalid,
    );
    if (
      !sortOrder.ok ||
      !title.ok ||
      !description.ok ||
      !startsLabel.ok ||
      !contacts.ok
    ) {
      return Result.err(
        refusalsOf(sortOrder, title, description, startsLabel, contacts),
      );
    }
    return Result.ok({
      id,
      title: title.value,
      description: description.value,
      enrollmentStatus: input.enrollmentStatus,
      startsLabel: startsLabel.value,
      contacts: contacts.value,
      sortOrder: sortOrder.value,
    });
  },

  /**
   * An event's fields from the admin form, before its instant — the start
   * (wall clock), sortOrder, title, description, location id, contacts,
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
    const contacts = contactsOf(
      input.contacts,
      EngagementErrorCode.ShopEventContactInvalid,
    );
    if (
      !start.ok ||
      !sortOrder.ok ||
      !title.ok ||
      !description.ok ||
      !locationId.ok ||
      !contacts.ok
    ) {
      return Result.err(
        refusalsOf(start, sortOrder, title, description, locationId, contacts),
      );
    }
    return Result.ok({
      title: title.value,
      description: description.value,
      localDate: start.value.localDate,
      startMinutes: start.value.startMinutes,
      locationId: locationId.value,
      contacts: contacts.value,
      sortOrder: sortOrder.value,
    });
  },

  /**
   * The ONE location to read for the event's zone (F-4, OR-38): its own,
   * else — an event at no shop — the default shop.
   */
  zoneLocationOf(
    fields: ShopEventContent,
    defaultLocationId: LocationId,
  ): LocationId {
    return fields.locationId ?? defaultLocationId;
  },

  /**
   * The zone that places the event, from the ONE location read for it
   * ({@link zoneLocationOf}) — `loaded`, `null` when it is not stored: its
   * zone; else an event that names a shop (`locationId`) is refused as
   * `ENGAGEMENT_SHOP_EVENT_LOCATION_UNKNOWN` naming that shop — never
   * placed on the default shop's clock (OR-38, DEP-F28); an event at no
   * shop whose default shop is absent is
   * `ENGAGEMENT_SHOP_EVENT_ZONE_UNKNOWN` naming `defaultLocationId`.
   */
  zoneOf(
    locationId: LocationId | null,
    loaded: ShopLocation | null,
    defaultLocationId: LocationId,
  ): Result<
    TimeZone,
    | EngagementError.ShopEventZoneUnknown
    | EngagementError.ShopEventLocationUnknown
  > {
    if (loaded !== null) return Result.ok(loaded.timeZone);
    return Result.err(
      locationId === null
        ? EngagementError.shopEventZoneUnknown(defaultLocationId)
        : EngagementError.shopEventLocationUnknown(locationId),
    );
  },

  /**
   * The shop an event is at (OR-37, the `/events` line and the admin's
   * picker), from the catalogue's `shops` — `null` for an event at no
   * shop, and for one whose shop is not among them (hidden or deleted:
   * the caller words that). One linear scan; the first shop of the id.
   */
  eventShop<S extends Pick<ShopLocation, 'id'>>(
    event: Pick<ShopEventContent, 'locationId'>,
    shops: readonly S[],
  ): S | null {
    const locationId = event.locationId;
    if (locationId === null) return null;
    for (let i = 0; i < shops.length; i++) {
      const shop = shops[i] as S;
      if (shop.id === locationId) return shop;
    }
    return null;
  },

  /**
   * The shops a role is open at (OR-42, the `/careers` line), of the
   * catalogue's `shops`, in the catalogue's order: those its
   * `locationIds` name. Empty for a role scoped to no shop — open at every
   * shop, naming none of its own (`LocationScopeSystem.serves`) — and an id
   * no listed shop answers (hidden or deleted) is left out. One linear scan
   * of the shops.
   */
  positionShops<S extends Pick<ShopLocation, 'id'>>(
    position: Pick<Position, 'locationIds'>,
    shops: readonly S[],
  ): readonly S[] {
    if (position.locationIds.length === 0) return [];
    const scope = new Set<LocationId>(position.locationIds);
    const out: S[] = [];
    for (let i = 0; i < shops.length; i++) {
      const shop = shops[i] as S;
      if (scope.has(shop.id)) out.push(shop);
    }
    return out;
  },

  /**
   * The event's stored shop that the catalogue's `shops` do not list
   * (OR-37, the admin's picker) — hidden or deleted: the picker keeps it
   * as an extra option and words which. `null` for an event at no shop and
   * for one whose shop is listed ({@link eventShop} finds it). One linear
   * scan of the shops.
   */
  eventUnlistedShop(
    event: Pick<ShopEventContent, 'locationId'>,
    shops: readonly Pick<ShopLocation, 'id'>[],
  ): LocationId | null {
    const locationId = event.locationId;
    if (locationId === null) return null;
    return ProgramsSystem.eventShop(event, shops) === null ? locationId : null;
  },

  /**
   * The role's stored shops that the catalogue's `shops` do not list
   * (OR-42, the admin's chips) — hidden or deleted: the chips keep them as
   * extra choices and word which. In stored order, each once (a stored
   * scope that repeats an id draws one chip). Empty for a role open at
   * every shop (an empty scope) and for one whose every shop is listed
   * ({@link positionShops} names them all). One linear scan of the shops,
   * one of the scope.
   */
  positionUnlistedShops(
    position: Pick<Position, 'locationIds'>,
    shops: readonly Pick<ShopLocation, 'id'>[],
  ): readonly LocationId[] {
    const scope = position.locationIds;
    if (scope.length === 0) return [];
    const listed = new Set<LocationId>();
    for (let i = 0; i < shops.length; i++) {
      listed.add((shops[i] as Pick<ShopLocation, 'id'>).id);
    }
    const out: LocationId[] = [];
    for (let i = 0; i < scope.length; i++) {
      const id = scope[i] as LocationId;
      if (listed.has(id)) continue;
      // Marked as it is taken, so a repeated id is taken once.
      listed.add(id);
      out.push(id);
    }
    return out;
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
      contacts: fields.contacts,
      sortOrder: fields.sortOrder,
    };
  },
} as const;
