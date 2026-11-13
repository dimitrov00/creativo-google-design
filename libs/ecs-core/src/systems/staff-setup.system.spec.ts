import { describe, expect, it } from 'vitest';
import { BarberStatus, StaffSetupItem } from '@core/components';
import { BarberId, MediaRefId } from '@core/primitives';
import {
  barberFixture,
  barberScheduleFixture,
  deepFreeze,
  FIXTURE_NOW_UTC_MS,
  localDate,
  serviceFixture,
} from '@core/testing';
import { StaffSetupSystem } from './staff-setup.system';

const doneOf = (
  entries: readonly { staffSetupItem: StaffSetupItem; done: boolean }[],
) => Object.fromEntries(entries.map((e) => [e.staffSetupItem, e.done]));

describe('StaffSetupSystem.checklistOf', () => {
  // Ivan performs the fixture service and works Mon–Fri from 2026-01-01.
  const ivan = barberFixture();
  const service = serviceFixture();
  const schedule = barberScheduleFixture();

  it('is ready once the record has a name, a service that lists it and hours inside its period', () => {
    const checklist = StaffSetupSystem.checklistOf(ivan, [service], schedule);
    expect(checklist.ready).toBe(true);
    expect(checklist.firstMissing).toBeNull();
    expect(doneOf(checklist.needed)).toEqual({
      NAME: true,
      START_DAY: true,
      SHOPS: true,
      SERVICES: true,
      HOURS: true,
    });
  });

  it('names the services first, then the hours, as what a new record misses', () => {
    const newcomer = barberFixture(
      { id: BarberId.of('b-new') },
      {
        barberStatus: BarberStatus.Draft,
        barberStatusChangedAtUtcMs: FIXTURE_NOW_UTC_MS,
        barberDraftTargetStatus: BarberStatus.Public,
      },
    );
    const nothing = StaffSetupSystem.checklistOf(newcomer, [service], null);
    expect(nothing.ready).toBe(false);
    expect(nothing.firstMissing).toBe(StaffSetupItem.Services);
    expect(doneOf(nothing.needed)).toMatchObject({
      SERVICES: false,
      HOURS: false,
    });

    const offered = serviceFixture({
      offerings: [
        ...service.offerings,
        { ...service.offerings[0]!, barberId: newcomer.id },
      ],
    });
    expect(
      StaffSetupSystem.checklistOf(newcomer, [offered], null).firstMissing,
    ).toBe(StaffSetupItem.Hours);
  });

  it('counts hours only inside the working period — a roster that ended before the start day, or begins after the last, is none', () => {
    const startsLater = barberFixture({
      barberStartsLocalDate: localDate('2027-01-01'),
    });
    const endedBefore = barberScheduleFixture({
      versions: schedule.versions.map((version) => ({
        ...version,
        effectiveToLocalDate: localDate('2026-12-31'),
      })),
    });
    expect(
      StaffSetupSystem.checklistOf(startsLater, [service], endedBefore)
        .firstMissing,
    ).toBe(StaffSetupItem.Hours);

    const leftEarlier = barberFixture({
      barberLastWorkingLocalDate: localDate('2025-12-31'),
    });
    expect(
      StaffSetupSystem.checklistOf(leftEarlier, [service], schedule)
        .firstMissing,
    ).toBe(StaffSetupItem.Hours);

    // An open-ended roster covers a future start.
    expect(
      StaffSetupSystem.checklistOf(startsLater, [service], schedule).ready,
    ).toBe(true);
    // A version with no segment is no hours.
    const empty = barberScheduleFixture({
      versions: schedule.versions.map((version) => ({
        ...version,
        segments: [],
      })),
    });
    expect(
      StaffSetupSystem.checklistOf(ivan, [service], empty).firstMissing,
    ).toBe(StaffSetupItem.Hours);
  });

  it('reads the optional profile details off the record, and they never hold a record back', () => {
    const bare = barberFixture({
      title: null,
      bio: null,
      instagramHandle: null,
      yearsExperience: null,
    });
    const checklist = StaffSetupSystem.checklistOf(bare, [service], schedule);
    expect(checklist.ready).toBe(true);
    expect(doneOf(checklist.optional)).toEqual({
      PHOTO: false,
      TITLE: false,
      BIO: false,
      INSTAGRAM: false,
      EXPERIENCE: false,
    });
    const full = barberFixture({
      avatarMediaId: MediaRefId.of('media-ivan'),
      instagramHandle: 'ivan.cuts',
    });
    expect(
      doneOf(StaffSetupSystem.checklistOf(full, [service], schedule).optional),
    ).toEqual({
      PHOTO: true,
      TITLE: true,
      BIO: true,
      INSTAGRAM: true,
      EXPERIENCE: true,
    });
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const barber = deepFreeze(barberFixture());
    const services = deepFreeze([serviceFixture()]);
    const roster = deepFreeze(barberScheduleFixture());
    const once = StaffSetupSystem.checklistOf(barber, services, roster);
    expect(StaffSetupSystem.checklistOf(barber, services, roster)).toEqual(
      once,
    );
  });
});
