import { describe, expect, it } from 'vitest';
import { VenuePhone } from './venue-phone';

function validProps() {
  return { e164: '+359881234567', display: '+359 88 123 4567' };
}

describe('VenuePhone.create', () => {
  it('accepts a valid E.164 number with a non-blank display form', () => {
    const result = VenuePhone.create(validProps());
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.e164).toBe('+359881234567');
      expect(result.value.display).toBe('+359 88 123 4567');
    }
  });

  it('rejects a non-E.164 phone value', () => {
    const result = VenuePhone.create({
      e164: 'not-a-phone',
      display: 'whatever',
    });
    expect(result.isFailure()).toBe(true);
  });

  it('rejects a blank display', () => {
    const result = VenuePhone.create({ ...validProps(), display: '   ' });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error[0]?.code).toBe('catalog.venue_phone.blank_display');
    }
  });

  it('collects both errors at once when both fields are invalid', () => {
    const result = VenuePhone.create({ e164: 'bad', display: '' });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toHaveLength(2);
    }
  });
});

describe('VenuePhone.reconstitute', () => {
  it('validates identically to create()', () => {
    expect(VenuePhone.reconstitute(validProps()).isSuccess()).toBe(true);
  });
});

describe('VenuePhone.equals', () => {
  it('compares both the phone number and the display form', () => {
    const a = VenuePhone.create(validProps());
    const b = VenuePhone.create(validProps());
    const c = VenuePhone.create({ ...validProps(), display: '088 123 4567' });
    expect(a.isSuccess() && b.isSuccess() && a.value.equals(b.value)).toBe(
      true,
    );
    expect(a.isSuccess() && c.isSuccess() && a.value.equals(c.value)).toBe(
      false,
    );
  });
});
