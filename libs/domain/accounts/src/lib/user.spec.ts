import { ZonedDateTime } from '@creativo/domain/kernel';
import { describe, expect, it } from 'vitest';
import { AccountStatus } from './account-status';
import { User, UserProps } from './user';

function today(): ZonedDateTime {
  const result = ZonedDateTime.fromISO('2026-07-22T12:00:00', 'Europe/Sofia');
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

function validProps(): UserProps {
  return {
    id: 'uid_1',
    phone: '+359885550100',
    firstName: 'Ivo',
    lastName: 'Petrov',
    roles: ['client'],
    status: AccountStatus.active(),
    email: 'client@example.com',
    birthDate: '2000-01-01',
  };
}

describe('User.create', () => {
  it('accepts fully valid props', () => {
    const result = User.create(validProps(), today());
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.fullName()).toBe('Ivo Petrov');
      expect(result.value.roles).toEqual(['client']);
      expect(result.value.isStaff()).toBe(false);
    }
  });

  it('allows omitting the optional email and birth date', () => {
    const result = User.create(
      {
        id: 'uid_1',
        phone: '+359885550100',
        firstName: 'Ivo',
        lastName: 'Petrov',
        roles: ['barber'],
        status: AccountStatus.active(),
      },
      today(),
    );
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.email).toBeNull();
      expect(result.value.birthDate).toBeNull();
      expect(result.value.isStaff()).toBe(true);
    }
  });

  it('rejects an empty id', () => {
    expect(User.create({ ...validProps(), id: '' }, today()).isFailure()).toBe(
      true,
    );
  });

  it('rejects an invalid phone number', () => {
    expect(
      User.create(
        { ...validProps(), phone: 'not-a-phone' },
        today(),
      ).isFailure(),
    ).toBe(true);
  });

  it('rejects a first name below the minimum length', () => {
    expect(
      User.create({ ...validProps(), firstName: 'I' }, today()).isFailure(),
    ).toBe(true);
  });

  it('rejects a last name below the minimum length', () => {
    expect(
      User.create({ ...validProps(), lastName: 'P' }, today()).isFailure(),
    ).toBe(true);
  });

  it('rejects a malformed email when provided', () => {
    expect(
      User.create(
        { ...validProps(), email: 'not-an-email' },
        today(),
      ).isFailure(),
    ).toBe(true);
  });

  it('rejects an unknown role', () => {
    const result = User.create(
      { ...validProps(), roles: ['not-a-role'] },
      today(),
    );
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(
        result.error.some((e) => e.code === 'accounts.user_role.invalid'),
      ).toBe(true);
    }
  });

  it('rejects an empty roles list', () => {
    const result = User.create({ ...validProps(), roles: [] }, today());
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(
        result.error.some((e) => e.code === 'accounts.user.roles_empty'),
      ).toBe(true);
    }
  });

  it('rejects a birth date implying an age below 16', () => {
    const result = User.create(
      { ...validProps(), birthDate: '2020-01-01' },
      today(),
    );
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(
        result.error.some((e) => e.code === 'accounts.birth_date.too_young'),
      ).toBe(true);
    }
  });

  it('collects multiple field errors at once', () => {
    const result = User.create(
      {
        ...validProps(),
        id: '',
        phone: 'not-a-phone',
        email: 'nope',
        roles: [],
      },
      today(),
    );
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.length).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('User.reconstitute', () => {
  it('accepts a stored birth date implying an age above 120', () => {
    const result = User.reconstitute(
      { ...validProps(), birthDate: '1800-01-01' },
      today(),
    );
    expect(result.isSuccess()).toBe(true);
  });

  it('still rejects a malformed field, e.g. an empty id', () => {
    expect(
      User.reconstitute({ ...validProps(), id: '' }, today()).isFailure(),
    ).toBe(true);
  });
});

describe('User.hasRole', () => {
  it('reports membership for a multi-role user', () => {
    const result = User.create(
      { ...validProps(), roles: ['barber', 'admin'] },
      today(),
    );
    if (result.isFailure())
      throw new Error('unexpected failure in test fixture');
    expect(result.value.hasRole('barber')).toBe(true);
    expect(result.value.hasRole('client')).toBe(false);
    expect(result.value.isStaff()).toBe(true);
  });
});
