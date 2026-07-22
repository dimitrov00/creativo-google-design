import { describe, expect, it } from 'vitest';
import { isRegistrationField } from './registration-field';

describe('isRegistrationField', () => {
  it('accepts every known field', () => {
    expect(isRegistrationField('phone')).toBe(true);
    expect(isRegistrationField('email')).toBe(true);
    expect(isRegistrationField('firstName')).toBe(true);
    expect(isRegistrationField('lastName')).toBe(true);
  });

  it('rejects an unknown value', () => {
    expect(isRegistrationField('middleName')).toBe(false);
    expect(isRegistrationField(123)).toBe(false);
    expect(isRegistrationField(undefined)).toBe(false);
  });
});
