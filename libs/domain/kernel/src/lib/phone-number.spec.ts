import { describe, expect, it } from 'vitest';
import { PhoneNumber } from './phone-number';
import { PhoneNumberInvalidError } from './phone-number.errors';

describe('PhoneNumber', () => {
  it('accepts an already-E.164 number', () => {
    const result = PhoneNumber.create('+359885550100');
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.value).toBe('+359885550100');
    }
  });

  it('accepts a local-format number given its country', () => {
    const result = PhoneNumber.create('0885550100', 'BG');
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.value).toBe('+359885550100');
    }
  });

  it('rejects garbage input', () => {
    const result = PhoneNumber.create('not-a-phone');
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(PhoneNumberInvalidError);
    }
  });

  it('rejects a number too short to be possible', () => {
    const result = PhoneNumber.create('123', 'BG');
    expect(result.isFailure()).toBe(true);
  });

  it('equals compares by canonical E.164 value', () => {
    const a = PhoneNumber.create('+359885550100');
    const b = PhoneNumber.create('0885550100', 'BG');
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
