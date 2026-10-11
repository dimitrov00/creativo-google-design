import { describe, expect, it } from 'vitest';
import { LocationId } from '@core/primitives';
import { PhoneSystem } from '@core/systems';
import { CountryIso2 } from './country-iso2.data';
import { TenantConfig } from './tenant-config.data';

describe('TenantConfig.DEFAULT', () => {
  it('is the centre-shop deployment', () => {
    expect(TenantConfig.DEFAULT).toEqual({
      defaultLocationId: 'loc-center',
      countryCallingCode: '359',
    });
  });

  it('names a location, never a zone — the zone lives on the ShopLocation alone (Law 7.2, F-4)', () => {
    // The governance TenantConfig's timezone invariant moved with the zone:
    // the constant names the shop a location-less boundary reads its
    // `timeZone` from, and the id is one `LocationId.parse` accepts.
    expect(TenantConfig.DEFAULT).not.toHaveProperty('zone');
    expect(LocationId.parse(TenantConfig.DEFAULT.defaultLocationId)).toEqual({
      ok: true,
      value: 'loc-center',
    });
  });

  it("dials Bulgaria's calling code, digits only", () => {
    expect(TenantConfig.DEFAULT.countryCallingCode).toBe(
      PhoneSystem.countryCallingCode(CountryIso2.of('BG')),
    );
  });
});
