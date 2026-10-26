import { describe, expect, it } from 'vitest';
import { EnrollmentStatus, PositionStatus } from '@core/components';
import {
  CourseId,
  EventId,
  Locale,
  LocationId,
  PositionId,
  PrimitiveError,
  PrimitiveErrorCode,
  type TimeZone,
} from '@core/primitives';
import {
  CatalogError,
  DateTimeInvalidReason,
  EngagementError,
  EngagementErrorCode,
  TimeError,
} from '@core/errors';
import {
  FIXTURE_TIME_ZONE,
  courseInputOf,
  courseOf,
  deepFreeze,
  localDate,
  locationFixture,
  minute,
  positionInputOf,
  positionOf,
  shopEventInputOf,
  shopEventOf,
  textFixture,
  unwrapErr,
  unwrapOk,
  utcMs,
} from '@core/testing';
import { ProgramsSystem } from './programs.system';
import { ZonedTimeSystem } from './zoned-time.system';

/*
 * The admin programs form, judged (flip 4, F4-5). The cases of the deleted
 * legacy domain specs (`position.spec.ts`, `course.spec.ts`,
 * `shop-event.spec.ts`) live here, case by case, with the departures F4-1
 * (d) and (f) pinned. The zone CONVERSION is not here: the save pipeline
 * owns `ZonedTimeSystem.toUtc` (`program-content.pipeline.spec.ts`).
 */

const POSITION_ID = PositionId.of('position_1');
const COURSE_ID = CourseId.of('course_1');
const EVENT_ID = EventId.of('event_1');
const INSTAGRAM = 'https://instagram.com/creativo.barbershop';

const blankEn = CatalogError.localizedTextFieldEmpty(Locale.En);
const blankBg = CatalogError.localizedTextFieldEmpty(Locale.Bg);

describe('ProgramsSystem.isEnrollmentOpenOrUpcoming', () => {
  // Moved with the rule from `enrollment-status.data.spec.ts` (pass D).
  it('shows an open or an upcoming course, never a closed one', () => {
    expect(
      ProgramsSystem.isEnrollmentOpenOrUpcoming(EnrollmentStatus.Open),
    ).toBe(true);
    expect(
      ProgramsSystem.isEnrollmentOpenOrUpcoming(EnrollmentStatus.Upcoming),
    ).toBe(true);
    expect(
      ProgramsSystem.isEnrollmentOpenOrUpcoming(EnrollmentStatus.Closed),
    ).toBe(false);
  });

  it('is pure: same input → same output', () => {
    expect(
      ProgramsSystem.isEnrollmentOpenOrUpcoming(EnrollmentStatus.Open),
    ).toBe(ProgramsSystem.isEnrollmentOpenOrUpcoming(EnrollmentStatus.Open));
  });
});

describe('ProgramsSystem.position', () => {
  it('accepts a fully valid role', () => {
    const position = unwrapOk(
      ProgramsSystem.position(
        POSITION_ID,
        positionInputOf({
          summary: textFixture(
            'Full-time chair, Center location',
            'Пълен работен ден',
          ),
          locationIds: ['loc_center'],
          applyUrl: INSTAGRAM,
        }),
      ),
    );
    expect(position).toEqual({
      id: POSITION_ID,
      title: { bg: 'Бръснар', en: 'Barber' },
      summary: {
        bg: 'Пълен работен ден',
        en: 'Full-time chair, Center location',
      },
      locationIds: ['loc_center'],
      positionStatus: 'OPEN',
      applyUrl: INSTAGRAM,
      sortOrder: 0,
    });
  });

  it('builds exactly the fixture role from the fixture form', () => {
    expect(
      unwrapOk(ProgramsSystem.position(POSITION_ID, positionInputOf())),
    ).toEqual(positionOf('position_1'));
  });

  it('accepts a blank apply URL as null — empty or spaces', () => {
    for (const applyUrl of ['', '   ']) {
      expect(
        unwrapOk(
          ProgramsSystem.position(POSITION_ID, positionInputOf({ applyUrl })),
        ).applyUrl,
      ).toBeNull();
    }
  });

  it('keeps the apply URL trimmed', () => {
    expect(
      unwrapOk(
        ProgramsSystem.position(
          POSITION_ID,
          positionInputOf({ applyUrl: '  https://x.test  ' }),
        ),
      ).applyUrl,
    ).toBe('https://x.test');
  });

  it('stores every text trimmed', () => {
    const position = unwrapOk(
      ProgramsSystem.position(
        POSITION_ID,
        positionInputOf({
          title: textFixture('  Barber ', ' Бръснар  '),
          summary: textFixture(' Chair ', ' Стол '),
        }),
      ),
    );
    expect(position.title).toEqual({ bg: 'Бръснар', en: 'Barber' });
    expect(position.summary).toEqual({ bg: 'Стол', en: 'Chair' });
  });

  it('keeps the status chip as typed', () => {
    expect(
      unwrapOk(
        ProgramsSystem.position(
          POSITION_ID,
          positionInputOf({ positionStatus: PositionStatus.Closed }),
        ),
      ).positionStatus,
    ).toBe('CLOSED');
  });

  it('rejects a blank localized title field', () => {
    expect(
      unwrapErr(
        ProgramsSystem.position(
          POSITION_ID,
          positionInputOf({ title: textFixture('', 'Бръснар') }),
        ),
      ),
    ).toEqual([blankEn]);
  });

  it('accepts sort order 0 and rejects -1 and 1.5', () => {
    expect(
      unwrapOk(ProgramsSystem.position(POSITION_ID, positionInputOf()))
        .sortOrder,
    ).toBe(0);
    for (const sortOrder of [-1, 1.5]) {
      expect(
        unwrapErr(
          ProgramsSystem.position(POSITION_ID, positionInputOf({ sortOrder })),
        ),
      ).toEqual([
        EngagementError.program(
          EngagementErrorCode.PositionSortOrderInvalid,
          sortOrder,
        ),
      ]);
    }
  });

  it('rejects a malformed apply URL', () => {
    expect(
      unwrapErr(
        ProgramsSystem.position(
          POSITION_ID,
          positionInputOf({ applyUrl: 'not a url' }),
        ),
      ),
    ).toEqual([
      {
        errorCode: 'ENGAGEMENT_POSITION_INVALID_APPLY_URL',
        rawValue: 'not a url',
      },
    ]);
  });

  it('rejects an empty location id in the list', () => {
    expect(
      unwrapErr(
        ProgramsSystem.position(
          POSITION_ID,
          positionInputOf({ locationIds: ['loc_1', ''] }),
        ),
      ),
    ).toEqual([
      PrimitiveError.of(PrimitiveErrorCode.IdEmpty, '', 'LocationId'),
    ]);
  });

  it('rejects a location id holding a "/" (F4-1 (d))', () => {
    expect(
      unwrapErr(
        ProgramsSystem.position(
          POSITION_ID,
          positionInputOf({ locationIds: ['loc/1'] }),
        ),
      ),
    ).toEqual([
      PrimitiveError.of(PrimitiveErrorCode.IdHasSlash, 'loc/1', 'LocationId'),
    ]);
  });

  it('collects every invalid field at once, in the form order', () => {
    expect(
      unwrapErr(
        ProgramsSystem.position(
          POSITION_ID,
          positionInputOf({
            sortOrder: -1,
            title: textFixture('', ''),
            summary: textFixture(' ', 'Стол'),
            locationIds: ['', 'a/b'],
            applyUrl: 'not a url',
          }),
        ),
      ).map((error) => error.errorCode),
    ).toEqual([
      'ENGAGEMENT_POSITION_INVALID_SORT_ORDER',
      'CATALOG_LOCALIZED_TEXT_FIELD_EMPTY',
      'CATALOG_LOCALIZED_TEXT_FIELD_EMPTY',
      'CATALOG_LOCALIZED_TEXT_FIELD_EMPTY',
      'PRIMITIVE_ID_EMPTY',
      'PRIMITIVE_ID_HAS_SLASH',
      'ENGAGEMENT_POSITION_INVALID_APPLY_URL',
    ]);
  });
});

describe('ProgramsSystem.course', () => {
  it('accepts a fully valid course', () => {
    const course = unwrapOk(
      ProgramsSystem.course(
        COURSE_ID,
        courseInputOf({
          startsLabel: textFixture('Spring 2026', 'Пролет 2026'),
          applyUrl: INSTAGRAM,
        }),
      ),
    );
    expect(course).toEqual({
      id: COURSE_ID,
      title: { bg: 'Основи на фейда', en: 'Fundamentals of Fading' },
      description: { bg: 'Шестседмичен курс', en: 'Six-week evening course' },
      enrollmentStatus: 'OPEN',
      startsLabel: { bg: 'Пролет 2026', en: 'Spring 2026' },
      applyUrl: INSTAGRAM,
      sortOrder: 0,
    });
  });

  it('accepts a blank starts label and apply URL as null', () => {
    const course = unwrapOk(
      ProgramsSystem.course(
        COURSE_ID,
        courseInputOf({ startsLabel: textFixture('  ', ''), applyUrl: ' ' }),
      ),
    );
    expect(course.startsLabel).toBeNull();
    expect(course.applyUrl).toBeNull();
    expect(course).toEqual(courseOf('course_1'));
  });

  it('refuses a one-sided starts label', () => {
    expect(
      unwrapErr(
        ProgramsSystem.course(
          COURSE_ID,
          courseInputOf({ startsLabel: textFixture('Spring 2027', ' ') }),
        ),
      ),
    ).toEqual([blankBg]);
  });

  it('keeps the enrollment chip as typed — a closed course stays closed', () => {
    expect(
      unwrapOk(
        ProgramsSystem.course(
          COURSE_ID,
          courseInputOf({ enrollmentStatus: EnrollmentStatus.Closed }),
        ),
      ).enrollmentStatus,
    ).toBe('CLOSED');
  });

  it('rejects a blank localized description field', () => {
    expect(
      unwrapErr(
        ProgramsSystem.course(
          COURSE_ID,
          courseInputOf({ description: textFixture('', 'Курс') }),
        ),
      ),
    ).toEqual([blankEn]);
  });

  it('rejects a negative sort order', () => {
    expect(
      unwrapErr(
        ProgramsSystem.course(COURSE_ID, courseInputOf({ sortOrder: -1 })),
      ),
    ).toEqual([
      EngagementError.program(EngagementErrorCode.CourseSortOrderInvalid, -1),
    ]);
  });

  it('rejects a malformed apply URL', () => {
    expect(
      unwrapErr(
        ProgramsSystem.course(
          COURSE_ID,
          courseInputOf({ applyUrl: 'not a url' }),
        ),
      ),
    ).toEqual([
      EngagementError.program(
        EngagementErrorCode.CourseApplyUrlInvalid,
        'not a url',
      ),
    ]);
  });

  it('collects every invalid field at once, in the form order', () => {
    expect(
      unwrapErr(
        ProgramsSystem.course(
          COURSE_ID,
          courseInputOf({
            sortOrder: 2.5,
            title: textFixture('Fade', ''),
            description: textFixture('', 'Курс'),
            startsLabel: textFixture('', 'Пролет'),
            applyUrl: 'nope',
          }),
        ),
      ),
    ).toEqual([
      EngagementError.program(EngagementErrorCode.CourseSortOrderInvalid, 2.5),
      blankBg,
      blankEn,
      blankEn,
      EngagementError.program(
        EngagementErrorCode.CourseApplyUrlInvalid,
        'nope',
      ),
    ]);
  });
});

describe('ProgramsSystem.eventFields', () => {
  it('reads the wall clock of a valid event, with its location and RSVP link', () => {
    expect(
      unwrapOk(
        ProgramsSystem.eventFields(
          shopEventInputOf({
            startsAt: '2026-11-05T19:00',
            locationId: 'loc_center',
            applyUrl: INSTAGRAM,
          }),
        ),
      ),
    ).toEqual({
      title: { bg: 'Ден на отворените столове', en: 'Open Chair Day' },
      description: {
        bg: 'Подстригвания без резервация',
        en: 'Walk-in trims, no booking needed',
      },
      localDate: '2026-11-05',
      startMinutes: 1140,
      locationId: 'loc_center',
      applyUrl: INSTAGRAM,
      sortOrder: 0,
    });
  });

  it('accepts a blank location and apply URL as null, and trims a typed location', () => {
    const none = unwrapOk(
      ProgramsSystem.eventFields(
        shopEventInputOf({ locationId: '  ', applyUrl: '' }),
      ),
    );
    expect(none.locationId).toBeNull();
    expect(none.applyUrl).toBeNull();
    expect(
      unwrapOk(
        ProgramsSystem.eventFields(
          shopEventInputOf({ locationId: ' loc-mladost ' }),
        ),
      ).locationId,
    ).toBe('loc-mladost');
  });

  it('reads the day’s first and last minutes', () => {
    expect(
      unwrapOk(
        ProgramsSystem.eventFields(
          shopEventInputOf({ startsAt: '2026-11-05T00:00' }),
        ),
      ).startMinutes,
    ).toBe(0);
    expect(
      unwrapOk(
        ProgramsSystem.eventFields(
          shopEventInputOf({ startsAt: '2026-11-05T23:59' }),
        ),
      ).startMinutes,
    ).toBe(1439);
  });

  it('touches no zone: a spring-forward gap time is a valid wall clock here', () => {
    const fields = unwrapOk(
      ProgramsSystem.eventFields(
        shopEventInputOf({ startsAt: '2027-03-28T03:30' }),
      ),
    );
    expect(fields.localDate).toBe('2027-03-28');
    expect(fields.startMinutes).toBe(210);
  });

  it('rejects an invalid start', () => {
    expect(
      unwrapErr(
        ProgramsSystem.eventFields(
          shopEventInputOf({ startsAt: 'not-a-date' }),
        ),
      ),
    ).toEqual([
      TimeError.invalidDateTime('not-a-date', DateTimeInvalidReason.Unparsable),
    ]);
  });

  it('reads only the form the datetime-local input emits (F4-1 (f))', () => {
    for (const startsAt of [
      '2026-11-05T19:00:00',
      '2026-11-05',
      '2026-11-05T19:00+02:00',
      '2026-11-05 19:00',
      ' 2026-11-05T19:00',
      '',
    ]) {
      expect(
        unwrapErr(ProgramsSystem.eventFields(shopEventInputOf({ startsAt }))),
      ).toEqual([
        TimeError.invalidDateTime(startsAt, DateTimeInvalidReason.Unparsable),
      ]);
    }
  });

  it('refuses a well-formed start that is not on the calendar or the clock', () => {
    for (const startsAt of [
      '2026-02-30T10:00',
      '2026-13-01T10:00',
      '2026-11-05T24:00',
      '2026-11-05T10:60',
    ]) {
      expect(
        unwrapErr(ProgramsSystem.eventFields(shopEventInputOf({ startsAt }))),
      ).toEqual([
        TimeError.invalidDateTime(startsAt, DateTimeInvalidReason.OutOfRange),
      ]);
    }
  });

  it('rejects a location id holding a "/" (F4-1 (d))', () => {
    expect(
      unwrapErr(
        ProgramsSystem.eventFields(shopEventInputOf({ locationId: 'loc/x' })),
      ),
    ).toEqual([
      PrimitiveError.of(PrimitiveErrorCode.IdHasSlash, 'loc/x', 'LocationId'),
    ]);
  });

  it('rejects a negative sort order', () => {
    expect(
      unwrapErr(
        ProgramsSystem.eventFields(shopEventInputOf({ sortOrder: -1 })),
      ),
    ).toEqual([
      EngagementError.program(
        EngagementErrorCode.ShopEventSortOrderInvalid,
        -1,
      ),
    ]);
  });

  it('rejects a malformed apply URL', () => {
    expect(
      unwrapErr(
        ProgramsSystem.eventFields(shopEventInputOf({ applyUrl: 'not a url' })),
      ),
    ).toEqual([
      EngagementError.program(
        EngagementErrorCode.ShopEventApplyUrlInvalid,
        'not a url',
      ),
    ]);
  });

  it('collects every invalid field at once — the start first, then the form order', () => {
    expect(
      unwrapErr(
        ProgramsSystem.eventFields({
          title: textFixture('', 'Ден'),
          description: textFixture('Day', ''),
          startsAt: 'soon',
          locationId: 'a/b',
          applyUrl: 'nope',
          sortOrder: -3,
        }),
      ),
    ).toEqual([
      TimeError.invalidDateTime('soon', DateTimeInvalidReason.Unparsable),
      EngagementError.program(
        EngagementErrorCode.ShopEventSortOrderInvalid,
        -3,
      ),
      blankEn,
      blankBg,
      PrimitiveError.of(PrimitiveErrorCode.IdHasSlash, 'a/b', 'LocationId'),
      EngagementError.program(
        EngagementErrorCode.ShopEventApplyUrlInvalid,
        'nope',
      ),
    ]);
  });
});

describe('ProgramsSystem — the event’s zone (F-4, OR-38)', () => {
  const defaultId = LocationId.of('loc-center');
  const fields = unwrapOk(ProgramsSystem.eventFields(shopEventInputOf()));
  const athens = unwrapOk(ZonedTimeSystem.checkZone('Europe/Athens'));
  const mladost = locationFixture({
    id: LocationId.of('loc-mladost'),
    timeZone: athens,
  });
  const center = locationFixture();

  it('reads the event’s own location, else the default shop', () => {
    expect(
      ProgramsSystem.zoneLocationOf(
        { ...fields, locationId: LocationId.of('loc-mladost') },
        defaultId,
      ),
    ).toBe('loc-mladost');
    expect(
      ProgramsSystem.zoneLocationOf({ ...fields, locationId: null }, defaultId),
    ).toBe('loc-center');
  });

  it('places the event on the zone of the one location read: its own shop’s, or — at no shop — the default shop’s', () => {
    expect(
      unwrapOk(
        ProgramsSystem.zoneOf(LocationId.of('loc-mladost'), mladost, defaultId),
      ),
    ).toBe(athens);
    expect(unwrapOk(ProgramsSystem.zoneOf(null, center, defaultId))).toBe(
      FIXTURE_TIME_ZONE,
    );
  });

  // DEP-F28: was «falls back to the default shop’s zone when the typed
  // location names no shop» — an event at a shop that is gone is refused.
  it('refuses an event whose shop is not stored, naming that shop — never the default shop’s clock (OR-38)', () => {
    expect(
      unwrapErr(
        ProgramsSystem.zoneOf(LocationId.of('loc-nowhere'), null, defaultId),
      ),
    ).toEqual({
      errorCode: 'ENGAGEMENT_SHOP_EVENT_LOCATION_UNKNOWN',
      locationId: 'loc-nowhere',
    });
  });

  it('refuses an event at no shop when the default shop is not stored, naming the default shop', () => {
    expect(unwrapErr(ProgramsSystem.zoneOf(null, null, defaultId))).toEqual({
      errorCode: 'ENGAGEMENT_SHOP_EVENT_ZONE_UNKNOWN',
      locationId: 'loc-center',
    });
  });
});

describe('ProgramsSystem.eventShop — the shop an event is at (OR-37)', () => {
  const center = locationFixture();
  const north = locationFixture({ id: LocationId.of('loc-north') });
  const shops = [center, north];
  const at = (locationId: string | null) => ({
    locationId: locationId === null ? null : LocationId.of(locationId),
  });

  it('finds the event’s shop among the listed ones', () => {
    expect(ProgramsSystem.eventShop(at('loc-north'), shops)).toBe(north);
    expect(ProgramsSystem.eventShop(shopEventOf('evt-1'), shops)).toBeNull();
  });

  it('answers nothing for an event at no shop, for a shop not listed (hidden or deleted), and over no shops', () => {
    expect(ProgramsSystem.eventShop(at(null), shops)).toBeNull();
    expect(ProgramsSystem.eventShop(at('loc-gone'), shops)).toBeNull();
    expect(ProgramsSystem.eventShop(at('loc-center'), [])).toBeNull();
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const frozen = deepFreeze([center, north]);
    expect(ProgramsSystem.eventShop(at('loc-center'), frozen)).toEqual(
      ProgramsSystem.eventShop(at('loc-center'), frozen),
    );
    expect(frozen).toHaveLength(2);
  });
});

describe('ProgramsSystem.positionShops — the shops a role is open at (OR-42)', () => {
  const center = locationFixture();
  const north = locationFixture({ id: LocationId.of('loc-north') });
  const south = locationFixture({ id: LocationId.of('loc-south') });
  const shops = [center, north, south];
  const scoped = (...ids: string[]) => ({
    locationIds: ids.map((id) => LocationId.of(id)),
  });

  it('names the listed shops the role’s scope holds, in the catalogue’s order', () => {
    expect(
      ProgramsSystem.positionShops(scoped('loc-south', 'loc-center'), shops),
    ).toEqual([center, south]);
  });

  it('names none for a role open at every shop — an empty scope — and leaves out a shop not listed', () => {
    expect(ProgramsSystem.positionShops(scoped(), shops)).toEqual([]);
    expect(
      ProgramsSystem.positionShops(scoped('loc-gone', 'loc-north'), shops),
    ).toEqual([north]);
    expect(ProgramsSystem.positionShops(scoped('loc-center'), [])).toEqual([]);
  });

  it('reads a whole role as it is (Law 3)', () => {
    expect(
      ProgramsSystem.positionShops(
        positionOf('pos-1', { locationIds: [LocationId.of('loc-north')] }),
        shops,
      ),
    ).toEqual([north]);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const role = deepFreeze(scoped('loc-north', 'loc-center'));
    const frozen = deepFreeze([center, north]);
    expect(ProgramsSystem.positionShops(role, frozen)).toEqual(
      ProgramsSystem.positionShops(role, frozen),
    );
    expect(role.locationIds).toEqual(['loc-north', 'loc-center']);
  });
});

describe('ProgramsSystem.eventUnlistedShop — the event’s stored shop the list does not hold (OR-37)', () => {
  const center = locationFixture();
  const north = locationFixture({ id: LocationId.of('loc-north') });
  const shops = [center, north];
  const at = (locationId: string | null) => ({
    locationId: locationId === null ? null : LocationId.of(locationId),
  });

  it('answers the stored shop no listed shop answers (hidden or deleted), over no shops too', () => {
    expect(ProgramsSystem.eventUnlistedShop(at('loc-gone'), shops)).toBe(
      'loc-gone',
    );
    expect(ProgramsSystem.eventUnlistedShop(at('loc-center'), [])).toBe(
      'loc-center',
    );
  });

  it('answers nothing for an event at no shop, and for one whose shop is listed', () => {
    expect(ProgramsSystem.eventUnlistedShop(at(null), shops)).toBeNull();
    expect(ProgramsSystem.eventUnlistedShop(at('loc-north'), shops)).toBeNull();
    expect(ProgramsSystem.eventUnlistedShop(at(null), [])).toBeNull();
  });

  it('reads a whole event as it is (Law 3)', () => {
    expect(
      ProgramsSystem.eventUnlistedShop(shopEventOf('evt-1'), shops),
    ).toBeNull();
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const event = deepFreeze(at('loc-gone'));
    const frozen = deepFreeze([center, north]);
    expect(ProgramsSystem.eventUnlistedShop(event, frozen)).toBe(
      ProgramsSystem.eventUnlistedShop(event, frozen),
    );
    expect(event.locationId).toBe('loc-gone');
    expect(frozen).toHaveLength(2);
  });
});

describe('ProgramsSystem.positionUnlistedShops — the role’s stored shops the list does not hold (OR-42)', () => {
  const center = locationFixture();
  const north = locationFixture({ id: LocationId.of('loc-north') });
  const shops = [center, north];
  const scoped = (...ids: string[]) => ({
    locationIds: ids.map((id) => LocationId.of(id)),
  });

  it('names the stored shops no listed shop answers, in stored order', () => {
    expect(
      ProgramsSystem.positionUnlistedShops(
        scoped('loc-west', 'loc-north', 'loc-east', 'loc-center'),
        shops,
      ),
    ).toEqual(['loc-west', 'loc-east']);
    expect(
      ProgramsSystem.positionUnlistedShops(scoped('loc-north', 'loc-a'), []),
    ).toEqual(['loc-north', 'loc-a']);
  });

  it('names none for a role open at every shop — an empty scope — and none when every stored shop is listed', () => {
    expect(ProgramsSystem.positionUnlistedShops(scoped(), shops)).toEqual([]);
    expect(ProgramsSystem.positionUnlistedShops(scoped(), [])).toEqual([]);
    expect(
      ProgramsSystem.positionUnlistedShops(
        scoped('loc-north', 'loc-center'),
        shops,
      ),
    ).toEqual([]);
  });

  it('names a repeated stored id once, where it first stands', () => {
    expect(
      ProgramsSystem.positionUnlistedShops(
        scoped('loc-gone', 'loc-center', 'loc-west', 'loc-gone', 'loc-center'),
        shops,
      ),
    ).toEqual(['loc-gone', 'loc-west']);
  });

  it('reads a whole role as it is (Law 3)', () => {
    expect(
      ProgramsSystem.positionUnlistedShops(
        positionOf('pos-1', {
          locationIds: [LocationId.of('loc-north'), LocationId.of('loc-gone')],
        }),
        shops,
      ),
    ).toEqual(['loc-gone']);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const role = deepFreeze(scoped('loc-gone', 'loc-center', 'loc-gone'));
    const frozen = deepFreeze([center, north]);
    expect(ProgramsSystem.positionUnlistedShops(role, frozen)).toEqual(
      ProgramsSystem.positionUnlistedShops(role, frozen),
    );
    expect(role.locationIds).toEqual(['loc-gone', 'loc-center', 'loc-gone']);
    expect(frozen).toHaveLength(2);
  });
});

describe('ProgramsSystem.shopEvent', () => {
  it('assembles exactly the given instant — the fixture event from the fixture form', () => {
    const fields = unwrapOk(ProgramsSystem.eventFields(shopEventInputOf()));
    const instant = utcMs('2026-10-05T19:00:00.000+03:00');
    const event = ProgramsSystem.shopEvent(EVENT_ID, fields, instant);
    expect(event.utcEpochMs).toBe(instant);
    expect(event).toEqual(shopEventOf('event_1'));
  });

  it('copies only the content fields — a wider struct leaks nothing', () => {
    const wider = { ...shopEventOf('other'), stray: true };
    const event = ProgramsSystem.shopEvent(
      EVENT_ID,
      wider,
      utcMs('2026-10-05T16:00:00.000Z'),
    );
    expect(Object.keys(event)).toEqual([
      'id',
      'title',
      'description',
      'localDate',
      'startMinutes',
      'utcEpochMs',
      'locationId',
      'applyUrl',
      'sortOrder',
    ]);
    expect(event.id).toBe('event_1');
  });

  it('never converts zones itself: the instant is whatever the boundary computed', () => {
    const fields = {
      ...unwrapOk(ProgramsSystem.eventFields(shopEventInputOf())),
      localDate: localDate('2026-10-25'),
      startMinutes: minute(210),
    };
    const anyInstant = utcMs('2000-01-01T00:00:00.000Z');
    expect(
      ProgramsSystem.shopEvent(EVENT_ID, fields, anyInstant).utcEpochMs,
    ).toBe(anyInstant);
  });
});

describe('ProgramsSystem — purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const positionInput = deepFreeze(
      positionInputOf({
        locationIds: ['loc-center'],
        applyUrl: ' https://x.test ',
      }),
    );
    const courseInput = deepFreeze(
      courseInputOf({ startsLabel: textFixture('Spring', 'Пролет') }),
    );
    const eventInput = deepFreeze(shopEventInputOf({ locationId: ' loc-x ' }));
    const named = deepFreeze(locationFixture());
    const zone: TimeZone = FIXTURE_TIME_ZONE;

    const once = [
      ProgramsSystem.position(POSITION_ID, positionInput),
      ProgramsSystem.course(COURSE_ID, courseInput),
      ProgramsSystem.eventFields(eventInput),
      ProgramsSystem.zoneOf(null, named, LocationId.of('loc-center')),
    ];
    const twice = [
      ProgramsSystem.position(POSITION_ID, positionInput),
      ProgramsSystem.course(COURSE_ID, courseInput),
      ProgramsSystem.eventFields(eventInput),
      ProgramsSystem.zoneOf(null, named, LocationId.of('loc-center')),
    ];
    expect(twice).toEqual(once);
    expect(unwrapOk(once[3] as ReturnType<typeof ProgramsSystem.zoneOf>)).toBe(
      zone,
    );
    expect(positionInput.applyUrl).toBe(' https://x.test ');
    expect(eventInput.locationId).toBe(' loc-x ');
  });
});
