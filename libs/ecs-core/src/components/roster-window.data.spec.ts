import { describe, expect, it } from 'vitest';
import { BarberId } from '../entities/barber.entity';
import { LocationId } from '../entities/location.entity';
import { RosterWindow, ShopDayHours } from './roster-window.data';

describe('RosterWindow', () => {
  it('is a plain struct in minutes of the day, attributed to its shop', () => {
    const window = RosterWindow.of(
      BarberId.of('ivan'),
      LocationId.of('loc-center'),
      540,
      780,
    );
    expect(window).toEqual({
      barberId: 'ivan',
      locationId: 'loc-center',
      startMinutes: 540,
      endMinutes: 780,
    });
    expect(RosterWindow.durationMinutes(window)).toBe(240);
  });
});

describe('ShopDayHours', () => {
  it('is the opening envelope in minutes of the day', () => {
    expect(ShopDayHours.of(600, 1200)).toEqual({
      openMinutes: 600,
      closeMinutes: 1200,
    });
  });
});
