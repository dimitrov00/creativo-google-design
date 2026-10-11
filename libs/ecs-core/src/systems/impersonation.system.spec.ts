import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { GovernanceErrorCode } from '../components/governance-errors.data';
import {
  ImpersonationScope,
  parseImpersonationScope,
} from '../components/impersonation-scope.data';
import {
  EndReasonFields,
  ImpersonationEndReason,
  ImpersonationLifecycle,
  ImpersonationStatus,
} from '../components/impersonation-status.data';
import { Role } from '../components/role.data';
import type { ImpersonationSession } from '../entities/impersonation-session.entity';
import { ImpersonationSessionId, UserId } from '../primitives/ids.primitive';
import { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';
import { deepFreeze, unwrapErr, unwrapOk, utcMs } from '../testing';
import {
  ImpersonationSystem,
  type StartImpersonation,
} from './impersonation.system';

/*
 * The cases of libs/domain/governance/src/lib/impersonation-session.spec.ts,
 * COPIED and re-targeted: `ImpersonationSession.start/.reconstitute/.end/
 * .isExpired` → `ImpersonationSystem.start/.faults/.end/.isExpired`, ISO
 * instants → `UtcEpochMs`, the `Clock` → `nowUtcMs`, `isSuccess(r)` →
 * `r.ok`, the nested status → the flat lifecycle slice at the session's
 * root. The class spec keeps running against its shim. A raw scope string
 * is now refused at its own edge (`parseImpersonationScope`) before start.
 *
 * Also copied: the session math of libs/application/governance/src/lib/
 * use-cases/start-impersonation.use-case.spec.ts and
 * end-impersonation.use-case.spec.ts (the staff gate; `EXPIRED` vs
 * `ADMIN_ENDED` by the one expiry rule).
 */

const MINUTE = 60_000;
const STARTED = utcMs('2026-06-01T10:00:00Z');
/** `STARTED` plus `minutes` (negative: before it). */
const at = (minutes: number): UtcEpochMs =>
  UtcEpochMs.plusMs(STARTED, minutes * MINUTE);
/** 2026-06-01T10:15:00Z */
const EXPIRES = at(15);

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
    impersonationScope: ImpersonationScope.Read,
    reason: 'Investigating issue #1234',
    startedAtUtcMs: STARTED,
    expiresAtUtcMs: EXPIRES,
    ...overrides,
  };
}

const codesOf = (
  result: ReturnType<typeof ImpersonationSystem.start>,
): readonly string[] => unwrapErr(result).map((e) => e.errorCode);

describe('ImpersonationSystem.start', () => {
  it('builds an active session with the validated payload', () => {
    const session = unwrapOk(ImpersonationSystem.start(startProps()));
    expect(ImpersonationLifecycle.isActive(session)).toBe(true);
    expect(session.impersonationScope).toBe(ImpersonationScope.Read);
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
      codesOf(
        ImpersonationSystem.start(startProps({ expiresAtUtcMs: STARTED })),
      ),
    ).toContain(GovernanceErrorCode.ImpersonationInvalidExpiry);
    expect(
      ImpersonationSystem.start(startProps({ expiresAtUtcMs: at(-60) })).ok,
    ).toBe(false);
  });

  it('rejects an invalid scope — at its edge, before start', () => {
    expect(unwrapErr(parseImpersonationScope('full'))).toEqual({
      errorCode: GovernanceErrorCode.ImpersonationScopeInvalid,
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
        errorCode: GovernanceErrorCode.ImpersonationAdminNotStaff,
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
            expiresAtUtcMs: STARTED,
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

function activeSession(): ImpersonationSession {
  return unwrapOk(
    ImpersonationSystem.start(
      startProps({
        impersonationScope: ImpersonationScope.Write,
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
        at(10),
        EndReasonFields.adminEnded(adminId),
      ),
    );
    expect(ImpersonationLifecycle.isActive(ended)).toBe(false);
    expect(ended.impersonationStatus).toBe(ImpersonationStatus.Ended);
  });

  it('fails when ending an already-ended session', () => {
    const first = unwrapOk(
      ImpersonationSystem.end(
        activeSession(),
        at(10),
        EndReasonFields.expired(),
      ),
    );
    expect(
      unwrapErr(
        ImpersonationSystem.end(
          first,
          at(11),
          EndReasonFields.adminEnded(adminId),
        ),
      ),
    ).toEqual({
      errorCode: GovernanceErrorCode.ImpersonationAlreadyEnded,
      sessionId: 'sess-1',
    });
  });
});

describe('ImpersonationSystem.isExpired — boundary conditions (blueprint §7.8 goal condition)', () => {
  const session = activeSession(); // expiresAt = 2026-06-01T10:15:00Z

  it('is false just before expiresAt', () => {
    expect(
      ImpersonationSystem.isExpired(session, UtcEpochMs.plusMs(EXPIRES, -1)),
    ).toBe(false);
  });

  it('is true exactly at expiresAt', () => {
    expect(ImpersonationSystem.isExpired(session, EXPIRES)).toBe(true);
  });

  it('is true just after expiresAt', () => {
    expect(
      ImpersonationSystem.isExpired(session, UtcEpochMs.plusMs(EXPIRES, 1)),
    ).toBe(true);
  });
});

describe('ImpersonationSystem.faults (impersonation-session.spec.ts › reconstitute)', () => {
  const stored = (
    overrides: Partial<ImpersonationSession> = {},
  ): ImpersonationSession =>
    ({
      id: ImpersonationSessionId.of('sess-1'),
      adminUserId: adminId,
      targetUserId: targetId,
      impersonationScope: ImpersonationScope.Read,
      reason: 'Investigating issue #1234',
      startedAtUtcMs: STARTED,
      expiresAtUtcMs: EXPIRES,
      ...ImpersonationLifecycle.active(),
      ...overrides,
    }) as ImpersonationSession;

  it('rebuilds an active session without needing adminRoles', () => {
    expect(ImpersonationSystem.faults(stored())).toEqual([]);
  });

  it('rebuilds an ended session with its end reason', () => {
    const ended: ImpersonationSession = {
      ...stored(),
      impersonationStatus: ImpersonationStatus.Ended,
      endedAtUtcMs: at(10),
      ...EndReasonFields.expired(),
    };
    expect(ImpersonationSystem.faults(ended)).toEqual([]);
    expect(ImpersonationLifecycle.isActive(ended)).toBe(false);
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
    expect(ImpersonationLifecycle.isActive(session)).toBe(true);
  });

  it('rejects a non-staff impersonator', () => {
    expect(
      ImpersonationSystem.start(startProps({ adminRoles: CLIENT_ROLES })).ok,
    ).toBe(false);
  });

  it('ends an active session with an ADMIN_ENDED reason before expiry', () => {
    const ended = unwrapOk(
      ImpersonationSystem.endByAdmin(
        activeSession(),
        UserId.of('admin_1'),
        at(5),
      ),
    );
    expect(ended).toEqual({
      id: 'sess-1',
      adminUserId: 'admin-1',
      targetUserId: 'user-1',
      impersonationScope: 'WRITE',
      reason: 'fixing broken booking',
      startedAtUtcMs: STARTED,
      expiresAtUtcMs: EXPIRES,
      impersonationStatus: ImpersonationStatus.Ended,
      endedAtUtcMs: at(5),
      impersonationEndReason: ImpersonationEndReason.AdminEnded,
      endedByUserId: 'admin_1',
    });
  });

  it('tags the reason as EXPIRED when the window had already lapsed', () => {
    const ended = unwrapOk(
      ImpersonationSystem.endByAdmin(
        activeSession(),
        UserId.of('admin_1'),
        UtcEpochMs.plusMs(EXPIRES, 10 * MINUTE),
      ),
    );
    expect(
      ended.impersonationStatus === ImpersonationStatus.Ended &&
        ended.impersonationEndReason,
    ).toBe(ImpersonationEndReason.Expired);
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
            expiresAtUtcMs: at(length),
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
