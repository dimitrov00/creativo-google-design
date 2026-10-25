import { describe, expect, it } from 'vitest';
import { EnrollmentStatus, PositionStatus } from '@core/components';
import {
  CourseId,
  EventId,
  Locale,
  LocationId,
  PositionId,
  Result,
} from '@core/primitives';
import {
  CatalogError,
  DateTimeInvalidReason,
  EngagementError,
  EngagementErrorCode,
  RepositoryError,
  TimeError,
} from '@core/errors';
import type { LocationLoadPorts } from '@core/ports';
import { ZonedTimeSystem } from '@core/systems';
import {
  FIXTURE_TIME_ZONE,
  type ProgramsWorld,
  courseInputOf,
  courseOf,
  localDate,
  locationFixture,
  memoryDefaultLocationPorts,
  memoryIdPorts,
  memoryLocationLoadPorts,
  memoryProgramsPorts,
  memoryProgramsWorld,
  minute,
  positionInputOf,
  positionOf,
  shopEventInputOf,
  shopEventOf,
  textFixture,
  unwrapErr,
  unwrapOk,
  utcMs,
  offsetIso,
} from '@core/testing';
import {
  type WriteShopEventPorts,
  writeCourse,
  writePosition,
  writeShopEvent,
} from './program-content.pipeline';

/*
 * The admin programs saves (flip 4, F4-3). The cases of the deleted legacy
 * use-case specs (`create-position`, `update-position`, `create-course`,
 * `create-shop-event`) live here, case by case; every case asserts the
 * saved body (the full entity), the refusal list, and that NOTHING was
 * saved after a refusal. The zone CONVERSION pins live here too — this
 * pipeline is the event's ingestion boundary (Law 7.3): the Sofia gap and
 * repeat, the default-shop fallback and both refusals (F4-1 (a), (c)).
 */

const CENTER = LocationId.of('loc-center');

/** A world holding the centre shop (`Europe/Sofia`) — the seed's default shop. */
function worldWithCenter(): ProgramsWorld {
  return memoryProgramsWorld({ locations: [locationFixture()] });
}

/** The ids every location read asked for, in order. */
function recordingLocations(world: ProgramsWorld): {
  readonly ports: LocationLoadPorts;
  readonly reads: LocationId[];
} {
  const reads: LocationId[] = [];
  const inner = memoryLocationLoadPorts(world);
  return {
    reads,
    ports: {
      loadLocation: (id) => {
        reads.push(id);
        return inner.loadLocation(id);
      },
    },
  };
}

function eventPorts(
  world: ProgramsWorld,
  locations: LocationLoadPorts = memoryLocationLoadPorts(world),
): WriteShopEventPorts {
  return {
    ...memoryProgramsPorts(world),
    ...locations,
    ...memoryDefaultLocationPorts(),
    ...memoryIdPorts('evt'),
  };
}

const failedRead = RepositoryError.readFailed('locations/loc-center', 'down');
const failedWrite = RepositoryError.writeFailed('positions/pos-1', 'down');

describe('writePosition', () => {
  it('creates and saves an open position under a fresh id', async () => {
    const world = memoryProgramsWorld();
    const save = writePosition({
      ...memoryProgramsPorts(world),
      ...memoryIdPorts('pos'),
    });

    const saved = unwrapOk(
      await save({
        id: null,
        input: positionInputOf({
          title: textFixture(' Barber ', 'Бръснар'),
          applyUrl: '  https://example.test/apply ',
        }),
      }),
    );

    const expected = positionOf('pos-1', {
      applyUrl: 'https://example.test/apply',
    });
    expect(saved).toEqual(expected);
    expect([...world.positions.values()]).toEqual([expected]);
  });

  it('rejects a blank title and saves nothing — the refused create spends its id', async () => {
    const world = memoryProgramsWorld();
    const save = writePosition({
      ...memoryProgramsPorts(world),
      ...memoryIdPorts('pos'),
    });

    expect(
      unwrapErr(
        await save({
          id: null,
          input: positionInputOf({ title: textFixture('', 'Бръснар') }),
        }),
      ),
    ).toEqual([CatalogError.localizedTextFieldEmpty(Locale.En)]);
    expect(world.positions.size).toBe(0);

    expect(
      unwrapOk(await save({ id: null, input: positionInputOf() })).id,
    ).toBe('pos-2');
  });

  it('closes an existing position — the full body replaced, its locations wiped as the page sends none (F4-8)', async () => {
    const stored = positionOf('pos_1', {
      locationIds: [CENTER],
      applyUrl: 'https://old.test',
    });
    const world = memoryProgramsWorld({ positions: [stored] });
    const save = writePosition({
      ...memoryProgramsPorts(world),
      ...memoryIdPorts('pos'),
    });

    const saved = unwrapOk(
      await save({
        id: stored.id,
        input: positionInputOf({ positionStatus: PositionStatus.Closed }),
      }),
    );

    const expected = positionOf('pos_1', {
      positionStatus: PositionStatus.Closed,
    });
    expect(saved).toEqual(expected);
    expect(world.positions.get(stored.id)).toEqual(expected);
    expect(world.positions.size).toBe(1);
  });

  it('refuses a missing position as ENGAGEMENT_POSITION_NOT_FOUND before judging the form, and saves nothing', async () => {
    const world = memoryProgramsWorld();
    const save = writePosition({
      ...memoryProgramsPorts(world),
      ...memoryIdPorts('pos'),
    });
    const missing = PositionId.of('pos_missing');

    expect(
      unwrapErr(
        await save({
          id: missing,
          input: positionInputOf({ title: textFixture('', '') }),
        }),
      ),
    ).toEqual([
      EngagementError.programNotFound(
        EngagementErrorCode.PositionNotFound,
        missing,
      ),
    ]);
    expect(world.positions.size).toBe(0);
  });

  it('answers the store’s failure to read or to write', async () => {
    const stored = positionOf('pos-1');
    const world = memoryProgramsWorld({ positions: [stored] });
    const unreadable = writePosition({
      ...memoryProgramsPorts(world),
      ...memoryIdPorts('pos'),
      loadPosition: async () => Result.err(failedRead),
    });
    expect(
      unwrapErr(await unreadable({ id: stored.id, input: positionInputOf() })),
    ).toEqual([failedRead]);

    const unwritable = writePosition({
      ...memoryProgramsPorts(world),
      ...memoryIdPorts('pos'),
      savePosition: async () => Result.err(failedWrite),
    });
    expect(
      unwrapErr(await unwritable({ id: null, input: positionInputOf() })),
    ).toEqual([failedWrite]);
    expect([...world.positions.values()]).toEqual([stored]);
  });
});

describe('writeCourse', () => {
  it('creates and saves an open course', async () => {
    const world = memoryProgramsWorld();
    const save = writeCourse({
      ...memoryProgramsPorts(world),
      ...memoryIdPorts('course'),
    });

    const saved = unwrapOk(
      await save({
        id: null,
        input: courseInputOf({
          startsLabel: textFixture('Spring 2027', 'Пролет 2027'),
        }),
      }),
    );

    const expected = courseOf('course-1', {
      startsLabel: textFixture('Spring 2027', 'Пролет 2027'),
    });
    expect(saved).toEqual(expected);
    expect(world.courses.get(CourseId.of('course-1'))).toEqual(expected);
  });

  it('rejects a blank description and saves nothing', async () => {
    const world = memoryProgramsWorld();
    const save = writeCourse({
      ...memoryProgramsPorts(world),
      ...memoryIdPorts('course'),
    });

    expect(
      unwrapErr(
        await save({
          id: null,
          input: courseInputOf({ description: textFixture('', '') }),
        }),
      ),
    ).toEqual([
      CatalogError.localizedTextFieldEmpty(Locale.En),
      CatalogError.localizedTextFieldEmpty(Locale.Bg),
    ]);
    expect(world.courses.size).toBe(0);
  });

  it('refuses a one-sided starts label and saves nothing', async () => {
    const world = memoryProgramsWorld();
    const save = writeCourse({
      ...memoryProgramsPorts(world),
      ...memoryIdPorts('course'),
    });

    expect(
      unwrapErr(
        await save({
          id: null,
          input: courseInputOf({ startsLabel: textFixture('Spring 2027', '') }),
        }),
      ),
    ).toEqual([CatalogError.localizedTextFieldEmpty(Locale.Bg)]);
    expect(world.courses.size).toBe(0);
  });

  it('updates an existing course in place', async () => {
    const stored = courseOf('course_1');
    const world = memoryProgramsWorld({ courses: [stored] });
    const save = writeCourse({
      ...memoryProgramsPorts(world),
      ...memoryIdPorts('course'),
    });

    unwrapOk(
      await save({
        id: stored.id,
        input: courseInputOf({ enrollmentStatus: EnrollmentStatus.Upcoming }),
      }),
    );

    expect([...world.courses.values()]).toEqual([
      courseOf('course_1', { enrollmentStatus: EnrollmentStatus.Upcoming }),
    ]);
  });

  it('refuses a missing course as ENGAGEMENT_COURSE_NOT_FOUND and saves nothing', async () => {
    const world = memoryProgramsWorld();
    const save = writeCourse({
      ...memoryProgramsPorts(world),
      ...memoryIdPorts('course'),
    });
    const missing = CourseId.of('course_missing');

    expect(
      unwrapErr(await save({ id: missing, input: courseInputOf() })),
    ).toEqual([
      EngagementError.programNotFound(
        EngagementErrorCode.CourseNotFound,
        missing,
      ),
    ]);
    expect(world.courses.size).toBe(0);
  });

  it('answers the store’s failure to write, the world untouched', async () => {
    const world = memoryProgramsWorld();
    const save = writeCourse({
      ...memoryProgramsPorts(world),
      ...memoryIdPorts('course'),
      saveCourse: async () => Result.err(failedWrite),
    });

    expect(unwrapErr(await save({ id: null, input: courseInputOf() }))).toEqual(
      [failedWrite],
    );
    expect(world.courses.size).toBe(0);
  });
});

describe('writeShopEvent', () => {
  it('creates and saves an event at no shop, on the default shop’s clock', async () => {
    const world = worldWithCenter();
    const { ports, reads } = recordingLocations(world);
    const save = writeShopEvent(eventPorts(world, ports));

    const saved = unwrapOk(
      await save({
        id: null,
        input: shopEventInputOf({ startsAt: '2026-11-05T19:00' }),
      }),
    );

    const expected = shopEventOf('evt-1', {
      localDate: localDate('2026-11-05'),
      startMinutes: minute(1140),
      utcEpochMs: utcMs('2026-11-05T19:00:00.000+02:00'),
    });
    expect(saved).toEqual(expected);
    expect(world.events.get(EventId.of('evt-1'))).toEqual(expected);
    expect(reads).toEqual([CENTER]);
  });

  it('rejects an invalid start and saves nothing — no location is read', async () => {
    const world = worldWithCenter();
    const { ports, reads } = recordingLocations(world);
    const save = writeShopEvent(eventPorts(world, ports));

    expect(
      unwrapErr(
        await save({
          id: null,
          input: shopEventInputOf({ startsAt: 'not-a-date' }),
        }),
      ),
    ).toEqual([
      TimeError.invalidDateTime('not-a-date', DateTimeInvalidReason.Unparsable),
    ]);
    expect(world.events.size).toBe(0);
    expect(reads).toEqual([]);
  });

  it('refuses a spring-forward gap time with DST_GAP_INVALID_TIME and saves nothing (F4-1 (a))', async () => {
    const world = worldWithCenter();
    const save = writeShopEvent(eventPorts(world));

    expect(
      unwrapErr(
        await save({
          id: null,
          input: shopEventInputOf({ startsAt: '2027-03-28T03:30' }),
        }),
      ),
    ).toEqual([
      TimeError.dstGap(localDate('2027-03-28'), minute(210), FIXTURE_TIME_ZONE),
    ]);
    expect(world.events.size).toBe(0);
  });

  it('resolves a fall-back repeat time to the EARLIER offset (+03:00)', async () => {
    const world = worldWithCenter();
    const save = writeShopEvent(eventPorts(world));

    const saved = unwrapOk(
      await save({
        id: null,
        input: shopEventInputOf({ startsAt: '2026-10-25T03:30' }),
      }),
    );

    expect(saved.utcEpochMs).toBe(utcMs('2026-10-25T03:30:00.000+03:00'));
    expect(offsetIso(saved.utcEpochMs, FIXTURE_TIME_ZONE)).toMatch(
      /^2026-10-25T03:30:00(\.000)?\+03:00$/,
    );
    expect(world.events.get(saved.id)).toEqual(saved);
  });

  it('places an event at a named shop on that shop’s zone, and stores the id as typed', async () => {
    const athens = unwrapOk(ZonedTimeSystem.checkZone('Europe/Athens'));
    const world = memoryProgramsWorld({
      locations: [
        locationFixture(),
        locationFixture({ id: LocationId.of('loc-north'), timeZone: athens }),
      ],
    });
    const { ports, reads } = recordingLocations(world);
    const save = writeShopEvent(eventPorts(world, ports));

    const saved = unwrapOk(
      await save({
        id: null,
        input: shopEventInputOf({
          startsAt: '2026-11-05T19:00',
          locationId: ' loc-north ',
        }),
      }),
    );

    expect(saved.locationId).toBe('loc-north');
    expect(saved.utcEpochMs).toBe(utcMs('2026-11-05T19:00:00.000+02:00'));
    expect(reads).toEqual([LocationId.of('loc-north')]);
  });

  it('saves a typed location that names no shop on the default shop’s zone (F4-1 (c))', async () => {
    const world = worldWithCenter();
    const { ports, reads } = recordingLocations(world);
    const save = writeShopEvent(eventPorts(world, ports));

    const saved = unwrapOk(
      await save({
        id: null,
        input: shopEventInputOf({
          startsAt: '2026-11-05T19:00',
          locationId: 'loc-nowhere',
        }),
      }),
    );

    expect(saved.locationId).toBe('loc-nowhere');
    expect(saved.utcEpochMs).toBe(utcMs('2026-11-05T19:00:00.000+02:00'));
    expect(world.events.get(saved.id)).toEqual(saved);
    expect(reads).toEqual([LocationId.of('loc-nowhere'), CENTER]);
  });

  it('refuses ENGAGEMENT_SHOP_EVENT_ZONE_UNKNOWN when the default shop is absent, and saves nothing', async () => {
    const world = memoryProgramsWorld();
    const { ports, reads } = recordingLocations(world);
    const save = writeShopEvent(eventPorts(world, ports));

    expect(
      unwrapErr(await save({ id: null, input: shopEventInputOf() })),
    ).toEqual([EngagementError.shopEventZoneUnknown(CENTER)]);
    expect(reads).toEqual([CENTER]);

    expect(
      unwrapErr(
        await save({
          id: null,
          input: shopEventInputOf({ locationId: 'loc-nowhere' }),
        }),
      ),
    ).toEqual([EngagementError.shopEventZoneUnknown(CENTER)]);
    expect(world.events.size).toBe(0);
  });

  it('answers a failed location read with that RepositoryError, and saves nothing', async () => {
    const world = worldWithCenter();
    const save = writeShopEvent({
      ...eventPorts(world),
      loadLocation: async () => Result.err(failedRead),
    });

    expect(
      unwrapErr(await save({ id: null, input: shopEventInputOf() })),
    ).toEqual([failedRead]);
    expect(world.events.size).toBe(0);
  });

  it('answers a failed fallback read with that RepositoryError, and saves nothing', async () => {
    const world = worldWithCenter();
    const inner = memoryLocationLoadPorts(world);
    const save = writeShopEvent({
      ...eventPorts(world),
      loadLocation: async (id) =>
        id === CENTER ? Result.err(failedRead) : inner.loadLocation(id),
    });

    expect(
      unwrapErr(
        await save({
          id: null,
          input: shopEventInputOf({ locationId: 'loc-nowhere' }),
        }),
      ),
    ).toEqual([failedRead]);
    expect(world.events.size).toBe(0);
  });

  it('updates an existing event in place, re-placing its instant', async () => {
    const stored = shopEventOf('evt_1');
    const world = memoryProgramsWorld({
      events: [stored],
      locations: [locationFixture()],
    });
    const save = writeShopEvent(eventPorts(world));

    unwrapOk(
      await save({
        id: stored.id,
        input: shopEventInputOf({ startsAt: '2026-11-05T09:05' }),
      }),
    );

    expect([...world.events.values()]).toEqual([
      shopEventOf('evt_1', {
        localDate: localDate('2026-11-05'),
        startMinutes: minute(545),
        utcEpochMs: utcMs('2026-11-05T09:05:00.000+02:00'),
      }),
    ]);
  });

  it('refuses a missing event as ENGAGEMENT_SHOP_EVENT_NOT_FOUND — nothing judged, read or saved', async () => {
    const world = worldWithCenter();
    const { ports, reads } = recordingLocations(world);
    const save = writeShopEvent(eventPorts(world, ports));
    const missing = EventId.of('evt_missing');

    expect(
      unwrapErr(
        await save({
          id: missing,
          input: shopEventInputOf({ startsAt: 'not-a-date' }),
        }),
      ),
    ).toEqual([
      EngagementError.programNotFound(
        EngagementErrorCode.ShopEventNotFound,
        missing,
      ),
    ]);
    expect(reads).toEqual([]);
    expect(world.events.size).toBe(0);
  });

  it('answers the store’s failure to write, the world untouched', async () => {
    const world = worldWithCenter();
    const save = writeShopEvent({
      ...eventPorts(world),
      saveEvent: async () => Result.err(failedWrite),
    });

    expect(
      unwrapErr(await save({ id: null, input: shopEventInputOf() })),
    ).toEqual([failedWrite]);
    expect(world.events.size).toBe(0);
  });
});
