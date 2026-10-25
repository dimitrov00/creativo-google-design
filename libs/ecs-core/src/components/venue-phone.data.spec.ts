import { describe, expect, it } from 'vitest';
import { VenuePhone } from './venue-phone.data';
import { E164 } from './e164.data';

const CENTER = E164.of('+359881234567');

// catalog venue-phone.spec.ts, on the flat slice; the E.164 half is
// PhoneSystem.parse at the edge (phone.system.spec.ts).
describe('VenuePhone.of', () => {
  it('accepts a parsed number with a non-blank display form', () => {
    expect(VenuePhone.of(CENTER, '+359 88 123 4567')).toEqual({
      ok: true,
      value: { phoneE164: '+359881234567', phoneDisplay: '+359 88 123 4567' },
    });
  });

  it('trims the display form', () => {
    const result = VenuePhone.of(CENTER, '  +359 88 123 4567 ');
    expect(result.ok && result.value.phoneDisplay).toBe('+359 88 123 4567');
  });

  it('rejects a blank display', () => {
    expect(VenuePhone.of(CENTER, '   ')).toEqual({
      ok: false,
      error: { errorCode: 'CATALOG_VENUE_PHONE_BLANK_DISPLAY' },
    });
  });
});

describe('VenuePhone.equals', () => {
  it('compares both the number and the display form', () => {
    const a: VenuePhone = {
      phoneE164: CENTER,
      phoneDisplay: '+359 88 123 4567',
    };
    expect(VenuePhone.equals(a, { ...a })).toBe(true);
    expect(VenuePhone.equals(a, { ...a, phoneDisplay: '088 123 4567' })).toBe(
      false,
    );
    expect(
      VenuePhone.equals(a, { ...a, phoneE164: E164.of('+359887654321') }),
    ).toBe(false);
  });
});
