import { describe, expect, it } from 'vitest';
import { Role } from '@core/components';
import { BarberId, LocalDate, UserId } from '@core/primitives';
import { principalFixture, unwrapOk } from '@core/testing';
import { analyticsEntryQueryOf } from './analytics-entry';

const DAY = unwrapOk(LocalDate.parse('2026-08-05'));
const IVAN = BarberId.of('ivan');
const ADMIN = principalFixture.staff(UserId.of('dev-admin'), [Role.Admin]);
const BARBER = principalFixture.staff(UserId.of('dev-staff-ivan'), [
  Role.Barber,
]);

describe('analyticsEntryQueryOf', () => {
  it('an admin viewing one chair opens that barber’s week', () => {
    expect(analyticsEntryQueryOf(ADMIN, IVAN, DAY)).toEqual({
      span: 'WEEK',
      from: DAY,
      barber: IVAN,
    });
  });

  it('an admin viewing every chair opens the shop (no barber)', () => {
    expect(analyticsEntryQueryOf(ADMIN, null, DAY)).toEqual({
      span: 'WEEK',
      from: DAY,
    });
  });

  it('a barber opens their own, whatever chair the book shows', () => {
    expect(analyticsEntryQueryOf(BARBER, IVAN, DAY)).toEqual({
      span: 'WEEK',
      from: DAY,
    });
  });

  it('a principal not yet known reads as a barber', () => {
    expect(analyticsEntryQueryOf(undefined, IVAN, DAY)).toEqual({
      span: 'WEEK',
      from: DAY,
    });
  });
});
