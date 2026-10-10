import { describe, expect, it } from 'vitest';
import { E164 } from './phone-number.data';
import { VenuePhone } from './venue-phone.data';

const CENTER = E164.of('+359881234567');

// catalog venue-phone.spec.ts, on the stored struct; the E.164 half is
// PhoneSystem.parse at the edge (phone.system.spec.ts).
describe('VenuePhone.of', () => {
  it('accepts a parsed number with a non-blank display form', () => {
    expect(VenuePhone.of(CENTER, '+359 88 123 4567')).toEqual({
      ok: true,
      value: { e164: '+359881234567', display: '+359 88 123 4567' },
    });
  });

  it('trims the display form', () => {
    const result = VenuePhone.of(CENTER, '  +359 88 123 4567 ');
    expect(result.ok && result.value.display).toBe('+359 88 123 4567');
  });

  it('rejects a blank display', () => {
    expect(VenuePhone.of(CENTER, '   ')).toEqual({
      ok: false,
      error: { code: 'catalog.venue_phone.blank_display' },
    });
  });
});

describe('VenuePhone.equals', () => {
  it('compares both the number and the display form', () => {
    const a = { e164: CENTER, display: '+359 88 123 4567' };
    expect(VenuePhone.equals(a, { ...a })).toBe(true);
    expect(VenuePhone.equals(a, { ...a, display: '088 123 4567' })).toBe(false);
    expect(VenuePhone.equals(a, { ...a, e164: E164.of('+359887654321') })).toBe(
      false,
    );
  });
});
