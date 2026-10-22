import {
  EnrollmentStatus,
  PositionStatus,
  type CourseInput,
  type PositionInput,
  type ShopEventInput,
} from '@core/components';
import type { Course, Position, ShopEvent } from '@core/entities';
import {
  CourseId,
  EventId,
  LocalDate,
  PositionId,
  type MinuteOfDay,
  type UtcEpochMs,
} from '@core/primitives';
import { ZonedTimeSystem } from '@core/systems';
import { at } from './booking-core.fixtures';
import {
  FIXTURE_TIME_ZONE,
  FIXTURE_TODAY,
  textFixture,
  unwrapOk,
} from './test-support';

/**
 * The programs fixtures (flip 4, plan §3.5) — the careers, courses and
 * events entities in their flat, branded shapes, every field present
 * (`null` for none), overridable field by field, and the admin form inputs
 * that build them. Test support only, reached through `@core/testing`.
 *
 * Time is pinned, never the wall clock: an event's day is
 * {@link FIXTURE_EVENT_DAY} (a week after `FIXTURE_TODAY`), its instant the
 * Sofia instant of its wall clock ({@link shopInstantOf}), recomputed from
 * an overridden `localDate`/`startMinutes` unless `utcEpochMs` is given too.
 */

/** The fixture event's shop day — `FIXTURE_TODAY` + 7: Monday 2026-10-05, summer time (UTC+3). */
export const FIXTURE_EVENT_DAY: LocalDate = LocalDate.addDays(FIXTURE_TODAY, 7);

/**
 * The instant of a wall-clock time in the fixture shop's zone
 * (`Europe/Sofia`) — what the save pipeline computes at ingestion. Throws
 * on a spring-forward gap time (a broken fixture).
 */
export function shopInstantOf(
  localDate: LocalDate,
  startMinutes: MinuteOfDay,
): UtcEpochMs {
  return unwrapOk(
    ZonedTimeSystem.toUtc(localDate, startMinutes, FIXTURE_TIME_ZONE),
  );
}

/** An open role at every location, no apply URL, first in order. */
export function positionOf(
  id: string,
  overrides: Partial<Position> = {},
): Position {
  return {
    id: PositionId.of(id),
    title: textFixture('Barber', 'Бръснар'),
    summary: textFixture('Full-time chair', 'Пълен работен ден'),
    locationIds: [],
    positionStatus: PositionStatus.Open,
    applyUrl: null,
    sortOrder: 0,
    ...overrides,
  } satisfies Position;
}

/** An open course with no starts label and no apply URL, first in order. */
export function courseOf(id: string, overrides: Partial<Course> = {}): Course {
  return {
    id: CourseId.of(id),
    title: textFixture('Fundamentals of Fading', 'Основи на фейда'),
    description: textFixture('Six-week evening course', 'Шестседмичен курс'),
    enrollmentStatus: EnrollmentStatus.Open,
    startsLabel: null,
    applyUrl: null,
    sortOrder: 0,
    ...overrides,
  } satisfies Course;
}

/**
 * An event on {@link FIXTURE_EVENT_DAY} at 19:00 shop time, at no single
 * shop, no RSVP link, first in order; `utcEpochMs` follows the (possibly
 * overridden) wall clock unless overridden itself.
 */
export function shopEventOf(
  id: string,
  overrides: Partial<ShopEvent> = {},
): ShopEvent {
  const localDate = overrides.localDate ?? FIXTURE_EVENT_DAY;
  const startMinutes = overrides.startMinutes ?? at(19);
  return {
    id: EventId.of(id),
    title: textFixture('Open Chair Day', 'Ден на отворените столове'),
    description: textFixture(
      'Walk-in trims, no booking needed',
      'Подстригвания без резервация',
    ),
    localDate,
    startMinutes,
    utcEpochMs: shopInstantOf(localDate, startMinutes),
    locationId: null,
    applyUrl: null,
    sortOrder: 0,
    ...overrides,
  } satisfies ShopEvent;
}

/** The admin form of {@link positionOf}'s role, as typed (untrimmed text allowed). */
export function positionInputOf(
  overrides: Partial<PositionInput> = {},
): PositionInput {
  return {
    title: textFixture('Barber', 'Бръснар'),
    summary: textFixture('Full-time chair', 'Пълен работен ден'),
    locationIds: [],
    positionStatus: PositionStatus.Open,
    applyUrl: '',
    sortOrder: 0,
    ...overrides,
  } satisfies PositionInput;
}

/** The admin form of {@link courseOf}'s course, as typed (both starts-label locales blank). */
export function courseInputOf(
  overrides: Partial<CourseInput> = {},
): CourseInput {
  return {
    title: textFixture('Fundamentals of Fading', 'Основи на фейда'),
    description: textFixture('Six-week evening course', 'Шестседмичен курс'),
    enrollmentStatus: EnrollmentStatus.Open,
    startsLabel: textFixture(''),
    applyUrl: '',
    sortOrder: 0,
    ...overrides,
  } satisfies CourseInput;
}

/** The admin form of {@link shopEventOf}'s event, as typed — `startsAt` `2026-10-05T19:00`. */
export function shopEventInputOf(
  overrides: Partial<ShopEventInput> = {},
): ShopEventInput {
  return {
    title: textFixture('Open Chair Day', 'Ден на отворените столове'),
    description: textFixture(
      'Walk-in trims, no booking needed',
      'Подстригвания без резервация',
    ),
    startsAt: `${FIXTURE_EVENT_DAY}T19:00`,
    locationId: '',
    applyUrl: '',
    sortOrder: 0,
    ...overrides,
  } satisfies ShopEventInput;
}
