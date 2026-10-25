import { describe, expect, it } from 'vitest';
import { at, until } from '@core/testing';
import { ShopDayHours } from './shop-day-hours.data';

describe('ShopDayHours', () => {
  it('is the opening envelope on the wall clock', () => {
    expect(ShopDayHours.of(at(10), until(20))).toEqual({
      openMinutes: 600,
      closeMinutes: 1200,
    });
  });
});
