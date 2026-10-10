import { describe, expect, it } from 'vitest';
import { E164, PhoneNumber } from './phone-number.data';

describe('E164', () => {
  it('of() is a zero-cost cast to the stored string', () => {
    const e164 = E164.of('+359885550100');
    expect(e164).toBe('+359885550100');
    expect(typeof e164).toBe('string');
  });

  it('equals compares the canonical string', () => {
    expect(
      E164.equals(E164.of('+359885550100'), E164.of('+359885550100')),
    ).toBe(true);
    expect(
      E164.equals(E164.of('+359885550100'), E164.of('+359885550101')),
    ).toBe(false);
  });

  it('is nominal: a raw string is not an E164', () => {
    // @ts-expect-error — only E164.of (after PhoneSystem.parse) makes one
    const raw: E164 = '+359885550100';
    expect(raw).toBe('+359885550100');
  });
});

describe('PhoneNumber', () => {
  it('equals compares by canonical E.164 value only', () => {
    const a: PhoneNumber = {
      e164: E164.of('+359885550100'),
      countryCallingCode: '359',
    };
    const b: PhoneNumber = {
      e164: E164.of('+359885550100'),
      countryCallingCode: '359',
    };
    const c: PhoneNumber = {
      e164: E164.of('+12015550123'),
      countryCallingCode: '1',
    };
    expect(PhoneNumber.equals(a, b)).toBe(true);
    expect(PhoneNumber.equals(a, c)).toBe(false);
  });
});
