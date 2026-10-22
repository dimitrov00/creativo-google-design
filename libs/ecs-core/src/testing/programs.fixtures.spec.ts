import { describe, expect, it } from 'vitest';
import { EnrollmentStatus, PositionStatus } from '@core/components';
import { CourseId, EventId, LocationId, PositionId } from '@core/primitives';
import { ProgramsSystem } from '@core/systems';
import { at } from './booking-core.fixtures';
import {
  FIXTURE_EVENT_DAY,
  courseInputOf,
  courseOf,
  positionInputOf,
  positionOf,
  shopEventInputOf,
  shopEventOf,
  shopInstantOf,
} from './programs.fixtures';
import {
  FIXTURE_TODAY,
  localDate,
  minute,
  unwrapOk,
  utcMs,
} from './test-support';

/*
 * The programs fixtures' own spec: the builders' defaults are pinned (never
 * the wall clock), every field is overridable, an event's instant follows
 * its wall clock in the fixture shop's zone, and each form input builds
 * exactly its entity through `ProgramsSystem`.
 */

describe('programs fixtures — the pins', () => {
  it('places the fixture event a week after FIXTURE_TODAY, 19:00 Sofia summer time', () => {
    expect(FIXTURE_TODAY).toBe('2026-09-28');
    expect(FIXTURE_EVENT_DAY).toBe('2026-10-05');
    const event = shopEventOf('evt-1');
    expect(event.localDate).toBe(FIXTURE_EVENT_DAY);
    expect(event.startMinutes).toBe(1140);
    expect(event.utcEpochMs).toBe(utcMs('2026-10-05T19:00:00.000+03:00'));
  });

  it('reads an instant on the shop’s wall clock, either side of the fall-back', () => {
    expect(shopInstantOf(localDate('2026-10-24'), minute(600))).toBe(
      utcMs('2026-10-24T10:00:00.000+03:00'),
    );
    expect(shopInstantOf(localDate('2026-10-26'), minute(600))).toBe(
      utcMs('2026-10-26T10:00:00.000+02:00'),
    );
  });

  it('throws on a spring-forward gap time — a broken fixture', () => {
    expect(() => shopInstantOf(localDate('2027-03-28'), minute(210))).toThrow();
  });
});

describe('programs fixtures — the entities', () => {
  it('builds a flat role with branded id and every optional present', () => {
    expect(positionOf('pos-1')).toEqual({
      id: PositionId.of('pos-1'),
      title: { bg: 'Бръснар', en: 'Barber' },
      summary: { bg: 'Пълен работен ден', en: 'Full-time chair' },
      locationIds: [],
      positionStatus: 'OPEN',
      applyUrl: null,
      sortOrder: 0,
    });
    expect(
      positionOf('pos-2', { positionStatus: PositionStatus.Closed }),
    ).toMatchObject({ id: 'pos-2', positionStatus: 'CLOSED' });
  });

  it('builds a flat course with no starts label', () => {
    expect(courseOf('course-1')).toEqual({
      id: CourseId.of('course-1'),
      title: { bg: 'Основи на фейда', en: 'Fundamentals of Fading' },
      description: { bg: 'Шестседмичен курс', en: 'Six-week evening course' },
      enrollmentStatus: 'OPEN',
      startsLabel: null,
      applyUrl: null,
      sortOrder: 0,
    });
    expect(
      courseOf('course-2', { enrollmentStatus: EnrollmentStatus.Upcoming })
        .enrollmentStatus,
    ).toBe('UPCOMING');
  });

  it('builds a flat event whose instant follows an overridden wall clock', () => {
    const event = shopEventOf('evt-2', {
      localDate: localDate('2026-11-05'),
      startMinutes: at(9, 5),
      locationId: LocationId.of('loc-center'),
    });
    expect(event).toEqual({
      id: EventId.of('evt-2'),
      title: { bg: 'Ден на отворените столове', en: 'Open Chair Day' },
      description: {
        bg: 'Подстригвания без резервация',
        en: 'Walk-in trims, no booking needed',
      },
      localDate: '2026-11-05',
      startMinutes: 545,
      utcEpochMs: utcMs('2026-11-05T09:05:00.000+02:00'),
      locationId: 'loc-center',
      applyUrl: null,
      sortOrder: 0,
    });
  });

  it('keeps an overridden instant as given', () => {
    const instant = utcMs('2026-01-01T00:00:00.000Z');
    expect(shopEventOf('evt-3', { utcEpochMs: instant }).utcEpochMs).toBe(
      instant,
    );
  });
});

describe('programs fixtures — each form builds its entity', () => {
  it('the role, course and event forms build the fixture entities', () => {
    expect(
      unwrapOk(
        ProgramsSystem.position(PositionId.of('pos-1'), positionInputOf()),
      ),
    ).toEqual(positionOf('pos-1'));
    expect(
      unwrapOk(ProgramsSystem.course(CourseId.of('course-1'), courseInputOf())),
    ).toEqual(courseOf('course-1'));
    const fields = unwrapOk(ProgramsSystem.eventFields(shopEventInputOf()));
    expect(
      ProgramsSystem.shopEvent(
        EventId.of('evt-1'),
        fields,
        shopInstantOf(fields.localDate, fields.startMinutes),
      ),
    ).toEqual(shopEventOf('evt-1'));
  });

  it('types the event form exactly as the datetime-local input emits it', () => {
    expect(shopEventInputOf().startsAt).toBe('2026-10-05T19:00');
  });
});
