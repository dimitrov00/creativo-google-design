import { describe, expect, it, vi } from 'vitest';
import { type Firestore, setDoc } from 'firebase/firestore';
import { firstValueFrom } from 'rxjs';
import { EnrollmentStatus, PositionStatus } from '@core/components';
import type { Course, Position, ShopEvent } from '@core/entities';
import type { EventsQuery } from '@core/ports';
import {
  CourseId,
  EventId,
  LocalDate,
  LocationId,
  PositionId,
  Result,
} from '@core/primitives';
import { RepositoryError } from '@core/errors';
import {
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TODAY,
  at,
  courseOf,
  memoryProgramsPorts,
  memoryProgramsWorld,
  positionOf,
  shopEventOf,
  textFixture,
} from '@core/testing';
import { FakeFirestore } from '../testing/fake-firestore';

vi.mock('firebase/firestore', async () => {
  const fake = (
    await import('../testing/fake-firestore')
  ).fakeFirestoreModule();
  // Watched, not replaced: the spec reads the arguments a save handed over.
  return {
    ...fake,
    setDoc: vi.fn(fake['setDoc'] as (...args: unknown[]) => Promise<void>),
  };
});

const {
  courseReadPorts,
  courseWritePorts,
  positionReadPorts,
  positionWritePorts,
  programsPorts,
  shopEventReadPorts,
  shopEventWritePorts,
} = await import('./programs.adapter');

const asDb = (fake: FakeFirestore) => fake as unknown as Firestore;

/** Everything a stream said, in order. */
function recorded<T>(stream: {
  subscribe: (next: (value: T) => void) => { unsubscribe(): void };
}) {
  const seen: T[] = [];
  const subscription = stream.subscribe((value) => seen.push(value));
  return { seen, stop: () => subscription.unsubscribe() };
}

const idsOf = (answer: Result<readonly { readonly id: string }[], unknown>) =>
  answer.ok ? answer.value.map((entity) => entity.id) : answer;

/** A stored body: the entity minus its id (Law 5). */
function bodyOf(entity: { readonly id: string }): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entity).filter(([key]) => key !== 'id'),
  );
}

/** Each entity at `collection/{id}`, its body exactly as a save would leave it. */
function documentsOf(
  collection: string,
  entities: readonly { readonly id: string }[],
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    entities.map((entity) => [`${collection}/${entity.id}`, bodyOf(entity)]),
  );
}

/** An event on the shop day `days` from `FIXTURE_TODAY`, at 19:00 shop time. */
const eventOn = (
  id: string,
  days: number,
  overrides: Partial<ShopEvent> = {},
) =>
  shopEventOf(id, {
    localDate: LocalDate.addDays(FIXTURE_TODAY, days),
    ...overrides,
  });

const UPCOMING: EventsQuery = { nowUtcMs: FIXTURE_NOW_UTC_MS, upcoming: true };
const PAST: EventsQuery = { nowUtcMs: FIXTURE_NOW_UTC_MS, upcoming: false };

describe('positionReadPorts / positionWritePorts — positions/{id}', () => {
  it('saves the body minus its id with ONE full set (never a merge), and loads it back as { id, ...body }', async () => {
    const fake = new FakeFirestore();
    const ports = positionWritePorts(asDb(fake));
    const role = positionOf('p-1', {
      locationIds: [LocationId.of('loc-center')],
      applyUrl: 'https://example.test/apply',
    });

    const saved = await ports.savePosition(role);
    const loaded = await ports.loadPosition(role.id);

    expect(saved).toEqual(Result.ok(undefined));
    expect(fake.writes).toEqual([
      { kind: 'set', path: 'positions/p-1', data: bodyOf(role) },
    ]);
    expect(vi.mocked(setDoc).mock.lastCall).toHaveLength(2);
    expect(loaded).toEqual(Result.ok(role));
  });

  it('replaces the whole stored document on a save: a field the body lacks is gone', async () => {
    const fake = new FakeFirestore({
      'positions/p-1': { ...bodyOf(positionOf('p-1')), retiredField: 'open' },
    });
    const closed = positionOf('p-1', { positionStatus: PositionStatus.Closed });

    await positionWritePorts(asDb(fake)).savePosition(closed);

    expect(fake.documentAt('positions/p-1')).toEqual(bodyOf(closed));
  });

  it('answers null for an absent role', async () => {
    const loaded = await positionWritePorts(
      asDb(new FakeFirestore()),
    ).loadPosition(PositionId.of('p-nowhere'));

    expect(loaded).toEqual(Result.ok(null));
  });

  it('lists the roles of one status by sortOrder, ties by id — index #12', () => {
    const fake = new FakeFirestore(
      documentsOf('positions', [
        positionOf('p-b', { sortOrder: 1 }),
        positionOf('p-a', { sortOrder: 1 }),
        positionOf('p-first', { sortOrder: 0 }),
        positionOf('p-closed', {
          positionStatus: PositionStatus.Closed,
          sortOrder: 0,
        }),
      ]),
    );

    const open = recorded(
      positionReadPorts(asDb(fake)).observePositions(PositionStatus.Open),
    );

    expect(open.seen.map(idsOf)).toEqual([['p-first', 'p-a', 'p-b']]);
    expect(fake.reads.map((read) => read.constraints)).toEqual([
      ['positionStatus == "OPEN"', 'orderBy sortOrder asc'],
    ]);
  });

  it('lists every role by sortOrder when asked for no status — the admin list, unfiltered', () => {
    const fake = new FakeFirestore(
      documentsOf('positions', [
        positionOf('p-open', { sortOrder: 2 }),
        positionOf('p-closed', {
          positionStatus: PositionStatus.Closed,
          sortOrder: 1,
        }),
      ]),
    );

    const everyRole = recorded(
      positionReadPorts(asDb(fake)).observePositions(null),
    );

    expect(everyRole.seen.map(idsOf)).toEqual([['p-closed', 'p-open']]);
    expect(fake.reads.map((read) => read.constraints)).toEqual([
      ['orderBy sortOrder asc'],
    ]);
  });

  it('answers a stored role AS STORED — no read-side validation (F4-1 (b))', async () => {
    const malformed = {
      title: 'Barber',
      locationIds: ['loc/with/slash'],
      positionStatus: PositionStatus.Open,
      sortOrder: -1.5,
    };
    const fake = new FakeFirestore({
      'positions/p-good': bodyOf(positionOf('p-good')),
      'positions/p-odd': malformed,
    });

    const loaded = await positionWritePorts(asDb(fake)).loadPosition(
      PositionId.of('p-odd'),
    );
    const listed = recorded(
      positionReadPorts(asDb(fake)).observePositions(null),
    );

    expect(loaded).toEqual(Result.ok({ id: 'p-odd', ...malformed }));
    expect(listed.seen).toEqual([
      Result.ok([{ id: 'p-odd', ...malformed }, positionOf('p-good')]),
    ]);
  });

  it('answers a refused save as the port’s RepositoryError, naming the document', async () => {
    const fake = new FakeFirestore().failWith({ code: 'permission-denied' });

    const saved = await positionWritePorts(asDb(fake)).savePosition(
      positionOf('p-1'),
    );

    expect(saved).toEqual(
      Result.err(
        RepositoryError.writeFailed('positions/p-1', 'permission-denied'),
      ),
    );
    expect(fake.documentAt('positions/p-1')).toBeUndefined();
  });
});

describe('courseReadPorts / courseWritePorts — courses/{id}', () => {
  it('saves the body minus its id with one full set, the starts label included, and loads it back', async () => {
    const fake = new FakeFirestore();
    const ports = courseWritePorts(asDb(fake));
    const course = courseOf('c-1', {
      startsLabel: textFixture('Spring 2026', 'Пролет 2026'),
    });

    const saved = await ports.saveCourse(course);
    const loaded = await ports.loadCourse(course.id);

    expect(saved).toEqual(Result.ok(undefined));
    expect(fake.writes).toEqual([
      { kind: 'set', path: 'courses/c-1', data: bodyOf(course) },
    ]);
    expect(vi.mocked(setDoc).mock.lastCall).toHaveLength(2);
    expect(loaded).toEqual(Result.ok(course));
  });

  it('answers null for an absent course', async () => {
    const loaded = await courseWritePorts(asDb(new FakeFirestore())).loadCourse(
      CourseId.of('c-nowhere'),
    );

    expect(loaded).toEqual(Result.ok(null));
  });

  it('lists the courses of the given statuses by sortOrder — index #11, the closed one left out', () => {
    const fake = new FakeFirestore(
      documentsOf('courses', [
        courseOf('c-open', { sortOrder: 2 }),
        courseOf('c-upcoming', {
          enrollmentStatus: EnrollmentStatus.Upcoming,
          sortOrder: 1,
        }),
        courseOf('c-closed', {
          enrollmentStatus: EnrollmentStatus.Closed,
          sortOrder: 0,
        }),
      ]),
    );

    const listed = recorded(
      courseReadPorts(asDb(fake)).observeCourses([
        EnrollmentStatus.Open,
        EnrollmentStatus.Upcoming,
      ]),
    );

    expect(listed.seen.map(idsOf)).toEqual([['c-upcoming', 'c-open']]);
    expect(fake.reads.map((read) => read.constraints)).toEqual([
      ['enrollmentStatus in ["OPEN","UPCOMING"]', 'orderBy sortOrder asc'],
    ]);
  });

  it('lists every course by sortOrder when asked for no status — the admin list, unfiltered', () => {
    const fake = new FakeFirestore(
      documentsOf('courses', [
        courseOf('c-open', { sortOrder: 1 }),
        courseOf('c-closed', {
          enrollmentStatus: EnrollmentStatus.Closed,
          sortOrder: 0,
        }),
      ]),
    );

    const listed = recorded(courseReadPorts(asDb(fake)).observeCourses(null));

    expect(listed.seen.map(idsOf)).toEqual([['c-closed', 'c-open']]);
    expect(fake.reads.map((read) => read.constraints)).toEqual([
      ['orderBy sortOrder asc'],
    ]);
  });

  it('answers no course, and reads nothing, when asked for no status at all (an empty `in`)', () => {
    const fake = new FakeFirestore(
      documentsOf('courses', [courseOf('c-open')]),
    );

    const listed = recorded(courseReadPorts(asDb(fake)).observeCourses([]));

    expect(listed.seen).toEqual([Result.ok([])]);
    expect(fake.reads).toEqual([]);
  });

  it('answers a stored course AS STORED — no read-side validation (F4-1 (b))', async () => {
    const malformed = {
      title: { en: 'Fading', bg: '' },
      enrollmentStatus: EnrollmentStatus.Open,
      startsLabel: { en: 'Spring' },
      sortOrder: 0,
    };
    const fake = new FakeFirestore({ 'courses/c-odd': malformed });

    const loaded = await courseWritePorts(asDb(fake)).loadCourse(
      CourseId.of('c-odd'),
    );
    const listed = recorded(
      courseReadPorts(asDb(fake)).observeCourses([EnrollmentStatus.Open]),
    );

    expect(loaded).toEqual(Result.ok({ id: 'c-odd', ...malformed }));
    expect(listed.seen).toEqual([Result.ok([{ id: 'c-odd', ...malformed }])]);
  });

  it('answers a failed load as the port’s RepositoryError, naming the document', async () => {
    const fake = new FakeFirestore().failWith({ code: 'unavailable' });

    const loaded = await courseWritePorts(asDb(fake)).loadCourse(
      CourseId.of('c-1'),
    );

    expect(loaded).toEqual(
      Result.err(RepositoryError.readFailed('courses/c-1', 'unavailable')),
    );
  });
});

describe('shopEventReadPorts / shopEventWritePorts — events/{id}', () => {
  it('saves the body minus its id with one full set, its shop and wall clock included, and loads it back', async () => {
    const fake = new FakeFirestore();
    const ports = shopEventWritePorts(asDb(fake));
    const event = eventOn('e-1', 7, {
      locationId: LocationId.of('loc-center'),
      applyUrl: 'https://example.test/rsvp',
    });

    const saved = await ports.saveEvent(event);
    const loaded = await ports.loadEvent(event.id);

    expect(saved).toEqual(Result.ok(undefined));
    expect(fake.writes).toEqual([
      { kind: 'set', path: 'events/e-1', data: bodyOf(event) },
    ]);
    // The flat body: the shop wall clock and the one instant, no zone (Law 7.2).
    expect(Object.keys(bodyOf(event)).sort()).toEqual([
      'applyUrl',
      'description',
      'localDate',
      'locationId',
      'sortOrder',
      'startMinutes',
      'title',
      'utcEpochMs',
    ]);
    expect(vi.mocked(setDoc).mock.lastCall).toHaveLength(2);
    expect(loaded).toEqual(Result.ok(event));
  });

  it('answers null for an absent event', async () => {
    const loaded = await shopEventWritePorts(
      asDb(new FakeFirestore()),
    ).loadEvent(EventId.of('e-nowhere'));

    expect(loaded).toEqual(Result.ok(null));
  });

  it('reads the upcoming side: utcEpochMs >= now, soonest first, every one — an event AT now is upcoming (F4-1 (e))', () => {
    const atNow = shopEventOf('e-now', { utcEpochMs: FIXTURE_NOW_UTC_MS });
    const fake = new FakeFirestore(
      documentsOf('events', [
        eventOn('e-later', 14),
        eventOn('e-soon', 1),
        atNow,
        eventOn('e-past', -1),
      ]),
    );

    const upcoming = recorded(
      shopEventReadPorts(asDb(fake)).observeEvents(UPCOMING),
    );

    expect(upcoming.seen.map(idsOf)).toEqual([['e-now', 'e-soon', 'e-later']]);
    expect(fake.reads.map((read) => read.constraints)).toEqual([
      [`utcEpochMs >= ${FIXTURE_NOW_UTC_MS}`, 'orderBy utcEpochMs asc'],
    ]);
  });

  it('reads the past side: utcEpochMs < now, latest first, the latest 24', () => {
    const fake = new FakeFirestore(
      documentsOf('events', [
        eventOn('e-yesterday', -1),
        eventOn('e-last-month', -30),
        eventOn('e-tomorrow', 1),
      ]),
    );

    const past = recorded(shopEventReadPorts(asDb(fake)).observeEvents(PAST));

    expect(past.seen.map(idsOf)).toEqual([['e-yesterday', 'e-last-month']]);
    expect(fake.reads.map((read) => read.constraints)).toEqual([
      [
        `utcEpochMs < ${FIXTURE_NOW_UTC_MS}`,
        'orderBy utcEpochMs desc',
        'limit 24',
      ],
    ]);
  });

  it('breaks a tie on the instant by id in the direction of the order: upcoming id ascending, past id DESCENDING', () => {
    const tomorrow = eventOn('x', 1).utcEpochMs;
    const yesterday = eventOn('x', -1).utcEpochMs;
    const fake = new FakeFirestore(
      documentsOf('events', [
        shopEventOf('e-a', { utcEpochMs: tomorrow }),
        shopEventOf('e-b', { utcEpochMs: tomorrow }),
        eventOn('p-a', -1, { utcEpochMs: yesterday }),
        eventOn('p-b', -1, { utcEpochMs: yesterday }),
      ]),
    );
    const ports = shopEventReadPorts(asDb(fake));

    const upcoming = recorded(ports.observeEvents(UPCOMING));
    const past = recorded(ports.observeEvents(PAST));

    expect(upcoming.seen.map(idsOf)).toEqual([['e-a', 'e-b']]);
    expect(past.seen.map(idsOf)).toEqual([['p-b', 'p-a']]);
  });

  it('caps the past side at 24 of 25, keeping on a tie at the cap the document Firestore keeps', () => {
    const distinct = Array.from({ length: 23 }, (_, i) =>
      eventOn(`past-${String(i + 1).padStart(2, '0')}`, -(i + 1)),
    );
    const capDay = eventOn('cap', -24).utcEpochMs;
    const fake = new FakeFirestore(
      documentsOf('events', [
        ...distinct,
        eventOn('past-24a', -24, { utcEpochMs: capDay }),
        eventOn('past-24b', -24, { utcEpochMs: capDay }),
      ]),
    );

    const past = recorded(shopEventReadPorts(asDb(fake)).observeEvents(PAST));
    const ids = past.seen.map(idsOf)[0] as readonly string[];

    expect(ids).toHaveLength(24);
    expect(ids.slice(0, 2)).toEqual(['past-01', 'past-02']);
    expect(ids.slice(-2)).toEqual(['past-23', 'past-24b']);
    expect(ids).not.toContain('past-24a');
  });

  it('agrees with the memory double of @core/testing on both sides, the cap and the ties included', async () => {
    const tie = eventOn('x', 3).utcEpochMs;
    const events = [
      ...Array.from({ length: 25 }, (_, i) =>
        eventOn(`e-past-${String(i).padStart(2, '0')}`, -(i % 20) - 1),
      ),
      eventOn('e-up-b', 3, { utcEpochMs: tie }),
      eventOn('e-up-a', 3, { utcEpochMs: tie }),
      shopEventOf('e-now', { utcEpochMs: FIXTURE_NOW_UTC_MS }),
    ];
    const firestore = shopEventReadPorts(
      asDb(new FakeFirestore(documentsOf('events', events))),
    );
    const memory = memoryProgramsPorts(memoryProgramsWorld({ events }));

    for (const side of [UPCOMING, PAST]) {
      expect(await firstValueFrom(firestore.observeEvents(side))).toEqual(
        await firstValueFrom(memory.observeEvents(side)),
      );
    }
  });

  it('answers a stored event AS STORED — no read-side validation (F4-1 (b))', async () => {
    const malformed = {
      title: 'Open Chair Day',
      localDate: '2026-02-30',
      startMinutes: 1500,
      utcEpochMs: eventOn('x', 2).utcEpochMs,
      sortOrder: 'first',
    };
    const fake = new FakeFirestore({ 'events/e-odd': malformed });

    const loaded = await shopEventWritePorts(asDb(fake)).loadEvent(
      EventId.of('e-odd'),
    );
    const listed = recorded(
      shopEventReadPorts(asDb(fake)).observeEvents(UPCOMING),
    );

    expect(loaded).toEqual(Result.ok({ id: 'e-odd', ...malformed }));
    expect(listed.seen).toEqual([Result.ok([{ id: 'e-odd', ...malformed }])]);
  });

  it('answers a refused listen as the port’s RepositoryError, naming the collection', () => {
    const fake = new FakeFirestore().failWith({ code: 'permission-denied' });

    const upcoming = recorded(
      shopEventReadPorts(asDb(fake)).observeEvents(UPCOMING),
    );

    expect(upcoming.seen).toEqual([
      Result.err(RepositoryError.readFailed('events', 'permission-denied')),
    ]);
  });
});

describe('programsPorts — PROGRAMS_PORTS, the admin page’s suite', () => {
  it('is exactly the six bundles over one instance: nine members', () => {
    expect(
      Object.keys(programsPorts(asDb(new FakeFirestore()))).sort(),
    ).toEqual([
      'loadCourse',
      'loadEvent',
      'loadPosition',
      'observeCourses',
      'observeEvents',
      'observePositions',
      'saveCourse',
      'saveEvent',
      'savePosition',
    ]);
  });

  it('reads and writes the same documents as the focused bundles', async () => {
    const fake = new FakeFirestore();
    const suite = programsPorts(asDb(fake));
    const role: Position = positionOf('p-1');
    const course: Course = courseOf('c-1');
    const event: ShopEvent = eventOn('e-1', 7, { startMinutes: at(9, 5) });

    await suite.savePosition(role);
    await suite.saveCourse(course);
    await suite.saveEvent(event);

    expect(fake.writes.map((write) => write.path)).toEqual([
      'positions/p-1',
      'courses/c-1',
      'events/e-1',
    ]);
    expect(recorded(suite.observePositions(null)).seen.map(idsOf)).toEqual([
      ['p-1'],
    ]);
    expect(recorded(suite.observeCourses(null)).seen.map(idsOf)).toEqual([
      ['c-1'],
    ]);
    expect(recorded(suite.observeEvents(UPCOMING)).seen).toEqual([
      Result.ok([event]),
    ]);
  });
});
