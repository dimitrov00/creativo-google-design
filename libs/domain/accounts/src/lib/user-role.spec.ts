import { describe, expect, it } from 'vitest';
import { UserRole, isStaff, isStaffRole, isUserRole } from './user-role';

describe('isUserRole', () => {
  it('narrows known roles and rejects strangers', () => {
    expect(isUserRole('client')).toBe(true);
    expect(isUserRole('sysadmin')).toBe(true);
    expect(isUserRole('barber')).toBe(true);
    expect(isUserRole('customer')).toBe(false);
    expect(isUserRole(42)).toBe(false);
    expect(isUserRole(undefined)).toBe(false);
  });
});

describe('isStaffRole', () => {
  it('covers barber / receptionist / content_manager / admin / sysadmin', () => {
    const staffRoles: UserRole[] = [
      'barber',
      'receptionist',
      'content_manager',
      'admin',
      'sysadmin',
    ];
    for (const role of staffRoles) {
      expect(isStaffRole(role)).toBe(true);
    }
  });

  it('excludes client', () => {
    expect(isStaffRole('client')).toBe(false);
  });
});

describe('isStaff (set membership)', () => {
  it('is true if any held role is staff-tier', () => {
    expect(isStaff(['client'])).toBe(false);
    expect(isStaff(['barber'])).toBe(true);
    expect(isStaff(['client', 'admin'])).toBe(true);
  });

  it('a multi-role owner-barber still reads as staff', () => {
    const roles: UserRole[] = ['barber', 'admin'];
    expect(isStaff(roles)).toBe(true);
  });

  it('an empty role set is not staff', () => {
    expect(isStaff([])).toBe(false);
  });
});
