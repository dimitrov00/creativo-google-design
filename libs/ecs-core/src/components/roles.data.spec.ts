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
