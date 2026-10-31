import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Result, UserId, UtcEpochMs } from '@core/primitives';
import { GovernanceErrorCode } from '@core/errors';
import { AccountLifecycle, BlockReason, Role, Roles } from '@core/components';
import type { User } from '@core/entities';
import {
  deepFreeze,
  provisionedUserFixture,
  registeredUserFixture,
  unwrapErr,
  unwrapOk,
  utcMs,
} from '@core/testing';
import {
  type RoleChange,
  RoleAssignmentSystem,
} from './role-assignment.system';

/*
 * The admin's roles change (security hardening S-WS-E: S-RU-11, S-RU-14,
 * S-L-15, S-L-18) — who may change roles, on whom, to what; and the card's
 * three questions (offer, change, save). The last-admin invariant is a
 * property case over every caller × target × requested set.
 */

const NOW = utcMs('2026-10-31T09:00:00Z');
const HOUR = 3_600_000;
const ADMIN_ID = UserId.of('u-admin');
const TARGET_ID = UserId.of('u-target');

/** The admin caller as stored: registered, `admin`, active. */
const adminUser = (overrides: Partial<User> = {}): User =>
  registeredUserFixture({ id: ADMIN_ID, roles: [Role.Admin], ...overrides });
/** The target as stored: a registered, active client. */
const targetUser = (overrides: Partial<User> = {}): User =>
  registeredUserFixture({ id: TARGET_ID, roles: [Role.Client], ...overrides });

type DecideInput = Parameters<typeof RoleAssignmentSystem.decide>[0];
const input = (overrides: Partial<DecideInput> = {}): DecideInput => ({
  callerUserId: ADMIN_ID,
  caller: adminUser(),
  target: targetUser(),
  targetUserId: TARGET_ID,
  requestedRoles: [Role.Client, Role.Barber],
  nowUtcMs: NOW,
  ...overrides,
});
const codeOf = (overrides: Partial<DecideInput>): string =>
  unwrapErr(RoleAssignmentSystem.decide(input(overrides))).errorCode;

describe('RoleAssignmentSystem.decide — admitted changes', () => {
  it('promotes a client to barber: the stored set before, the normalised set after, changed', () => {
    expect(RoleAssignmentSystem.decide(input())).toEqual(
      Result.ok({
        rolesFrom: ['client'],
        rolesTo: ['client', 'barber'],
        rolesChanged: true,
      }),
    );
  });

  it('normalises duplicates and order to dictionary order', () => {
    expect(
      unwrapOk(
        RoleAssignmentSystem.decide(
          input({
            requestedRoles: [
              Role.Admin,
              Role.Barber,
              Role.Client,
              Role.Barber,
              Role.Admin,
            ],
          }),
        ),
      ).rolesTo,
    ).toEqual(['client', 'barber', 'admin']);
  });

  it('the same set as stored is admitted, unchanged — whatever the order', () => {
    const stored = targetUser({ roles: [Role.Barber, Role.Client] });
    expect(
      unwrapOk(
        RoleAssignmentSystem.decide(
          input({
            target: stored,
            requestedRoles: [Role.Client, Role.Barber, Role.Client],
          }),
        ),
      ),
    ).toEqual({
      rolesFrom: ['barber', 'client'],
      rolesTo: ['client', 'barber'],
      rolesChanged: false,
    });
  });

  it('a demotion and an admin grant are admitted alike (every ASSIGNABLE role)', () => {
    const owner = targetUser({ roles: [Role.Barber, Role.Admin] });
    expect(
      unwrapOk(
        RoleAssignmentSystem.decide(
          input({ target: owner, requestedRoles: [Role.Barber] }),
        ),
      ),
    ).toEqual({
      rolesFrom: ['barber', 'admin'],
      rolesTo: ['barber'],
      rolesChanged: true,
    });
    expect(
      unwrapOk(
        RoleAssignmentSystem.decide(
          input({ requestedRoles: [...Roles.ASSIGNABLE] }),
        ),
      ).rolesTo,
    ).toEqual(Roles.ASSIGNABLE);
  });

  it('a blocked or a BLOCKED-until-past target is still admitted (only the caller’s block refuses)', () => {
    const blocked = targetUser(
      AccountLifecycle.block(BlockReason.Manual, null),
    );
    expect(RoleAssignmentSystem.decide(input({ target: blocked })).ok).toBe(
      true,
    );
  });

  it('a caller whose temporary block has lapsed is admitted (T2: the expiry compared at nowUtcMs)', () => {
    const lapsed = adminUser(
      AccountLifecycle.block(BlockReason.Manual, UtcEpochMs.plusMs(NOW, -HOUR)),
    );
    expect(RoleAssignmentSystem.decide(input({ caller: lapsed })).ok).toBe(
      true,
    );
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const frozen = deepFreeze(input());
    const once = RoleAssignmentSystem.decide(frozen);
    expect(RoleAssignmentSystem.decide(frozen)).toEqual(once);
    expect(frozen).toEqual(input());
  });
});

describe('RoleAssignmentSystem.decide — the caller', () => {
  it('refuses a caller with no stored account as FORBIDDEN, naming the caller', () => {
    expect(RoleAssignmentSystem.decide(input({ caller: null }))).toEqual(
      Result.err({
        errorCode: GovernanceErrorCode.RolesForbidden,
        callerUserId: ADMIN_ID,
      }),
    );
  });

  it('refuses stored roles without admin — the sysadmin and the front desk too', () => {
    for (const roles of [
      [Role.Sysadmin],
      [Role.Barber],
      [Role.Receptionist, Role.ContentManager],
      [Role.Client],
      [],
    ]) {
      expect(codeOf({ caller: adminUser({ roles }) }), roles.join()).toBe(
        GovernanceErrorCode.RolesForbidden,
      );
    }
  });

  it('refuses an admin blocked at nowUtcMs — indefinitely or until later', () => {
    for (const until of [null, UtcEpochMs.plusMs(NOW, HOUR)]) {
      const blocked = adminUser(
        AccountLifecycle.block(BlockReason.Manual, until),
      );
      expect(codeOf({ caller: blocked })).toBe(
        GovernanceErrorCode.RolesForbidden,
      );
    }
  });

  it('refuses an ERASED caller', () => {
    expect(codeOf({ caller: adminUser(AccountLifecycle.erase(NOW)) })).toBe(
      GovernanceErrorCode.RolesForbidden,
    );
  });

  it('refuses one’s own account as SELF — after the caller’s gate', () => {
    expect(
      RoleAssignmentSystem.decide(
        input({ targetUserId: ADMIN_ID, target: adminUser() }),
      ),
    ).toEqual(
      Result.err({
        errorCode: GovernanceErrorCode.RolesSelf,
        callerUserId: ADMIN_ID,
      }),
    );
    // A non-admin naming themselves is FORBIDDEN first.
    expect(
      codeOf({
        caller: adminUser({ roles: [Role.Barber] }),
        targetUserId: ADMIN_ID,
      }),
    ).toBe(GovernanceErrorCode.RolesForbidden);
  });
});

describe('RoleAssignmentSystem.decide — the target', () => {
  it('refuses no account document as TARGET_NOT_FOUND, naming the uid', () => {
    expect(RoleAssignmentSystem.decide(input({ target: null }))).toEqual(
      Result.err({
        errorCode: GovernanceErrorCode.RolesTargetNotFound,
        targetUserId: TARGET_ID,
      }),
    );
  });

  it('refuses an ERASED, a PROVISIONED and a sysadmin-holding account — each its own code', () => {
    expect(codeOf({ target: targetUser(AccountLifecycle.erase(NOW)) })).toBe(
      GovernanceErrorCode.RolesTargetErased,
    );
    expect(codeOf({ target: provisionedUserFixture({ id: TARGET_ID }) })).toBe(
      GovernanceErrorCode.RolesTargetNotRegistered,
    );
    expect(
      codeOf({ target: targetUser({ roles: [Role.Barber, Role.Sysadmin] }) }),
    ).toBe(GovernanceErrorCode.RolesTargetSysadmin);
  });

  it('asks in order: absent, ERASED, NOT_REGISTERED, SYSADMIN', () => {
    const erasedStub = provisionedUserFixture({
      id: TARGET_ID,
      roles: [Role.Sysadmin],
      ...AccountLifecycle.erase(NOW),
    });
    expect(codeOf({ target: erasedStub })).toBe(
      GovernanceErrorCode.RolesTargetErased,
    );
    const sysadminStub = provisionedUserFixture({
      id: TARGET_ID,
      roles: [Role.Sysadmin],
    });
    expect(codeOf({ target: sysadminStub })).toBe(
      GovernanceErrorCode.RolesTargetNotRegistered,
    );
  });
});

describe('RoleAssignmentSystem.decide — the requested set', () => {
  it('refuses an empty set, an unknown role and the sysadmin as INVALID', () => {
    expect(RoleAssignmentSystem.decide(input({ requestedRoles: [] }))).toEqual(
      Result.err({ errorCode: GovernanceErrorCode.RolesInvalid }),
    );
    expect(
      codeOf({ requestedRoles: [Role.Client, 'owner' as unknown as Role] }),
    ).toBe(GovernanceErrorCode.RolesInvalid);
    expect(codeOf({ requestedRoles: [Role.Barber, Role.Sysadmin] })).toBe(
      GovernanceErrorCode.RolesInvalid,
    );
  });

  it('judges the target before the set (a refused target answers its own code)', () => {
    expect(codeOf({ target: null, requestedRoles: [] })).toBe(
      GovernanceErrorCode.RolesTargetNotFound,
    );
  });
});

describe('RoleAssignmentSystem — the last-admin invariant (S-RU-11, property)', () => {
  const role = fc.constantFrom(...Roles.ALL);
  const roleSet = fc.array(role, { maxLength: 8 });
  const lifecycle = fc.constantFrom(
    AccountLifecycle.active(),
    AccountLifecycle.block(BlockReason.Manual, null),
    AccountLifecycle.block(BlockReason.Manual, UtcEpochMs.plusMs(NOW, HOUR)),
    AccountLifecycle.block(BlockReason.Manual, UtcEpochMs.plusMs(NOW, -HOUR)),
    AccountLifecycle.erase(NOW),
  );
  const account = (id: UserId) =>
    fc
      .option(
        fc.record({
          roles: roleSet,
          lifecycle,
          registered: fc.boolean(),
        }),
        { nil: null },
      )
      .map((shape): User | null =>
        shape === null
          ? null
          : shape.registered
            ? registeredUserFixture({
                id,
                roles: shape.roles,
                ...shape.lifecycle,
              })
            : provisionedUserFixture({
                id,
                roles: shape.roles,
                ...shape.lifecycle,
              }),
      );

  it('every admitted plan leaves the caller an admin not blocked at nowUtcMs — or the target holding admin', () => {
    fc.assert(
      fc.property(
        account(ADMIN_ID),
        account(TARGET_ID),
        fc.boolean(),
        roleSet,
        (caller, target, self, requestedRoles) => {
          const targetUserId = self ? ADMIN_ID : TARGET_ID;
          const decided = RoleAssignmentSystem.decide({
            callerUserId: ADMIN_ID,
            caller,
            target: self ? caller : target,
            targetUserId,
            requestedRoles,
            nowUtcMs: NOW,
          });
          if (!decided.ok) return;
          const callerAfter =
            targetUserId === ADMIN_ID
              ? decided.value.rolesTo
              : (caller as User).roles;
          const callerStillAdmin =
            callerAfter.includes(Role.Admin) &&
            !AccountLifecycle.isBlockedAt(caller as User, NOW);
          expect(
            callerStillAdmin || decided.value.rolesTo.includes(Role.Admin),
          ).toBe(true);
          // And the caller never touched their own account.
          expect(targetUserId).not.toBe(ADMIN_ID);
        },
      ),
    );
  });
});

describe('RoleAssignmentSystem.offerOf — may the card offer the «Роли» block (S-L-18)', () => {
  const admin = [Role.Admin] as const;

  it('offers it to an admin viewer on another registered, active account', () => {
    expect(RoleAssignmentSystem.offerOf(ADMIN_ID, admin, targetUser())).toBe(
      true,
    );
    expect(
      RoleAssignmentSystem.offerOf(
        ADMIN_ID,
        [Role.Barber, Role.Admin],
        targetUser({ roles: [Role.Barber, Role.Admin] }),
      ),
    ).toBe(true);
  });

  it('hides it for the viewer’s own account, a sysadmin subject, an ERASED or PROVISIONED subject, no subject', () => {
    expect(RoleAssignmentSystem.offerOf(ADMIN_ID, admin, adminUser())).toBe(
      false,
    );
    expect(
      RoleAssignmentSystem.offerOf(
        ADMIN_ID,
        admin,
        targetUser({ roles: [Role.Sysadmin] }),
      ),
    ).toBe(false);
    expect(
      RoleAssignmentSystem.offerOf(
        ADMIN_ID,
        admin,
        targetUser(AccountLifecycle.erase(NOW)),
      ),
    ).toBe(false);
    expect(
      RoleAssignmentSystem.offerOf(
        ADMIN_ID,
        admin,
        provisionedUserFixture({ id: TARGET_ID }),
      ),
    ).toBe(false);
    expect(RoleAssignmentSystem.offerOf(ADMIN_ID, admin, null)).toBe(false);
  });

  it('hides it from a viewer who does not assign roles — the sysadmin included', () => {
    for (const roles of [
      [Role.Sysadmin],
      [Role.Barber],
      [Role.Receptionist],
      [],
    ]) {
      expect(
        RoleAssignmentSystem.offerOf(ADMIN_ID, roles, targetUser()),
        roles.join(),
      ).toBe(false);
    }
  });
});

describe('RoleAssignmentSystem.changeOf — the requested set against the stored one', () => {
  it('normalises order and duplicates; a set equal to the stored one is unchanged', () => {
    expect(
      RoleAssignmentSystem.changeOf(
        [Role.Barber, Role.Client],
        [Role.Client, Role.Barber, Role.Barber],
      ),
    ).toEqual({
      rolesTo: ['client', 'barber'],
      rolesChanged: false,
      rolesEmpty: false,
    });
  });

  it('a different set is changed', () => {
    expect(
      RoleAssignmentSystem.changeOf([Role.Client], [Role.Admin, Role.Client]),
    ).toEqual({
      rolesTo: ['client', 'admin'],
      rolesChanged: true,
      rolesEmpty: false,
    });
    expect(
      RoleAssignmentSystem.changeOf([Role.Client, Role.Barber], [Role.Client])
        .rolesChanged,
    ).toBe(true);
  });

  it('an empty request is empty — and changed against a non-empty stored set', () => {
    expect(RoleAssignmentSystem.changeOf([Role.Client], [])).toEqual({
      rolesTo: [],
      rolesChanged: true,
      rolesEmpty: true,
    });
  });

  it('is pure: inputs untouched', () => {
    const stored = deepFreeze([Role.Barber, Role.Client]);
    const requested = deepFreeze([Role.Admin, Role.Client]);
    const once = RoleAssignmentSystem.changeOf(stored, requested);
    expect(RoleAssignmentSystem.changeOf(stored, requested)).toEqual(once);
    expect(stored).toEqual([Role.Barber, Role.Client]);
    expect(requested).toEqual([Role.Admin, Role.Client]);
  });
});

describe('RoleAssignmentSystem.saveOf — may the card send', () => {
  const change = (overrides: Partial<RoleChange>): RoleChange => ({
    rolesTo: [Role.Client],
    rolesChanged: true,
    rolesEmpty: false,
    ...overrides,
  });

  it('a changed, non-empty set may be sent', () => {
    expect(RoleAssignmentSystem.saveOf(change({}), false)).toBe(true);
  });

  it('an unchanged set may not — unless a failed revoke is pending its retry (S-RU-10)', () => {
    expect(
      RoleAssignmentSystem.saveOf(change({ rolesChanged: false }), false),
    ).toBe(false);
    expect(
      RoleAssignmentSystem.saveOf(change({ rolesChanged: false }), true),
    ).toBe(true);
  });

  it('an empty set never may — a pending revoke included', () => {
    const empty = change({ rolesTo: [], rolesEmpty: true });
    expect(RoleAssignmentSystem.saveOf(empty, false)).toBe(false);
    expect(RoleAssignmentSystem.saveOf(empty, true)).toBe(false);
  });
});
