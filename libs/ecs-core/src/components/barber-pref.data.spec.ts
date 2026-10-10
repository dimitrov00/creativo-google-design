import { describe, expect, it } from 'vitest';
import { BarberId } from '../entities/barber.entity';
import { BarberPref, BarberPrefKind } from './barber-pref.data';

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
    expect(BarberPref.fromBarberId(null)).toEqual({ kind: 'any' });
    expect(BarberPref.fromBarberId(IVAN)).toEqual({
      kind: 'specific',
      barberId: IVAN,
    });
  });

  it("reads a seat's stored tag with the seat's barber — and unknown never as any", () => {
    expect(BarberPref.fromSeat(BarberPrefKind.Any, IVAN)).toEqual({
      kind: 'any',
    });
    expect(BarberPref.fromSeat(BarberPrefKind.Specific, IVAN)).toEqual({
      kind: 'specific',
      barberId: IVAN,
    });
    expect(BarberPref.fromSeat(null, IVAN)).toBeNull();
  });

  it('parses only the two stored tags', () => {
    expect(BarberPref.parseKind('any')).toBe('any');
    expect(BarberPref.parseKind('specific')).toBe('specific');
    for (const raw of [null, undefined, '', 'Any', 3]) {
      expect(BarberPref.parseKind(raw)).toBeNull();
    }
  });
});
