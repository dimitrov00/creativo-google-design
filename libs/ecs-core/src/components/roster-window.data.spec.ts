import { describe, expect, it } from 'vitest';
import { at, until } from '../testing/booking-core.fixtures';
import { BarberId, LocationId } from '../primitives/ids.primitive';
import { RosterWindow, ShopDayHours } from './roster-window.data';

describe('RosterWindow', () => {
  it('is a plain struct on the wall clock, attributed to its shop', () => {
    const window = RosterWindow.of(
      BarberId.of('ivan'),
      LocationId.of('loc-center'),
      at(9),
      until(13),
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
  it('is the opening envelope on the wall clock', () => {
    expect(ShopDayHours.of(at(10), until(20))).toEqual({
      openMinutes: 600,
      closeMinutes: 1200,
    });
  });
});
