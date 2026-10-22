import { describe, expect, it } from 'vitest';
import { AccountsErrorCode } from '@core/primitives';
import {
  ADMIN_ROLES,
  BOOK_ROLES,
  MONEY_ROLES,
  Role,
  STAFF_ROLES,
  USER_ROLES,
  isAdmin,
  isRole,
  isStaff,
  isStaffRole,
  knownRoles,
  mayBook,
  parseRole,
  seesMoney,
} from './role.data';

/*
 * The cases of libs/domain/accounts/src/lib/user-role.spec.ts, copied (not
 * moved — the accounts barrel keeps exporting user-role.ts until Phase 4)
 * and run against the `Role` dictionary: `isUserRole` → `isRole`,
 * `worksTheBook` → `mayBook`, `handlesMoney` → `seesMoney`.
 */

describe('isRole', () => {
  it('narrows known roles and rejects strangers', () => {
    expect(isRole('client')).toBe(true);
    expect(isRole('sysadmin')).toBe(true);
    expect(isRole('barber')).toBe(true);
    expect(isRole('customer')).toBe(false);
    expect(isRole(42)).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });
});

describe('isStaffRole', () => {
  it('covers barber / receptionist / content_manager / admin / sysadmin', () => {
    const staffRoles: Role[] = [
      Role.Barber,
      Role.Receptionist,
      Role.ContentManager,
      Role.Admin,
      Role.Sysadmin,
    ];
    for (const role of staffRoles) {
      expect(isStaffRole(role)).toBe(true);
    }
  });

  it('excludes client', () => {
    expect(isStaffRole(Role.Client)).toBe(false);
  });
});

describe('isStaff (set membership)', () => {
  it('is true if any held role is staff-tier', () => {
    expect(isStaff([Role.Client])).toBe(false);
    expect(isStaff([Role.Barber])).toBe(true);
    expect(isStaff([Role.Client, Role.Admin])).toBe(true);
  });

  it('a multi-role owner-barber still reads as staff', () => {
    const roles: Role[] = [Role.Barber, Role.Admin];
    expect(isStaff(roles)).toBe(true);
  });

  it('an empty role set is not staff', () => {
    expect(isStaff([])).toBe(false);
  });
});

describe('the dictionary and its derived lists', () => {
  it('keeps the stored role strings unchanged, each once', () => {
    expect([...USER_ROLES]).toEqual([
      'client',
      'barber',
      'receptionist',
      'content_manager',
      'admin',
      'sysadmin',
    ]);
    expect(new Set(USER_ROLES).size).toBe(USER_ROLES.length);
  });

  it('derives every group from the dictionary, all inside it', () => {
    for (const group of [STAFF_ROLES, BOOK_ROLES, MONEY_ROLES, ADMIN_ROLES]) {
      for (const role of group) expect(USER_ROLES).toContain(role);
    }
    expect(STAFF_ROLES).not.toContain(Role.Client);
    // The book is narrower than the staff area, money narrower than the book.
    expect(BOOK_ROLES).not.toContain(Role.ContentManager);
    expect(MONEY_ROLES).not.toContain(Role.Barber);
    // The admin area is the narrowest: an admin or the sysadmin.
    expect(ADMIN_ROLES).toEqual([Role.Admin, Role.Sysadmin]);
  });
});

describe('mayBook / seesMoney / isAdmin (claims-tolerant)', () => {
  it('mayBook admits the book roles only', () => {
    expect(mayBook(['barber'])).toBe(true);
    expect(mayBook(['client', 'receptionist'])).toBe(true);
    expect(mayBook(['content_manager'])).toBe(false);
    expect(mayBook(['client'])).toBe(false);
    expect(mayBook([])).toBe(false);
  });

  it('seesMoney admits the front desk and the owners, never a barber', () => {
    expect(seesMoney(['receptionist'])).toBe(true);
    expect(seesMoney(['admin'])).toBe(true);
    expect(seesMoney(['sysadmin'])).toBe(true);
    expect(seesMoney(['barber'])).toBe(false);
    expect(seesMoney(['content_manager'])).toBe(false);
  });

  it('an unrecognised claim grants nothing', () => {
    expect(mayBook(['owner', 'superuser'])).toBe(false);
    expect(seesMoney(['owner'])).toBe(false);
    expect(isAdmin(['owner', 'superuser'])).toBe(false);
  });

  it('isAdmin admits exactly the admin pair — the rules’ isAdmin()', () => {
    expect(isAdmin(['admin'])).toBe(true);
    expect(isAdmin(['sysadmin'])).toBe(true);
    expect(isAdmin(['client', 'admin'])).toBe(true);
    expect(isAdmin(['barber', 'receptionist', 'content_manager'])).toBe(false);
    expect(isAdmin(['client'])).toBe(false);
    expect(isAdmin([])).toBe(false);
  });
});

describe('parseRole / knownRoles', () => {
  it('parseRole accepts a known role', () => {
    expect(parseRole('admin')).toEqual({ ok: true, value: 'admin' });
  });

  it('parseRole refuses a stranger with the accounts code', () => {
    expect(parseRole('customer')).toEqual({
      ok: false,
      error: {
        errorCode: AccountsErrorCode.UserRoleInvalid,
        attempted: 'customer',
      },
    });
  });

  it('knownRoles keeps known roles in order, once each, and drops the rest', () => {
    expect(
      knownRoles(['barber', 'owner', 7, null, 'admin', 'barber', '']),
    ).toEqual(['barber', 'admin']);
    expect(knownRoles([])).toEqual([]);
  });
});
