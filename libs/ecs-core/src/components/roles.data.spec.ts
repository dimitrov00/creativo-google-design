import { describe, expect, it } from 'vitest';
import { deepFreeze } from '@core/testing';
import { Role } from './role.data';
import { Roles } from './roles.data';

/*
 * The data-subject grant (audit-hardening Phase 3, P3-RU-13): the client
 * export and erasure callables are the shop's admin's ALONE — not the
 * sysadmin (a support role), not the front desk, not a barber. The other
 * grant lists and predicates of `Roles` are pinned in `role.data.spec.ts`
 * and, against `firestore.rules`, in `role.rules-parity.spec.ts`.
 */

describe('Roles.PRIVACY — the data-subject requests’ grant', () => {
  it('is the admin alone, inside the dictionary and narrower than the admin area', () => {
    expect(Roles.PRIVACY).toEqual([Role.Admin]);
    for (const role of Roles.PRIVACY) expect(Roles.ALL).toContain(role);
    for (const role of Roles.PRIVACY) expect(Roles.ADMIN).toContain(role);
    expect(Roles.PRIVACY).not.toContain(Role.Sysadmin);
  });
});

describe('Roles.handlesClientPrivacy (claims-tolerant)', () => {
  it('admits the admin, alone or beside another role', () => {
    expect(Roles.handlesClientPrivacy([Role.Admin])).toBe(true);
    // A shop owner commonly holds `barber` AND `admin`.
    expect(Roles.handlesClientPrivacy([Role.Barber, Role.Admin])).toBe(true);
  });

  it('refuses the sysadmin, the barber, the front desk, the content manager and a client', () => {
    for (const role of [
      Role.Sysadmin,
      Role.Barber,
      Role.Receptionist,
      Role.ContentManager,
      Role.Client,
    ]) {
      expect(Roles.handlesClientPrivacy([role]), role).toBe(false);
    }
    // Every staff role but the admin, held together, still grants nothing.
    expect(
      Roles.handlesClientPrivacy([
        Role.Sysadmin,
        Role.Barber,
        Role.Receptionist,
        Role.ContentManager,
      ]),
    ).toBe(false);
  });

  it('an unrecognised claim or an empty set grants nothing', () => {
    expect(Roles.handlesClientPrivacy([])).toBe(false);
    expect(Roles.handlesClientPrivacy(['owner', 'ADMIN', ' admin'])).toBe(
      false,
    );
  });

  it('is pure: same roles → same answer, roles untouched', () => {
    const held = deepFreeze([Role.Barber, Role.Admin]);
    const first = Roles.handlesClientPrivacy(held);
    expect(Roles.handlesClientPrivacy(held)).toBe(first);
    expect(held).toEqual([Role.Barber, Role.Admin]);
  });
});

/*
 * The roles-change grant (security hardening S-WS-E, S-RU-14): `setRoles` is
 * the shop's admin's ALONE, and it may grant or take away every role but
 * the vendor's `sysadmin`.
 */

describe('Roles.ASSIGN / Roles.ASSIGNABLE — the roles change’s grant and its reach', () => {
  it('ASSIGN is the admin alone, narrower than the admin area', () => {
    expect(Roles.ASSIGN).toEqual([Role.Admin]);
    for (const role of Roles.ASSIGN) expect(Roles.ADMIN).toContain(role);
    expect(Roles.ASSIGN).not.toContain(Role.Sysadmin);
  });

  it('ASSIGNABLE is every role but the sysadmin, in dictionary order', () => {
    expect(Roles.ASSIGNABLE).toEqual(
      Roles.ALL.filter((role) => role !== Role.Sysadmin),
    );
    expect(Roles.ASSIGNABLE).toEqual([
      'client',
      'barber',
      'receptionist',
      'content_manager',
      'admin',
    ]);
  });
});

describe('Roles.ANALYTICS_* — who reads staff analytics', () => {
  it('lets a barber read their own and the admin read the shop, and never the sysadmin', () => {
    expect(Roles.ANALYTICS_SELF).toEqual(['barber']);
    expect(Roles.ANALYTICS_SHOP).toEqual(['admin']);
    expect(Roles.ANALYTICS_SHOP).not.toContain(Role.Sysadmin);
  });

  it('opens analytics for a barber or an admin, and for no other role set (claims-tolerant)', () => {
    expect(Roles.readsAnalytics([Role.Barber])).toBe(true);
    expect(Roles.readsAnalytics([Role.Admin])).toBe(true);
    expect(Roles.readsAnalytics([Role.Barber, Role.Admin])).toBe(true);
    for (const role of [
      Role.Client,
      Role.Receptionist,
      Role.ContentManager,
      Role.Sysadmin,
    ]) {
      expect(Roles.readsAnalytics([role])).toBe(false);
    }
    expect(Roles.readsAnalytics(['not-a-role'])).toBe(false);
  });
});

describe('Roles.assignsRoles (claims-tolerant)', () => {
  it('admits the admin, alone or beside another role', () => {
    expect(Roles.assignsRoles([Role.Admin])).toBe(true);
    expect(Roles.assignsRoles([Role.Barber, Role.Admin])).toBe(true);
  });

  it('refuses the sysadmin and every other role', () => {
    for (const role of [
      Role.Sysadmin,
      Role.Barber,
      Role.Receptionist,
      Role.ContentManager,
      Role.Client,
    ]) {
      expect(Roles.assignsRoles([role]), role).toBe(false);
    }
  });

  it('an unrecognised claim or an empty set grants nothing', () => {
    expect(Roles.assignsRoles([])).toBe(false);
    expect(Roles.assignsRoles(['owner', 'ADMIN', ' admin'])).toBe(false);
  });

  it('is pure: same roles → same answer, roles untouched', () => {
    const held = deepFreeze([Role.Barber, Role.Admin]);
    const first = Roles.assignsRoles(held);
    expect(Roles.assignsRoles(held)).toBe(first);
    expect(held).toEqual([Role.Barber, Role.Admin]);
  });
});
