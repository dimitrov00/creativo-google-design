import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GovernanceErrorCode } from '../components/governance-errors.data';
import {
  ImpersonationScope,
  parseImpersonationScope,
} from '../components/impersonation-scope.data';
import {
  ImpersonationEndReason,
  ImpersonationEndReasonKind,
  ImpersonationState,
  ImpersonationStatus,
} from '../components/impersonation-status.data';
import { Role } from '../components/role.data';
import {
  type ImpersonationSessionEntity,
  ImpersonationSessionId,
} from '../entities/impersonation-session.entity';
import { UserId } from '../entities/user.entity';
import { deepFreeze, unwrapErr, unwrapOk } from '../testing';
import {
  ImpersonationSystem,
  type StartImpersonation,
} from './impersonation.system';

/*
 * The cases of libs/domain/governance/src/lib/impersonation-session.spec.ts,
 * COPIED and re-targeted: `ImpersonationSession.start/.reconstitute/.end/
 * .isExpired` → `ImpersonationSystem.start/.faults/.end/.isExpired`, ISO
 * instants → epoch ms, the `Clock` → `nowMs`, `isSuccess(r)` → `r.ok`. The
 * class spec keeps running against its shim. A raw scope string is now
 * refused at its own edge (`parseImpersonationScope`) before start.
 *
 * Also copied: the session math of libs/application/governance/src/lib/
 * use-cases/start-impersonation.use-case.spec.ts and
 * end-impersonation.use-case.spec.ts (the staff gate; `expired` vs
 * `admin_ended` by the one expiry rule).
 */

const MINUTE = 60_000;
/** 2026-06-01T10:00:00Z */
const STARTED = 1_780_308_000_000;
/** 2026-06-01T10:15:00Z */
const EXPIRES = STARTED + 15 * MINUTE;

const adminId = UserId.of('admin-1');
const targetId = UserId.of('user-1');
const STAFF_ROLES: readonly Role[] = [Role.Barber];
const CLIENT_ROLES: readonly Role[] = [Role.Client];

function startProps(
  overrides: Partial<StartImpersonation> = {},
): StartImpersonation {
  return {
    id: ImpersonationSessionId.of('sess-1'),
    adminUserId: adminId,
    adminRoles: STAFF_ROLES,
    targetUserId: targetId,
    scope: ImpersonationScope.Read,
    reason: 'Investigating issue #1234',
    startedAtMs: STARTED,
    expiresAtMs: EXPIRES,
    ...overrides,
  };
}

const codesOf = (
  result: ReturnType<typeof ImpersonationSystem.start>,
): readonly string[] => unwrapErr(result).map((e) => e.code);

describe('ImpersonationSystem.start', () => {
  it('builds an active session with the validated payload', () => {
    const session = unwrapOk(ImpersonationSystem.start(startProps()));
    expect(ImpersonationStatus.isActive(session.status)).toBe(true);
    expect(session.scope).toBe(ImpersonationScope.Read);
    expect(session.adminUserId).toBe(adminId);
    expect(session.targetUserId).toBe(targetId);
  });

  it('rejects self-impersonation', () => {
    expect(
      codesOf(ImpersonationSystem.start(startProps({ targetUserId: adminId }))),
    ).toContain(GovernanceErrorCode.ImpersonationSelf);
  });

  it('rejects an empty/whitespace reason', () => {
    expect(ImpersonationSystem.start(startProps({ reason: '' })).ok).toBe(
      false,
    );
    expect(ImpersonationSystem.start(startProps({ reason: '   ' })).ok).toBe(
      false,
    );
  });

  it('rejects expiresAt at-or-before startedAt', () => {
    expect(
      codesOf(ImpersonationSystem.start(startProps({ expiresAtMs: STARTED }))),
    ).toContain(GovernanceErrorCode.ImpersonationInvalidExpiry);
    expect(
      ImpersonationSystem.start(
        startProps({ expiresAtMs: STARTED - 60 * MINUTE }),
      ).ok,
    ).toBe(false);
  });

  it('rejects an invalid scope — at its edge, before start', () => {
    expect(unwrapErr(parseImpersonationScope('full'))).toEqual({
      code: GovernanceErrorCode.ImpersonationScopeInvalid,
      attempted: 'full',
    });
  });

  it('rejects an admin whose roles are not staff-tier (blueprint §7.8 gate)', () => {
    expect(
      unwrapErr(
        ImpersonationSystem.start(startProps({ adminRoles: CLIENT_ROLES })),
      ),
    ).toEqual([
      {
        code: GovernanceErrorCode.ImpersonationAdminNotStaff,
        adminUserId: 'admin-1',
      },
    ]);
  });

  it('collects structural errors alongside the staff-role gate', () => {
    // Structural failures short-circuit before the staff-role check runs —
    // only the structural error surfaces.
    expect(
      codesOf(
        ImpersonationSystem.start(
          startProps({ adminRoles: CLIENT_ROLES, reason: '' }),
        ),
      ),
    ).toEqual([GovernanceErrorCode.ImpersonationReasonRequired]);
  });

  it('reports every structural fault at once, in order, and trims the reason it keeps', () => {
    expect(
      codesOf(
        ImpersonationSystem.start(
          startProps({
            targetUserId: adminId,
            reason: ' ',
            expiresAtMs: STARTED,
          }),
        ),
      ),
    ).toEqual([
      GovernanceErrorCode.ImpersonationSelf,
      GovernanceErrorCode.ImpersonationReasonRequired,
      GovernanceErrorCode.ImpersonationInvalidExpiry,
    ]);
    expect(
      unwrapOk(ImpersonationSystem.start(startProps({ reason: '  why  ' })))
        .reason,
    ).toBe('why');
  });
});

function activeSession(): ImpersonationSessionEntity {
  return unwrapOk(
    ImpersonationSystem.start(
      startProps({
        scope: ImpersonationScope.Write,
        reason: 'fixing broken booking',
      }),
    ),
  );
}

describe('ImpersonationSystem.end', () => {
  it('transitions active to ended with the supplied reason', () => {
    const ended = unwrapOk(
      ImpersonationSystem.end(
        activeSession(),
        STARTED + 10 * MINUTE,
        ImpersonationEndReason.adminEnded(adminId),
      ),
    );
    expect(ImpersonationStatus.isActive(ended.status)).toBe(false);
    expect(ended.status.kind).toBe(ImpersonationState.Ended);
  });

  it('fails when ending an already-ended session', () => {
    const first = unwrapOk(
      ImpersonationSystem.end(
        activeSession(),
        STARTED + 10 * MINUTE,
        ImpersonationEndReason.expired(),
      ),
    );
    expect(
      unwrapErr(
        ImpersonationSystem.end(
          first,
          STARTED + 11 * MINUTE,
          ImpersonationEndReason.adminEnded(adminId),
        ),
      ),
    ).toEqual({
      code: GovernanceErrorCode.ImpersonationAlreadyEnded,
      sessionId: 'sess-1',
    });
  });
});

describe('ImpersonationSystem.isExpired — boundary conditions (blueprint §7.8 goal condition)', () => {
  const session = activeSession(); // expiresAt = 2026-06-01T10:15:00Z

  it('is false just before expiresAt', () => {
    expect(ImpersonationSystem.isExpired(session, EXPIRES - 1)).toBe(false);
  });

  it('is true exactly at expiresAt', () => {
    expect(ImpersonationSystem.isExpired(session, EXPIRES)).toBe(true);
  });

  it('is true just after expiresAt', () => {
    expect(ImpersonationSystem.isExpired(session, EXPIRES + 1)).toBe(true);
  });
});

describe('ImpersonationSystem.faults (impersonation-session.spec.ts › reconstitute)', () => {
  const stored = (
    overrides: Partial<ImpersonationSessionEntity> = {},
  ): ImpersonationSessionEntity => ({
    id: ImpersonationSessionId.of('sess-1'),
    adminUserId: adminId,
    targetUserId: targetId,
    scope: ImpersonationScope.Read,
    reason: 'Investigating issue #1234',
    startedAtMs: STARTED,
    expiresAtMs: EXPIRES,
    status: ImpersonationStatus.active(),
    ...overrides,
  });

  it('rebuilds an active session without needing adminRoles', () => {
    expect(ImpersonationSystem.faults(stored())).toEqual([]);
  });

  it('rebuilds an ended session with its end reason', () => {
    const ended = stored({
      status: {
        kind: ImpersonationState.Ended,
        endedAtMs: STARTED + 10 * MINUTE,
        reason: ImpersonationEndReason.expired(),
      },
    });
    expect(ImpersonationSystem.faults(ended)).toEqual([]);
    expect(ImpersonationStatus.isActive(ended.status)).toBe(false);
  });

  it('still rejects structurally invalid persisted data (self-impersonation)', () => {
    expect(
      ImpersonationSystem.faults(stored({ targetUserId: adminId })).length,
    ).toBe(1);
  });
});

describe('ImpersonationSystem — the use cases (start/end-impersonation.use-case.spec.ts)', () => {
  it('starts a session for a staff admin', () => {
    const session = unwrapOk(ImpersonationSystem.start(startProps()));
    expect(ImpersonationStatus.isActive(session.status)).toBe(true);
  });

  it('rejects a non-staff impersonator', () => {
    expect(
      ImpersonationSystem.start(startProps({ adminRoles: CLIENT_ROLES })).ok,
    ).toBe(false);
  });

  it('ends an active session with an admin_ended reason before expiry', () => {
    const ended = unwrapOk(
      ImpersonationSystem.endByAdmin(
        activeSession(),
        UserId.of('admin_1'),
        STARTED + 5 * MINUTE,
      ),
    );
    expect(ended.status).toEqual({
      kind: ImpersonationState.Ended,
      endedAtMs: STARTED + 5 * MINUTE,
      reason: {
        kind: ImpersonationEndReasonKind.AdminEnded,
        endedBy: 'admin_1',
      },
    });
  });

  it('tags the reason as expired when the window had already lapsed', () => {
    const ended = unwrapOk(
      ImpersonationSystem.endByAdmin(
        activeSession(),
        UserId.of('admin_1'),
        EXPIRES + 10 * MINUTE,
      ),
    );
    expect(
      ended.status.kind === ImpersonationState.Ended &&
        ended.status.reason.kind,
    ).toBe(ImpersonationEndReasonKind.Expired);
  });
});

describe('ImpersonationSystem properties', () => {
  it('start succeeds exactly when the shape is sound and the admin is staff', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.constantFrom('', '  ', 'why'),
        fc.integer({ min: -2, max: 2 }),
        fc.subarray([...Object.values(Role)]),
        (self, reason, length, roles) => {
          const request = startProps({
            targetUserId: self ? adminId : targetId,
            reason,
            expiresAtMs: STARTED + length * MINUTE,
            adminRoles: roles,
          });
          const sound = !self && reason.trim() !== '' && length > 0;
          const staff = roles.some((r) => r !== Role.Client);
          expect(ImpersonationSystem.start(request).ok).toBe(sound && staff);
        },
      ),
    );
  });
});

describe('ImpersonationSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const request = deepFreeze(startProps());
    const session = deepFreeze(activeSession());
    const run = () => ({
      started: ImpersonationSystem.start(request),
      ended: ImpersonationSystem.endByAdmin(session, adminId, EXPIRES),
      expired: ImpersonationSystem.isExpired(session, EXPIRES),
    });
    expect(run()).toEqual(run());
    expect(session).toEqual(activeSession());
  });
});
