import { describe, expect, it } from 'vitest';
import {
  REGISTRATION_FIELDS,
  Registration,
  RegistrationField,
  RegistrationState,
  isRegistrationField,
} from './registration.data';

describe('Registration', () => {
  it('provisioned() and registered() are shared tag structs', () => {
    expect(Registration.provisioned()).toEqual({ kind: 'provisioned' });
    expect(Registration.registered()).toEqual({ kind: 'registered' });
    expect(Registration.registered()).toBe(Registration.registered());
  });

  it('isRegistered tells the stub from the registered body', () => {
    expect(Registration.isRegistered(Registration.registered())).toBe(true);
    expect(Registration.isRegistered(Registration.provisioned())).toBe(false);
    expect(Registration.provisioned().kind).toBe(RegistrationState.Provisioned);
  });

  it('emptyFields() has every registration field, each null', () => {
    const fields = Registration.emptyFields();
    expect(Object.keys(fields).sort()).toEqual([...REGISTRATION_FIELDS].sort());
    for (const value of Object.values(fields)) expect(value).toBeNull();
  });
});

describe('RegistrationField', () => {
  it('is the identity REGISTRATION_FIELDS vocabulary, in order', () => {
    expect([...REGISTRATION_FIELDS]).toEqual([
      'phone',
      'email',
      'firstName',
      'lastName',
      'birthDate',
    ]);
  });

  it('isRegistrationField narrows known fields and rejects strangers', () => {
    expect(isRegistrationField(RegistrationField.BirthDate)).toBe(true);
    expect(isRegistrationField('middleName')).toBe(false);
    expect(isRegistrationField(0)).toBe(false);
  });
});
