import { describe, expect, it } from 'vitest';
import { termsFixture } from '@core/testing';
import { SeatKeyText } from '@core/primitives';
import { StaffTermsOverride } from './staff-terms-override.data';

describe('StaffTermsOverride', () => {
  const terms = termsFixture(2000, 45);

  it('finds the override a seat was re-priced by, or none', () => {
    const overrides = [StaffTermsOverride.of(SeatKeyText.of('line-1'), terms)];
    expect(StaffTermsOverride.find(overrides, 'line-1')).toEqual({
      seatKey: 'line-1',
      priceCents: 2000,
      currency: 'EUR',
      durationMinutes: 45,
      setupMinutes: 0,
      cleanupMinutes: 0,
    });
    expect(StaffTermsOverride.find(overrides, 'line-2')).toBeNull();
  });

  it('carries a seat with every figure left to the catalogue', () => {
    expect(StaffTermsOverride.carried(SeatKeyText.of('line-3'))).toEqual({
      seatKey: 'line-3',
      priceCents: null,
      currency: null,
      durationMinutes: null,
      setupMinutes: null,
      cleanupMinutes: null,
    });
  });
});
