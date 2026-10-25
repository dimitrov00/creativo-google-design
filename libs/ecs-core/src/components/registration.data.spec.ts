import { describe, expect, it } from 'vitest';
import {
  Registration,
  RegistrationField,
  RegistrationState,
} from './registration.data';

describe('Registration', () => {
  it('the registration tags are a plain field’s SCREAMING values, each once', () => {
    expect(Object.values(RegistrationState)).toEqual([
      'PROVISIONED',
      'REGISTERED',
    ]);
    expect(RegistrationState.Registered).toBe('REGISTERED');
    expect(RegistrationState.Provisioned).toBe('PROVISIONED');
  });

  it('isRegistered tells the stub from the registered body, off the plain tag field', () => {
    expect(
      Registration.isRegistered({
        registrationState: RegistrationState.Registered,
      }),
    ).toBe(true);
    expect(
      Registration.isRegistered({
        registrationState: RegistrationState.Provisioned,
      }),
    ).toBe(false);
  });

  it('emptyFields() has every registration field, each null', () => {
    const fields = Registration.emptyFields();
    expect(Object.keys(fields).sort()).toEqual([...Registration.FIELDS].sort());
    for (const value of Object.values(fields)) expect(value).toBeNull();
  });
});

describe('RegistrationField', () => {
  it('is the identity REGISTRATION_FIELDS vocabulary, in order', () => {
    expect([...Registration.FIELDS]).toEqual([
      'phone',
      'email',
      'firstName',
      'lastName',
      'birthDate',
    ]);
  });

  it('isRegistrationField narrows known fields and rejects strangers', () => {
    expect(Registration.isField(RegistrationField.BirthDate)).toBe(true);
    expect(Registration.isField('middleName')).toBe(false);
    expect(Registration.isField(0)).toBe(false);
  });
});
