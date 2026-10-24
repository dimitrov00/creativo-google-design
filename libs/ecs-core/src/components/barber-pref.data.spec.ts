import { describe, expect, it } from 'vitest';
import { BarberId } from '@core/primitives';
import { BarberPref } from './barber-pref.data';

const IVAN = BarberId.of('ivan');
const STEFAN = BarberId.of('stefan');

describe('BarberPref', () => {
  it('anyone will do is satisfied by everyone; a specific barber only by them', () => {
    expect(BarberPref.matches(BarberPref.any(), IVAN)).toBe(true);
    expect(BarberPref.matches(BarberPref.specific(IVAN), IVAN)).toBe(true);
    expect(BarberPref.matches(BarberPref.specific(IVAN), STEFAN)).toBe(false);
  });

  it('reads the stored cart-line form, where null is anyone', () => {
    expect(BarberPref.fromBarberId(null)).toEqual({ barberPreference: 'ANY' });
    expect(BarberPref.fromBarberId(IVAN)).toEqual({
      barberPreference: 'SPECIFIC',
      preferredBarberId: IVAN,
    });
  });
});
