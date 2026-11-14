import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BarberId, Result, UserId, UtcEpochMs } from '@core/primitives';
import { GovernanceErrorCode } from '@core/errors';
import {
  AccountLifecycle,
  BarberLinkRequest,
  BlockReason,
  Role,
  Roles,
} from '@core/components';
import { BARBER_LINK_DOC, type BarberLink, type User } from '@core/entities';
import {
  deepFreeze,
  provisionedUserFixture,
  registeredUserFixture,
  unwrapErr,
  unwrapOk,
  utcMs,
} from '@core/testing';
import {
  type BarberLinkFacts,
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

const IVAN = BarberId.of('ivan');
const NIKO = BarberId.of('niko');
const OTHER_ID = UserId.of('u-other');

/** A lock naming `linkedUserId` — `barbers/{id}/restricted/link`. */
const lockOf = (linkedUserId: UserId): BarberLink => ({
  id: BARBER_LINK_DOC,
  linkedUserId,
});
/** A SET's record exists and is free; the target is linked nowhere. */
const FREE: BarberLinkFacts = {
  requestedBarberExists: true,
  requestedLock: null,
  currentLock: null,
};
/** The link half of an admitted change that leaves the link as it was (none). */
const NO_LINK_CHANGE = {
  linkedBarberIdFrom: null,
  linkedBarberIdTo: null,
  linkChanged: false,
  lockReleased: null,
  lockTaken: null,
} as const;
/** The link half of a first link to `ivan`. */
const LINKED_IVAN = {
  linkedBarberIdFrom: null,
  linkedBarberIdTo: IVAN,
  linkChanged: true,
  lockReleased: null,
  lockTaken: IVAN,
} as const;

/**
 * The link request a roles-only case sends: a `SET` to the free record
 * `ivan` when the call grants the barber role (the role needs a record),
 * else `KEEP` — so the role cases keep their own intent.
 */
const linkFor = (
  target: User | null,
  requestedRoles: readonly Role[],
): BarberLinkRequest =>
  requestedRoles.includes(Role.Barber) &&
  !(target?.roles ?? []).includes(Role.Barber)
    ? BarberLinkRequest.set(IVAN)
    : BarberLinkRequest.KEEP;

type DecideInput = Parameters<typeof RoleAssignmentSystem.decide>[0];
const input = (overrides: Partial<DecideInput> = {}): DecideInput => {
  const target =
    overrides.target === undefined ? targetUser() : overrides.target;
  const requestedRoles = overrides.requestedRoles ?? [Role.Client, Role.Barber];
  return {
    callerUserId: ADMIN_ID,
    caller: adminUser(),
    target,
    targetUserId: TARGET_ID,
    requestedRoles,
    linkRequest: linkFor(target, requestedRoles),
    linkFacts: FREE,
    nowUtcMs: NOW,
    ...overrides,
  };
};
const codeOf = (overrides: Partial<DecideInput>): string =>
  unwrapErr(RoleAssignmentSystem.decide(input(overrides))).errorCode;

describe('RoleAssignmentSystem.decide — admitted changes', () => {
  it('promotes a client to barber: the stored set before, the normalised set after, changed', () => {
    expect(RoleAssignmentSystem.decide(input())).toEqual(
      Result.ok({
        rolesFrom: ['client'],
        rolesTo: ['client', 'barber'],
        rolesChanged: true,
        ...LINKED_IVAN,
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
      ...NO_LINK_CHANGE,
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
      ...NO_LINK_CHANGE,
    });
    expect(
      unwrapOk(
        RoleAssignmentSystem.decide(
          input({ requestedRoles: [...Roles.ASSIGNABLE] }),
        ),
      ).rolesTo,
    ).toEqual(Roles.ASSIGNABLE);
  });

  it('rolesFrom is the stored set’s known roles — an unknown string and a duplicate dropped, stored order kept (review round 1, finding 2)', () => {
    // `users` has no read guard: a console-written array reaches decide raw.
    const consoleWritten = targetUser({
      roles: [
        'receptionist',
        'frontdesk',
        'receptionist',
      ] as unknown as readonly Role[],
    });
    expect(
      RoleAssignmentSystem.decide(
        input({
          target: consoleWritten,
          requestedRoles: [Role.Receptionist, Role.Barber],
        }),
      ),
    ).toEqual(
      Result.ok({
        rolesFrom: ['receptionist'],
        rolesTo: ['barber', 'receptionist'],
        rolesChanged: true,
        ...LINKED_IVAN,
      }),
    );
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

  it('refuses one’s own account a set without admin as SELF — after the caller’s gate', () => {
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

describe('RoleAssignmentSystem.decide — the caller’s own account (staff permissions P9)', () => {
  /** The admin naming their own account: the stored account is both sides. */
  const own = (
    stored: User,
    overrides: Partial<DecideInput> = {},
  ): DecideInput =>
    input({
      caller: stored,
      target: stored,
      targetUserId: ADMIN_ID,
      ...overrides,
    });

  it('an owner who cuts hair adds barber and a link to their own account', () => {
    expect(
      RoleAssignmentSystem.decide(
        own(adminUser(), {
          requestedRoles: [Role.Admin, Role.Barber],
          linkRequest: BarberLinkRequest.set(IVAN),
        }),
      ),
    ).toEqual(
      Result.ok({
        rolesFrom: [Role.Admin],
        rolesTo: [Role.Barber, Role.Admin],
        rolesChanged: true,
        ...LINKED_IVAN,
      }),
    );
  });

  it('takes the barber role back off: the link cleared and its lock released', () => {
    const linked = adminUser({
      roles: [Role.Barber, Role.Admin],
      linkedBarberId: IVAN,
    });
    expect(
      RoleAssignmentSystem.decide(
        own(linked, {
          requestedRoles: [Role.Admin],
          linkRequest: BarberLinkRequest.KEEP,
          linkFacts: { ...FREE, currentLock: lockOf(ADMIN_ID) },
        }),
      ),
    ).toEqual(
      Result.ok({
        rolesFrom: [Role.Barber, Role.Admin],
        rolesTo: [Role.Admin],
        rolesChanged: true,
        linkedBarberIdFrom: IVAN,
        linkedBarberIdTo: null,
        linkChanged: true,
        lockReleased: IVAN,
        lockTaken: null,
      }),
    );
  });

  it('the stored set again is admitted, unchanged', () => {
    expect(
      unwrapOk(
        RoleAssignmentSystem.decide(
          own(adminUser(), { requestedRoles: [Role.Admin] }),
        ),
      ),
    ).toMatchObject({ rolesChanged: false, linkChanged: false });
  });

  it('never takes admin from oneself: every assignable set without it is SELF', () => {
    const linked = adminUser({
      roles: [Role.Barber, Role.Admin],
      linkedBarberId: IVAN,
    });
    for (const requestedRoles of [
      [Role.Barber],
      [Role.Client],
      [Role.Receptionist, Role.ContentManager],
    ]) {
      expect(
        RoleAssignmentSystem.decide(
          own(linked, { requestedRoles, linkRequest: BarberLinkRequest.KEEP }),
        ),
      ).toEqual(
        Result.err({
          errorCode: GovernanceErrorCode.RolesSelf,
          callerUserId: ADMIN_ID,
        }),
      );
    }
  });

  it('asks the set’s own rules first, and the target’s guards before them', () => {
    // An empty set and the sysadmin are INVALID, not SELF.
    expect(codeOf(own(adminUser(), { requestedRoles: [] }))).toBe(
      GovernanceErrorCode.RolesInvalid,
    );
    expect(
      codeOf(own(adminUser(), { requestedRoles: [Role.Admin, Role.Sysadmin] })),
    ).toBe(GovernanceErrorCode.RolesInvalid);
    // An admin who also holds the vendor's role is refused as any sysadmin target.
    expect(
      codeOf(
        own(adminUser({ roles: [Role.Admin, Role.Sysadmin] }), {
          requestedRoles: [Role.Admin],
        }),
      ),
    ).toBe(GovernanceErrorCode.RolesTargetSysadmin);
  });

  it('keeps the link rules: the barber role needs a record, and a record locked to another account is refused', () => {
    expect(
      codeOf(
        own(adminUser(), {
          requestedRoles: [Role.Admin, Role.Barber],
          linkRequest: BarberLinkRequest.KEEP,
        }),
      ),
    ).toBe(GovernanceErrorCode.RolesBarberLinkRequired);
    expect(
      codeOf(
        own(adminUser(), {
          requestedRoles: [Role.Admin, Role.Barber],
          linkRequest: BarberLinkRequest.set(IVAN),
          linkFacts: { ...FREE, requestedLock: lockOf(OTHER_ID) },
        }),
      ),
    ).toBe(GovernanceErrorCode.RolesBarberAlreadyLinked);
  });
});

describe('RoleAssignmentSystem.revokesSessions — whose sessions an admitted change ends', () => {
  it('ends another account’s sessions, never the caller’s own', () => {
    expect(RoleAssignmentSystem.revokesSessions(ADMIN_ID, TARGET_ID)).toBe(
      true,
    );
    expect(RoleAssignmentSystem.revokesSessions(ADMIN_ID, ADMIN_ID)).toBe(
      false,
    );
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

  it('every admitted plan leaves the caller an admin not blocked at nowUtcMs — their own account included', () => {
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
            linkRequest: linkFor(self ? caller : target, requestedRoles),
            linkFacts: FREE,
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
          // The caller is an admin after the plan — on another account
          // because theirs is untouched, on their own because the set
          // they asked for still holds it.
          expect(callerStillAdmin).toBe(true);
        },
      ),
    );
  });
});

describe('RoleAssignmentSystem.decide — the barber link (staff analytics, the setRoles table)', () => {
  /** A barber as stored, linked to `linked` (or not). */
  const barber = (
    linked: BarberId | null,
    roles: readonly Role[] = [Role.Barber],
  ): User => targetUser({ roles, linkedBarberId: linked });
  const decided = (overrides: Partial<DecideInput>) =>
    unwrapOk(RoleAssignmentSystem.decide(input(overrides)));

  it('roles unchanged + link unchanged → nothing to do (a retry of a committed link included)', () => {
    expect(
      decided({
        target: barber(IVAN),
        requestedRoles: [Role.Barber],
        linkRequest: BarberLinkRequest.KEEP,
        linkFacts: { ...FREE, currentLock: lockOf(TARGET_ID) },
      }),
    ).toMatchObject({
      rolesChanged: false,
      linkedBarberIdFrom: IVAN,
      linkedBarberIdTo: IVAN,
      linkChanged: false,
      lockReleased: null,
      lockTaken: null,
    });
    // The same SET sent again finds its own lock: nothing to do.
    const own = lockOf(TARGET_ID);
    expect(
      decided({
        target: barber(IVAN),
        requestedRoles: [Role.Barber],
        linkRequest: BarberLinkRequest.set(IVAN),
        linkFacts: {
          requestedBarberExists: true,
          requestedLock: own,
          currentLock: own,
        },
      }),
    ).toMatchObject({
      rolesChanged: false,
      linkChanged: false,
      lockTaken: null,
    });
  });

  it('roles unchanged + link set → link changed: the new lock taken', () => {
    expect(
      decided({
        target: barber(null),
        requestedRoles: [Role.Barber],
        linkRequest: BarberLinkRequest.set(IVAN),
      }),
    ).toEqual({
      rolesFrom: ['barber'],
      rolesTo: ['barber'],
      rolesChanged: false,
      ...LINKED_IVAN,
    });
  });

  it('roles unchanged + link changed (a relink) → the old lock released, the new one taken', () => {
    expect(
      decided({
        target: barber(IVAN),
        requestedRoles: [Role.Barber],
        linkRequest: BarberLinkRequest.set(NIKO),
        linkFacts: {
          requestedBarberExists: true,
          requestedLock: null,
          currentLock: lockOf(TARGET_ID),
        },
      }),
    ).toMatchObject({
      rolesChanged: false,
      linkedBarberIdFrom: IVAN,
      linkedBarberIdTo: NIKO,
      linkChanged: true,
      lockReleased: IVAN,
      lockTaken: NIKO,
    });
  });

  it('roles unchanged + link cleared (barber kept) → link changed: barber, not linked', () => {
    expect(
      decided({
        target: barber(IVAN),
        requestedRoles: [Role.Barber],
        linkRequest: BarberLinkRequest.CLEAR,
        linkFacts: { ...FREE, currentLock: lockOf(TARGET_ID) },
      }),
    ).toMatchObject({
      rolesTo: ['barber'],
      rolesChanged: false,
      linkedBarberIdFrom: IVAN,
      linkedBarberIdTo: null,
      linkChanged: true,
      lockReleased: IVAN,
      lockTaken: null,
    });
  });

  it('barber added + link set → roles and link changed', () => {
    expect(
      decided({
        target: targetUser(),
        requestedRoles: [Role.Client, Role.Barber],
        linkRequest: BarberLinkRequest.set(IVAN),
      }),
    ).toEqual({
      rolesFrom: ['client'],
      rolesTo: ['client', 'barber'],
      rolesChanged: true,
      ...LINKED_IVAN,
    });
  });

  it('barber added without a link (KEEP or CLEAR) → GOVERNANCE_ROLES_BARBER_LINK_REQUIRED, naming the account', () => {
    for (const linkRequest of [
      BarberLinkRequest.KEEP,
      BarberLinkRequest.CLEAR,
    ]) {
      expect(
        unwrapErr(
          RoleAssignmentSystem.decide(
            input({ requestedRoles: [Role.Client, Role.Barber], linkRequest }),
          ),
        ),
      ).toEqual({
        errorCode: GovernanceErrorCode.RolesBarberLinkRequired,
        targetUserId: TARGET_ID,
      });
    }
  });

  it('a link to a record that does not exist → GOVERNANCE_ROLES_BARBER_UNKNOWN (barber added or kept)', () => {
    const missing = { ...FREE, requestedBarberExists: false };
    for (const target of [targetUser(), barber(null)]) {
      expect(
        unwrapErr(
          RoleAssignmentSystem.decide(
            input({
              target,
              requestedRoles: [Role.Barber],
              linkRequest: BarberLinkRequest.set(NIKO),
              linkFacts: missing,
            }),
          ),
        ),
      ).toEqual({
        errorCode: GovernanceErrorCode.RolesBarberUnknown,
        barberId: NIKO,
      });
    }
  });

  it('a link on an account that will not hold the barber role → GOVERNANCE_ROLES_LINK_WITHOUT_BARBER (a removal included)', () => {
    for (const target of [targetUser(), barber(IVAN)]) {
      expect(
        unwrapErr(
          RoleAssignmentSystem.decide(
            input({
              target,
              requestedRoles: [Role.Client],
              linkRequest: BarberLinkRequest.set(IVAN),
            }),
          ),
        ),
      ).toEqual({
        errorCode: GovernanceErrorCode.RolesLinkWithoutBarber,
        targetUserId: TARGET_ID,
      });
    }
  });

  it('barber removed → roles changed and the link cleared, its lock released (KEEP or CLEAR)', () => {
    for (const linkRequest of [
      BarberLinkRequest.KEEP,
      BarberLinkRequest.CLEAR,
    ]) {
      expect(
        decided({
          target: barber(IVAN, [Role.Client, Role.Barber]),
          requestedRoles: [Role.Client],
          linkRequest,
          linkFacts: { ...FREE, currentLock: lockOf(TARGET_ID) },
        }),
      ).toEqual({
        rolesFrom: ['client', 'barber'],
        rolesTo: ['client'],
        rolesChanged: true,
        linkedBarberIdFrom: IVAN,
        linkedBarberIdTo: null,
        linkChanged: true,
        lockReleased: IVAN,
        lockTaken: null,
      });
    }
  });

  it('other roles changed + link unchanged → roles changed only', () => {
    expect(
      decided({
        target: barber(IVAN),
        requestedRoles: [Role.Barber, Role.Receptionist],
        linkRequest: BarberLinkRequest.KEEP,
        linkFacts: { ...FREE, currentLock: lockOf(TARGET_ID) },
      }),
    ).toMatchObject({
      rolesChanged: true,
      linkedBarberIdTo: IVAN,
      linkChanged: false,
      lockReleased: null,
      lockTaken: null,
    });
  });

  it('a record locked to another account → GOVERNANCE_ROLES_BARBER_ALREADY_LINKED — the lock decides', () => {
    for (const target of [targetUser(), barber(null), barber(NIKO)]) {
      expect(
        unwrapErr(
          RoleAssignmentSystem.decide(
            input({
              target,
              requestedRoles: [Role.Barber],
              linkRequest: BarberLinkRequest.set(IVAN),
              linkFacts: {
                requestedBarberExists: true,
                requestedLock: lockOf(OTHER_ID),
                currentLock: null,
              },
            }),
          ),
        ),
      ).toEqual({
        errorCode: GovernanceErrorCode.RolesBarberAlreadyLinked,
        barberId: IVAN,
      });
    }
  });

  it('never releases a lock that names another account (an inconsistent current lock is left alone)', () => {
    expect(
      decided({
        target: barber(IVAN),
        requestedRoles: [Role.Barber],
        linkRequest: BarberLinkRequest.set(NIKO),
        linkFacts: {
          requestedBarberExists: true,
          requestedLock: null,
          currentLock: lockOf(OTHER_ID),
        },
      }),
    ).toMatchObject({ linkChanged: true, lockReleased: null, lockTaken: NIKO });
  });

  it('reads an account written before the link existed as not linked (StaffLink.of)', () => {
    const older = Object.fromEntries(
      Object.entries(barber(null)).filter(([key]) => key !== 'linkedBarberId'),
    ) as unknown as User;
    expect(
      decided({
        target: older,
        requestedRoles: [Role.Barber],
        linkRequest: BarberLinkRequest.KEEP,
      }),
    ).toMatchObject({ linkedBarberIdFrom: null, linkChanged: false });
  });

  it('the self-target refusal and the role rules come before every link rule', () => {
    expect(
      codeOf({
        target: adminUser(),
        targetUserId: ADMIN_ID,
        linkRequest: BarberLinkRequest.set(IVAN),
        linkFacts: { ...FREE, requestedBarberExists: false },
      }),
    ).toBe(GovernanceErrorCode.RolesSelf);
    expect(
      codeOf({
        requestedRoles: [],
        linkRequest: BarberLinkRequest.set(IVAN),
        linkFacts: { ...FREE, requestedBarberExists: false },
      }),
    ).toBe(GovernanceErrorCode.RolesInvalid);
  });

  it('is pure: same input, same answer, inputs unchanged', () => {
    const frozen = deepFreeze(
      input({
        target: barber(IVAN),
        requestedRoles: [Role.Barber],
        linkRequest: BarberLinkRequest.set(NIKO),
        linkFacts: {
          requestedBarberExists: true,
          requestedLock: null,
          currentLock: lockOf(TARGET_ID),
        },
      }),
    );
    expect(RoleAssignmentSystem.decide(frozen)).toEqual(
      RoleAssignmentSystem.decide(frozen),
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

describe('RoleAssignmentSystem.cardLinkOf — the client card’s barber picker', () => {
  const link = RoleAssignmentSystem.cardLinkOf;
  const barber = [Role.Barber];
  const client = [Role.Client];

  it('asks nothing while the set Save would send holds no barber role', () => {
    expect(
      link({
        storedRoles: barber,
        rolesTo: client,
        storedLink: IVAN,
        picked: IVAN,
      }),
    ).toEqual({
      linkRequest: { barberLinkChange: 'KEEP', linkedBarberId: null },
      linkChanged: false,
      linkMissing: false,
      linkOffered: false,
    });
  });

  it('keeps the stored record, sets another, and clears an unticked one for a barber who stays', () => {
    expect(
      link({
        storedRoles: barber,
        rolesTo: barber,
        storedLink: IVAN,
        picked: IVAN,
      }),
    ).toMatchObject({ linkChanged: false, linkOffered: true });
    expect(
      link({
        storedRoles: barber,
        rolesTo: barber,
        storedLink: IVAN,
        picked: NIKO,
      }),
    ).toMatchObject({
      linkRequest: { barberLinkChange: 'SET', linkedBarberId: NIKO },
      linkChanged: true,
    });
    expect(
      link({
        storedRoles: barber,
        rolesTo: barber,
        storedLink: IVAN,
        picked: null,
      }),
    ).toMatchObject({
      linkRequest: { barberLinkChange: 'CLEAR', linkedBarberId: null },
      linkChanged: true,
      linkMissing: false,
    });
  });

  it('waits for a record when the barber role is being granted with none picked', () => {
    const granted = link({
      storedRoles: client,
      rolesTo: [Role.Client, Role.Barber],
      storedLink: null,
      picked: null,
    });
    expect(granted).toMatchObject({ linkMissing: true, linkOffered: true });
    const change = RoleAssignmentSystem.changeOf(client, [
      Role.Client,
      Role.Barber,
    ]);
    expect(RoleAssignmentSystem.saveOf(change, false, granted)).toBe(false);
    const picked = link({
      storedRoles: client,
      rolesTo: [Role.Client, Role.Barber],
      storedLink: null,
      picked: IVAN,
    });
    expect(RoleAssignmentSystem.saveOf(change, false, picked)).toBe(true);
  });

  it('lets a link-only change be saved with the role set unchanged', () => {
    const unchanged = RoleAssignmentSystem.changeOf(barber, barber);
    const relink = link({
      storedRoles: barber,
      rolesTo: barber,
      storedLink: IVAN,
      picked: NIKO,
    });
    expect(RoleAssignmentSystem.saveOf(unchanged, false)).toBe(false);
    expect(RoleAssignmentSystem.saveOf(unchanged, false, relink)).toBe(true);
  });
});
