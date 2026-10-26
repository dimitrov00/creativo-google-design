import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { deepFreeze, unwrapErr, unwrapOk } from '@core/testing';
import { E164 } from './e164.data';

/*
 * OR-48: `E164.parse` — the shape door for foreign input that claims to be
 * canonical already (a rehydrated booking draft, the landing's static shop
 * number). The number plans stay `PhoneSystem.parse`'s.
 */
describe('E164.parse — the E.164 shape, no number plan', () => {
  it('takes `+`, a country code that never starts with 0, and 7 to 15 digits in all — kept exactly as given', () => {
    for (const raw of [
      '+359888123456',
      '+12025550123',
      '+1234567',
      '+123456789012345',
    ]) {
      expect(unwrapOk(E164.parse(raw))).toBe(raw);
      expect(E164.is(raw)).toBe(true);
    }
  });

  it('refuses everything else as PRIMITIVE_PHONE_NOT_E164 — the boundaries one digit either side', () => {
    for (const raw of [
      '',
      '+',
      '+123456',
      '+1234567890123456',
      '+0888123456',
      '359888123456',
      '0888 123 456',
      '+359 888 123 456',
      '+359-888-123-456',
      ' +359888123456',
      '+359888123456 ',
      '++359888123456',
      '+٣٥٩٨٨٨١٢٣٤٥٦',
      'tel:+359888123456',
    ]) {
      expect(unwrapErr(E164.parse(raw))).toEqual({
        errorCode: 'PRIMITIVE_PHONE_NOT_E164',
        raw,
        brand: 'E164',
      });
      expect(E164.is(raw)).toBe(false);
    }
  });

  it('is answers false for every other type — parse is never handed one', () => {
    for (const raw of [null, undefined, 359888123456, {}, ['+359888123456']]) {
      expect(E164.is(raw)).toBe(false);
    }
  });

  it('is ⇔ parse for arbitrary strings (property)', () => {
    fc.assert(
      fc.property(
        fc.string({
          unit: fc.constantFrom('+', '0', '1', '3', '9', ' ', '-'),
          maxLength: 18,
        }),
        (raw) => E164.is(raw) === E164.parse(raw).ok,
      ),
    );
  });

  it('of stays the unchecked door for proven values', () => {
    expect(E164.of('+359888123456')).toBe('+359888123456');
    expect(
      E164.equals(E164.of('+359888123456'), E164.of('+359888123456')),
    ).toBe(true);
  });

  it('is pure: same input → same answer, input untouched', () => {
    const raws = deepFreeze(['+359888123456', '0888 123 456']);
    const once = raws.map((raw) => E164.parse(raw));
    const twice = raws.map((raw) => E164.parse(raw));
    expect(twice).toEqual(once);
    expect(raws).toEqual(['+359888123456', '0888 123 456']);
  });
});
