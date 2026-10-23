import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { firstValueFrom } from 'rxjs';
import { EnrollmentStatus, PositionStatus } from '@core/components';
import type { Course, Position, ShopEvent } from '@core/entities';
import type { EventsQuery } from '@core/ports';
import { LocalDate, LocationId, PositionId, Result } from '@core/primitives';
import { RepositoryErrorCode } from '@core/errors';
import {
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TODAY,
  courseOf,
  memoryProgramsPorts,
  memoryProgramsWorld,
  positionOf,
  shopEventOf,
  textFixture,
} from '@core/testing';
import {
  createEmulatorTestEnv,
  modularFirestore,
} from '../testing/emulator-test-env';
import { programsPorts } from './programs.adapter';

/** A stored body: the entity minus its id (Law 5). */
function bodyOf(entity: { readonly id: string }): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entity).filter(([key]) => key !== 'id'),
  );
}

/** An event on the shop day `days` from `FIXTURE_TODAY`, at 19:00 shop time. */
const eventOn = (
  id: string,
  days: number,
  overrides: Partial<ShopEvent> = {},
): ShopEvent =>
  shopEventOf(id, {
    localDate: LocalDate.addDays(FIXTURE_TODAY, days),
    ...overrides,
  });

const UPCOMING: EventsQuery = { nowUtcMs: FIXTURE_NOW_UTC_MS, upcoming: true };
const PAST: EventsQuery = { nowUtcMs: FIXTURE_NOW_UTC_MS, upcoming: false };

const POSITIONS: readonly Position[] = [
  positionOf('p-b', { sortOrder: 1 }),
  positionOf('p-a', { sortOrder: 1 }),
  positionOf('p-first', {
    sortOrder: 0,
    locationIds: [LocationId.of('loc-center')],
    applyUrl: 'https://example.test/apply',
  }),
  positionOf('p-closed', {
    positionStatus: PositionStatus.Closed,
    sortOrder: 0,
  }),
];

const COURSES: readonly Course[] = [
  courseOf('c-open', {
    sortOrder: 2,
    startsLabel: textFixture('Spring 2027', 'Пролет 2027'),
  }),
  courseOf('c-upcoming', {
    enrollmentStatus: EnrollmentStatus.Upcoming,
    sortOrder: 1,
  }),
  courseOf('c-closed', {
    enrollmentStatus: EnrollmentStatus.Closed,
    sortOrder: 0,
  }),
];

/** The instant both tied upcoming events share — three shop days ahead. */
const UPCOMING_TIE = eventOn('tie', 3).utcEpochMs;
/** The instant the 24th and 25th past events share — 24 shop days back. */
const CAP_TIE = eventOn('cap', -24).utcEpochMs;
/** The instant the two tied past events inside the cap share — yesterday. */
const PAST_TIE = eventOn('tie', -1).utcEpochMs;

/**
 * 25 past events (yesterday's two tied, the 24th and 25th tied at the cap),
 * an event AT now (upcoming: `>=`), two upcoming events tied on their
 * instant, and a later one.
 */
const EVENTS: readonly ShopEvent[] = [
  eventOn('past-01b', -1, { utcEpochMs: PAST_TIE }),
  eventOn('past-01a', -1, { utcEpochMs: PAST_TIE }),
  ...Array.from({ length: 21 }, (_, i) =>
    eventOn(`past-${String(i + 2).padStart(2, '0')}`, -(i + 2)),
  ),
  eventOn('past-24a', -24, { utcEpochMs: CAP_TIE }),
  eventOn('past-24b', -24, { utcEpochMs: CAP_TIE }),
  shopEventOf('up-now', { utcEpochMs: FIXTURE_NOW_UTC_MS }),
  eventOn('up-tie-b', 3, { utcEpochMs: UPCOMING_TIE }),
  eventOn('up-tie-a', 3, { utcEpochMs: UPCOMING_TIE }),
  eventOn('up-later', 30, { locationId: LocationId.of('loc-mladost') }),
];

const ids = (answer: Result<readonly { readonly id: string }[], unknown>) =>
  answer.ok ? answer.value.map((entity) => entity.id) : answer;

describe('programsPorts (emulator)', () => {
  let testEnv: RulesTestEnvironment;

  const anonymous = () =>
    programsPorts(modularFirestore(testEnv.unauthenticatedContext()));
  const catalogueManager = () =>
    programsPorts(
      modularFirestore(
        testEnv.authenticatedContext('copy-1', { roles: ['content_manager'] }),
      ),
    );

  beforeAll(async () => {
    testEnv = await createEmulatorTestEnv('demo-firestore-programs');
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = modularFirestore(ctx);
      const seeded: ReadonlyArray<
        readonly [string, readonly { readonly id: string }[]]
      > = [
        ['positions', POSITIONS],
        ['courses', COURSES],
        ['events', EVENTS],
      ];
      for (const [collection, entities] of seeded) {
        for (const entity of entities) {
          await setDoc(doc(db, collection, entity.id), bodyOf(entity));
        }
      }
    });
  });

  it('lets an anonymous visitor read the open roles by sortOrder, ties by id — index #12, the body as stored', async () => {
    const open = await firstValueFrom(
      anonymous().observePositions(PositionStatus.Open),
    );

    expect(ids(open)).toEqual(['p-first', 'p-a', 'p-b']);
    expect(open.ok && open.value[0]).toEqual(POSITIONS[2]);
  });

  it('lists every role by sortOrder when asked for no status — the admin list', async () => {
    const everyRole = await firstValueFrom(anonymous().observePositions(null));

    expect(ids(everyRole)).toEqual(['p-closed', 'p-first', 'p-a', 'p-b']);
  });

  it('lists the open and upcoming courses by sortOrder — index #11 — and every course when asked for none', async () => {
    const listed = await firstValueFrom(
      anonymous().observeCourses([
        EnrollmentStatus.Open,
        EnrollmentStatus.Upcoming,
      ]),
    );
    // A fresh client per read: on one client the unfiltered listener's FIRST
    // snapshot is the local cache (`fromCache`) — the two courses the `in`
    // read just left there — before the server's answer follows it.
    const everyCourse = await firstValueFrom(anonymous().observeCourses(null));

    expect(ids(listed)).toEqual(['c-upcoming', 'c-open']);
    expect(listed.ok && listed.value[1]).toEqual(COURSES[0]);
    expect(ids(everyCourse)).toEqual(['c-closed', 'c-upcoming', 'c-open']);
  });

  it('reads the upcoming side soonest first, every one, an event AT now included, a tie by id ascending', async () => {
    const upcoming = await firstValueFrom(anonymous().observeEvents(UPCOMING));

    expect(ids(upcoming)).toEqual([
      'up-now',
      'up-tie-a',
      'up-tie-b',
      'up-later',
    ]);
    expect(upcoming.ok && upcoming.value[3]).toEqual(EVENTS[28]);
  });

  it('reads the past side latest first, capped at 24 of 25, ties by id DESCENDING — the one kept at the cap included', async () => {
    const past = await firstValueFrom(anonymous().observeEvents(PAST));

    expect(ids(past)).toEqual([
      'past-01b',
      'past-01a',
      ...Array.from(
        { length: 21 },
        (_, i) => `past-${String(i + 2).padStart(2, '0')}`,
      ),
      'past-24b',
    ]);
  });

  it('answers both sides exactly as the memory double of @core/testing does', async () => {
    const ports = anonymous();
    const memory = memoryProgramsPorts(memoryProgramsWorld({ events: EVENTS }));

    for (const side of [UPCOMING, PAST]) {
      expect(await firstValueFrom(ports.observeEvents(side))).toEqual(
        await firstValueFrom(memory.observeEvents(side)),
      );
    }
  });

  it('lets a catalogue manager save a role whole and load it back, replacing the stored document', async () => {
    const ports = catalogueManager();
    const closed = positionOf('p-first', {
      positionStatus: PositionStatus.Closed,
      sortOrder: 3,
    });

    const saved = await ports.savePosition(closed);
    const loaded = await ports.loadPosition(closed.id);
    const absent = await ports.loadPosition(PositionId.of('p-nowhere'));

    expect(saved).toEqual(Result.ok(undefined));
    expect(loaded).toEqual(Result.ok(closed));
    expect(absent).toEqual(Result.ok(null));
  });

  it('lets a catalogue manager save a course and an event whole, each read back as saved', async () => {
    const ports = catalogueManager();
    const course = courseOf('c-new', {
      enrollmentStatus: EnrollmentStatus.Upcoming,
    });
    const event = eventOn('e-new', 10, {
      locationId: LocationId.of('loc-center'),
    });

    await ports.saveCourse(course);
    await ports.saveEvent(event);

    expect(await ports.loadCourse(course.id)).toEqual(Result.ok(course));
    expect(await ports.loadEvent(event.id)).toEqual(Result.ok(event));
  });

  it('refuses a client’s save through the rules, as the port’s RepositoryError', async () => {
    const client = programsPorts(
      modularFirestore(
        testEnv.authenticatedContext('client-1', { roles: ['client'] }),
      ),
    );

    const saved = await client.savePosition(positionOf('p-hacked'));

    expect(saved).toEqual(
      Result.err({
        errorCode: RepositoryErrorCode.WriteFailed,
        path: 'positions/p-hacked',
        reason: 'permission-denied',
      }),
    );
  });
});
