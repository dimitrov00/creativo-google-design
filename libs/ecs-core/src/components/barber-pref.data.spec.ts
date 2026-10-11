import { describe, expect, it } from 'vitest';
import { BarberId } from '../primitives/ids.primitive';
import { BarberPref, BarberPreference } from './barber-pref.data';

const IVAN = BarberId.of('ivan');
const STEFAN = BarberId.of('stefan');

describe('BarberPref', () => {
  it('anyone will do is satisfied by everyone; a specific barber only by them', () => {
    expect(BarberPref.matches(BarberPref.any(), IVAN)).toBe(true);
    expect(BarberPref.matches(BarberPref.specific(IVAN), IVAN)).toBe(true);
    expect(BarberPref.matches(BarberPref.specific(IVAN), STEFAN)).toBe(false);
  });

  it('compares by arm and by barber', () => {
    expect(BarberPref.equals(BarberPref.any(), BarberPref.any())).toBe(true);
    expect(
      BarberPref.equals(BarberPref.specific(IVAN), BarberPref.specific(IVAN)),
    ).toBe(true);
    expect(
      BarberPref.equals(BarberPref.specific(IVAN), BarberPref.specific(STEFAN)),
    ).toBe(false);
    expect(BarberPref.equals(BarberPref.any(), BarberPref.specific(IVAN))).toBe(
      false,
    );
    expect(BarberPref.equals(BarberPref.specific(IVAN), BarberPref.any())).toBe(
      false,
    );
  });

  it('round-trips the stored cart-line form, where null is anyone', () => {
    expect(BarberPref.toBarberIdOrNull(BarberPref.any())).toBeNull();
    expect(BarberPref.toBarberIdOrNull(BarberPref.specific(IVAN))).toBe(IVAN);
    expect(BarberPref.fromBarberId(null)).toEqual({ barberPreference: 'ANY' });
    expect(BarberPref.fromBarberId(IVAN)).toEqual({
      barberPreference: 'SPECIFIC',
      preferredBarberId: IVAN,
    });
  });

  it("reads a seat's stored tag with the seat's barber — and unknown never as any", () => {
    expect(BarberPref.fromSeat(BarberPreference.Any, IVAN)).toEqual({
      barberPreference: 'ANY',
    });
    expect(BarberPref.fromSeat(BarberPreference.Specific, IVAN)).toEqual({
      barberPreference: 'SPECIFIC',
      preferredBarberId: IVAN,
    });
    expect(BarberPref.fromSeat(null, IVAN)).toBeNull();
  });

  it('parses only the two tags', () => {
    expect(BarberPref.parsePreference('ANY')).toBe('ANY');
    expect(BarberPref.parsePreference('SPECIFIC')).toBe('SPECIFIC');
    for (const raw of [null, undefined, '', 'Any', 'any', 3]) {
      expect(BarberPref.parsePreference(raw)).toBeNull();
    }
  });
});
