import { describe, expect, it } from 'vitest';
import { PhoneSystem } from '../systems/phone.system';
import { CountryIso2 } from './country-iso2.data';

describe('CountryIso2', () => {
  it('of() is a zero-cost cast', () => {
    expect(CountryIso2.of('BG')).toBe('BG');
  });

  it('is nominal: a raw string is not a CountryIso2', () => {
    // @ts-expect-error — only CountryIso2.of (after PhoneSystem.parseCountry) makes one
    const raw: CountryIso2 = 'BG';
    expect(raw).toBe('BG');
  });

  it('agrees with the edge guard it stands behind', () => {
    const parsed = PhoneSystem.parseCountry('bg');
    expect(parsed).toEqual({ ok: true, value: CountryIso2.of('BG') });
  });
});
