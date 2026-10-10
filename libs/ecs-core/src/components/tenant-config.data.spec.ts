import { describe, expect, it } from 'vitest';
import { PhoneSystem } from '../systems/phone.system';
import { ZonedTimeSystem } from '../systems/zoned-time.system';
import { CountryIso2 } from './country-iso2.data';
import { TenantConfig } from './tenant-config.data';

describe('TenantConfig.DEFAULT', () => {
  it('is the Sofia deployment', () => {
    expect(TenantConfig.DEFAULT).toEqual({
      zone: 'Europe/Sofia',
      countryCallingCode: '359',
    });
  });

  it('names a zone the platform knows', () => {
    // The governance TenantConfig's timezone invariant, kept as a spec: the
    // constant is never stored, so there is no edge to guard at run time.
    // Zone math is `ZonedTimeSystem`'s alone (D5), specs included.
    expect(ZonedTimeSystem.isValidZone(TenantConfig.DEFAULT.zone)).toBe(true);
  });

  it("dials Bulgaria's calling code, digits only", () => {
    expect(TenantConfig.DEFAULT.countryCallingCode).toBe(
      PhoneSystem.countryCallingCode(CountryIso2.of('BG')),
    );
  });
});
