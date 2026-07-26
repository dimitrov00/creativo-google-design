import { describe, expect, it } from 'vitest';
import { PhoneNumber } from './phone-number';
import { PhoneNumberInvalidError } from './phone-number.errors';
import { CountryIso2, toCountryIso2 } from './phone-country';

function iso(raw: string): CountryIso2 {
  const result = toCountryIso2(raw);
  if (result.isFailure()) {
    throw new Error(`test expects "${raw}" to be a supported country`);
  }
  return result.value;
}

const BG = iso('BG');

describe('PhoneNumber', () => {
  it('accepts an already-E.164 number', () => {
    const result = PhoneNumber.create('+359885550100');
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.value).toBe('+359885550100');
    }
  });

  it('accepts a local-format number given its country', () => {
    const result = PhoneNumber.create('0885550100', BG);
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.value).toBe('+359885550100');
    }
  });

  it('rejects garbage input with reason not-a-number', () => {
    const result = PhoneNumber.create('not-a-phone');
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(PhoneNumberInvalidError);
      expect(result.error.reason).toBe('not-a-number');
    }
  });

  it('rejects a number too short to be possible with reason too-short', () => {
    const result = PhoneNumber.create('123', BG);
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.reason).toBe('too-short');
    }
  });

  it('rejects an over-long number with reason too-long', () => {
    const result = PhoneNumber.create('+3598855501001234567');
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.reason).toBe('too-long');
    }
  });

  it('rejects a local-format number without a country with reason invalid-country', () => {
    const result = PhoneNumber.create('0885550100');
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.reason).toBe('invalid-country');
    }
  });

  it('surfaces the reason in the error params for i18n interpolation', () => {
    const result = PhoneNumber.create('123', BG);
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.code).toBe('phone_number_invalid');
      expect(result.error.params['reason']).toBe('too-short');
    }
  });

  it('derives the country from the stored E.164', () => {
    const result = PhoneNumber.create('0885550100', BG);
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.country).toBe('BG');
    }
  });

  it('formats nationally and internationally while storing E.164', () => {
    const result = PhoneNumber.create('+359885550100');
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.formatNational()).toBe('088 555 0100');
      expect(result.value.formatInternational()).toBe('+359 88 555 0100');
      expect(result.value.value).toBe('+359885550100');
    }
  });

  it('equals compares by canonical E.164 value', () => {
    const a = PhoneNumber.create('+359885550100');
    const b = PhoneNumber.create('0885550100', BG);
    expect(a.isSuccess() && b.isSuccess()).toBe(true);
    if (a.isSuccess() && b.isSuccess()) {
      expect(a.value.equals(b.value)).toBe(true);
    }
  });

  it('fromPrimitive rebuilds a trusted value without re-validating', () => {
    const phone = PhoneNumber.fromPrimitive('+359885550100');
    expect(phone.toString()).toBe('+359885550100');
  });
});
