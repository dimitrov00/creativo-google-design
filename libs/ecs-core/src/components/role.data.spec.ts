import { describe, expect, it } from 'vitest';
import { Role } from './role.data';
import { Roles } from './roles.data';

/*
 * The cases of the legacy accounts `user-role.spec.ts` (deleted in Phase 4b;
 * ledger `docs/architecture/flips/phase-4b-delete.md` §11.1), copied while the
 * accounts barrel still exported `user-role.ts`, and run against the `Role`
 * dictionary: `isUserRole` → `isRole`, `worksTheBook` → `mayBook`,
 * `handlesMoney` → `seesMoney`.
 */

describe('isRole', () => {
  it('narrows known roles and rejects strangers', () => {
    expect(Roles.isRole('client')).toBe(true);
    expect(Roles.isRole('sysadmin')).toBe(true);
    expect(Roles.isRole('barber')).toBe(true);
    expect(Roles.isRole('customer')).toBe(false);
    expect(Roles.isRole(42)).toBe(false);
    expect(Roles.isRole(undefined)).toBe(false);
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
      expect(Roles.isStaffRole(role)).toBe(true);
    }
  });

  it('excludes client', () => {
    expect(Roles.isStaffRole(Role.Client)).toBe(false);
  });
});

describe('isStaff (set membership)', () => {
  it('is true if any held role is staff-tier', () => {
    expect(Roles.isStaff([Role.Client])).toBe(false);
    expect(Roles.isStaff([Role.Barber])).toBe(true);
    expect(Roles.isStaff([Role.Client, Role.Admin])).toBe(true);
  });

  it('a multi-role owner-barber still reads as staff', () => {
    const roles: Role[] = [Role.Barber, Role.Admin];
    expect(Roles.isStaff(roles)).toBe(true);
  });

  it('an empty role set is not staff', () => {
    expect(Roles.isStaff([])).toBe(false);
  });
});

describe('the dictionary and its derived lists', () => {
  it('keeps the stored role strings unchanged, each once', () => {
    expect([...Roles.ALL]).toEqual([
      'client',
      'barber',
      'receptionist',
      'content_manager',
      'admin',
      'sysadmin',
    ]);
    expect(new Set(Roles.ALL).size).toBe(Roles.ALL.length);
  });

  it('derives every group from the dictionary, all inside it', () => {
    for (const group of [Roles.STAFF, Roles.BOOK, Roles.MONEY, Roles.ADMIN]) {
      for (const role of group) expect(Roles.ALL).toContain(role);
    }
    expect(Roles.STAFF).not.toContain(Role.Client);
    // The book is narrower than the staff area, money narrower than the book.
    expect(Roles.BOOK).not.toContain(Role.ContentManager);
    expect(Roles.MONEY).not.toContain(Role.Barber);
    // The admin area is the narrowest: an admin or the sysadmin.
    expect(Roles.ADMIN).toEqual([Role.Admin, Role.Sysadmin]);
  });
});

describe('mayBook / seesMoney / isAdmin (claims-tolerant)', () => {
  it('mayBook admits the book roles only', () => {
    expect(Roles.mayBook(['barber'])).toBe(true);
    expect(Roles.mayBook(['client', 'receptionist'])).toBe(true);
    expect(Roles.mayBook(['content_manager'])).toBe(false);
    expect(Roles.mayBook(['client'])).toBe(false);
    expect(Roles.mayBook([])).toBe(false);
  });

  it('seesMoney admits the front desk and the owners, never a barber', () => {
    expect(Roles.seesMoney(['receptionist'])).toBe(true);
    expect(Roles.seesMoney(['admin'])).toBe(true);
    expect(Roles.seesMoney(['sysadmin'])).toBe(true);
    expect(Roles.seesMoney(['barber'])).toBe(false);
    expect(Roles.seesMoney(['content_manager'])).toBe(false);
  });

  it('an unrecognised claim grants nothing', () => {
    expect(Roles.mayBook(['owner', 'superuser'])).toBe(false);
    expect(Roles.seesMoney(['owner'])).toBe(false);
    expect(Roles.isAdmin(['owner', 'superuser'])).toBe(false);
  });

  it('isAdmin admits exactly the admin pair — the rules’ isAdmin()', () => {
    expect(Roles.isAdmin(['admin'])).toBe(true);
    expect(Roles.isAdmin(['sysadmin'])).toBe(true);
    expect(Roles.isAdmin(['client', 'admin'])).toBe(true);
    expect(Roles.isAdmin(['barber', 'receptionist', 'content_manager'])).toBe(
      false,
    );
    expect(Roles.isAdmin(['client'])).toBe(false);
    expect(Roles.isAdmin([])).toBe(false);
  });
});

/*
 * Pass C (K-1, K-2): the staff client card's two role reads —
 * `roles.includes('admin')` before the money read (`client-card.store.spec.ts`:
 * the spend is the admin's only, `firestore.rules`' restricted/money) and
 * `!roles.includes('sysadmin')` for the client's own words (R15,
 * `visits-page.presenter.spec.ts`).
 */
describe('seesClientSpend / readsClientWords (claims-tolerant)', () => {
  it('seesClientSpend admits the admin ONLY — not the sysadmin, not the front desk', () => {
    expect(Roles.SPEND).toEqual([Role.Admin]);
    expect(Roles.seesClientSpend(['admin'])).toBe(true);
    expect(Roles.seesClientSpend(['barber', 'admin'])).toBe(true);
    expect(Roles.seesClientSpend(['sysadmin'])).toBe(false);
    expect(Roles.seesClientSpend(['receptionist'])).toBe(false);
    expect(Roles.seesClientSpend(['barber'])).toBe(false);
    expect(Roles.seesClientSpend([])).toBe(false);
    expect(Roles.seesClientSpend(['owner'])).toBe(false);
    // Narrower than the admin area on purpose.
    expect(Roles.isAdmin(['sysadmin'])).toBe(true);
  });

  it('readsClientWords keeps the client’s words from the sysadmin alone', () => {
    expect(Roles.readsClientWords(['admin'])).toBe(true);
    expect(Roles.readsClientWords(['receptionist'])).toBe(true);
    expect(Roles.readsClientWords(['barber'])).toBe(true);
    expect(Roles.readsClientWords([])).toBe(true);
    expect(Roles.readsClientWords(['sysadmin'])).toBe(false);
    expect(Roles.readsClientWords(['admin', 'sysadmin'])).toBe(false);
  });

  it('is pure: same roles → same answer, roles untouched', () => {
    const roles = Object.freeze(['receptionist', 'admin']);
    expect(Roles.seesClientSpend(roles)).toBe(Roles.seesClientSpend(roles));
    expect(Roles.readsClientWords(roles)).toBe(Roles.readsClientWords(roles));
    expect(roles).toEqual(['receptionist', 'admin']);
  });
});

describe('knownRoles', () => {
  it('knownRoles keeps known roles in order, once each, and drops the rest', () => {
    expect(
      Roles.known(['barber', 'owner', 7, null, 'admin', 'barber', '']),
    ).toEqual(['barber', 'admin']);
    expect(Roles.known([])).toEqual([]);
  });
});
