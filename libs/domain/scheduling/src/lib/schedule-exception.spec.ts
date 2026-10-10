import { describe, expect, it } from 'vitest';
import type { Result } from '@creativo/domain/kernel';
import { BarberId, LocationId } from '@creativo/domain/catalog';
import { CalendarDay } from './calendar-day';
import {
  ScheduleException,
  ScheduleExceptionId,
  type ScheduleExceptionKind,
} from './schedule-exception';

/*
 * The shim class's applicability, kept against the class until Phase 4
 * deletes it: the two assertions of roster-window.spec.ts:259 ('a
 * location-wide closure removes the day for every barber') that its
 * ecs-core copy re-targets to `ScheduleExceptionSystem.isLocationWide` /
 * `appliesTo` (schedule-exception.system.spec.ts).
 */

const zone = 'Europe/Sofia';

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

function barberId(raw: string): BarberId {
  return unwrap(BarberId.create(raw));
}

function exception(
  detail: ScheduleExceptionKind,
  barber: BarberId | null,
): ScheduleException {
  return unwrap(
    ScheduleException.create({
      id: ScheduleExceptionId.of(`exc-2026-07-29-${detail.kind}`),
      day: unwrap(CalendarDay.create('2026-07-29', zone)),
      barberId: barber,
      locationId: unwrap(LocationId.create('loc-center')),
      detail,
    }),
  );
}

describe('ScheduleException — who an exception applies to', () => {
  it('a location-wide closure applies to every barber', () => {
    const closure = exception({ kind: 'closed' }, null);
    expect(closure.isLocationWide()).toBe(true);
    expect(closure.appliesTo(barberId('anyone'))).toBe(true);
    expect(closure.isWholeDay()).toBe(true);
  });

  it('one barber’s exception applies to that barber only', () => {
    const off = exception({ kind: 'time_off' }, barberId('ivan'));
    expect(off.isLocationWide()).toBe(false);
    expect(off.appliesTo(barberId('ivan'))).toBe(true);
    expect(off.appliesTo(barberId('stefan'))).toBe(false);
  });
});
