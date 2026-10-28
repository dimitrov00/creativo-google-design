import { describe, expect, it } from 'vitest';
import {
  Actor,
  ImpersonationScope,
  ImpersonationStatus,
  Role,
  WriteOp,
} from '@core/components';
import {
  AuditEntryId,
  ImpersonationSessionId,
  OperationId,
  Result,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import { GovernanceErrorCode, RepositoryError } from '@core/errors';
import { Collections, type ImpersonationSession } from '@core/entities';
import { AuditSystem } from '@core/systems';
import {
  FIXTURE_NOW_UTC_MS,
  fixtureHash,
  memoryStore,
  memoryTxPorts,
  recordingTelemetry,
  sequentialIds,
  unwrapOk,
} from '@core/testing';
import {
  admitImpersonationCaller,
  type StartImpersonationCommand,
  startImpersonation,
} from './start-impersonation.pipeline';

/*
 * `startImpersonation` (Phase 4a 4A-3 (4)) — the callable that replaced the
 * admin's direct write: the caller gate first (no session → unauthenticated,
 * no admin role → forbidden, nothing written), then
 * `ImpersonationSystem.start` over a minted id and the server's clock, and
 * ONE commit of the flat ACTIVE body's `Create` and its audit row's
 * (audit-hardening WS-3, DEP-12). Carries the legacy
 * `StartImpersonationUseCase` spec's cases (a staff admin starts and saves;
 * a non-staff impersonator is refused, nothing saved).
 */

const ADMIN = UserId.of('u-admin');
const TARGET = UserId.of('u-client');
const IN_AN_HOUR = UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, 3_600_000);

function rig() {
  const tx = memoryTxPorts(memoryStore([]), {
    nextId: sequentialIds('session'),
  });
  const telemetry = recordingTelemetry();
  return { tx, telemetry, run: startImpersonation({ ...tx, ...telemetry }) };
}

const start = (
  extra: Partial<StartImpersonationCommand> = {},
): StartImpersonationCommand => ({
  adminUserId: ADMIN,
  adminRoles: [Role.Admin],
  targetUserId: TARGET,
  impersonationScope: ImpersonationScope.Write,
  reason: 'support ticket #123',
  expiresAtUtcMs: IN_AN_HOUR,
  operationId: null,
  ...extra,
});

/** The session the start writes, as the audit planner reads it. */
const SESSION: ImpersonationSession = {
  id: ImpersonationSessionId.of('session-1'),
  adminUserId: ADMIN,
  targetUserId: TARGET,
  impersonationScope: ImpersonationScope.Write,
  reason: 'support ticket #123',
  startedAtUtcMs: FIXTURE_NOW_UTC_MS,
  expiresAtUtcMs: IN_AN_HOUR,
  impersonationStatus: ImpersonationStatus.Active,
};

/** The start's audit row as the plan `Create`s it, under `hash(basis)`. */
function auditCreateOf(actor: Actor, operationId: OperationId | null): WriteOp {
  const plan = AuditSystem.planImpersonationStarted(
    SESSION,
    actor,
    operationId,
  );
  return WriteOp.create(
    [Collections.AuditLog, AuditEntryId.of(fixtureHash(plan.idBasis))],
    plan.row,
  );
}

describe('startImpersonation', () => {
  it('starts and commits the flat ACTIVE body and its audit row together — the id minted, the clock the server’s (DEP-12)', async () => {
    const { tx, run } = rig();
    const answer = await run(start({ reason: '  support ticket #123 ' }));
    expect(answer).toEqual(
      Result.ok({ sessionId: ImpersonationSessionId.of('session-1') }),
    );
    // The callable answers this value as it is (Law 5 — no wire encoder):
    // exactly these keys, in this order, byte for byte on the wire.
    expect(Object.keys(unwrapOk(answer))).toEqual(['sessionId']);
    expect(tx.plans).toEqual([
      [
        WriteOp.create([Collections.ImpersonationSessions, 'session-1'], {
          adminUserId: ADMIN,
          targetUserId: TARGET,
          impersonationScope: ImpersonationScope.Write,
          reason: 'support ticket #123',
          startedAtUtcMs: FIXTURE_NOW_UTC_MS,
          expiresAtUtcMs: IN_AN_HOUR,
          impersonationStatus: ImpersonationStatus.Active,
        }),
        auditCreateOf(Actor.admin(ADMIN), null),
      ],
    ]);
  });

  it('the row names the session resource, the impersonated account and the call’s operation id — never the reason', async () => {
    const op = OperationId.of('op-start-1');
    const reason = 'DISTINCTIVE-reason-text-5521';
    const { tx, run } = rig();
    await run(start({ reason, operationId: op }));
    const auditOp = tx.plans[0]?.[1];
    expect(auditOp).toMatchObject({
      path: [Collections.AuditLog, expect.any(String)],
      body: {
        recordedAtUtcMs: FIXTURE_NOW_UTC_MS,
        resourceId: `${Collections.ImpersonationSessions}/session-1`,
        auditOperationId: op,
        actorRole: 'ADMIN',
        actorAdminUserId: ADMIN,
        auditAction: 'GOVERNANCE_IMPERSONATION_STARTED',
        impersonationSessionId: 'session-1',
        impersonationScope: 'WRITE',
        impersonationExpiresAtUtcMs: IN_AN_HOUR,
        auditTarget: 'USER',
        targetUserId: TARGET,
      },
    });
    expect(JSON.stringify(auditOp)).not.toContain(reason);
  });

  it('credits the sysadmin as STAFF with a role snapshot, an admin as ADMIN (RU-13)', async () => {
    const { tx, run } = rig();
    await run(start({ adminRoles: [Role.Sysadmin] }));
    expect(tx.plans[0]?.[1]).toEqual(
      auditCreateOf(Actor.forCaller(ADMIN, [Role.Sysadmin]), null),
    );
    expect(tx.plans[0]?.[1]).toMatchObject({
      body: {
        actorRole: 'STAFF',
        actorUserId: ADMIN,
        actorRoles: ['sysadmin'],
      },
    });
  });

  it('refuses no caller as unauthenticated and a caller with no admin role as forbidden — before anything is written', async () => {
    const { tx, run } = rig();
    expect(await run(start({ adminUserId: null }))).toEqual(
      Result.err({
        errorCode: GovernanceErrorCode.ImpersonationUnauthenticated,
      }),
    );
    for (const roles of [[Role.Client], [Role.Barber, Role.Receptionist]]) {
      expect(await run(start({ adminRoles: roles }))).toEqual(
        Result.err({
          errorCode: GovernanceErrorCode.ImpersonationForbidden,
          callerUserId: ADMIN,
        }),
      );
    }
    expect(tx.transactions).toEqual([]);
  });

  it('admits the sysadmin as an admin', async () => {
    const { run } = rig();
    expect((await run(start({ adminRoles: [Role.Sysadmin] }))).ok).toBe(true);
  });

  it('answers the FIRST structural fault — self, then no reason, then no window — as one flat refusal, writing nothing', async () => {
    const { tx, run } = rig();
    const answer = await run(
      start({
        targetUserId: ADMIN,
        reason: '  ',
        expiresAtUtcMs: FIXTURE_NOW_UTC_MS,
      }),
    );
    expect(answer).toEqual(
      Result.err({ errorCode: GovernanceErrorCode.ImpersonationSelf }),
    );
    expect(
      await run(start({ reason: '  ', expiresAtUtcMs: FIXTURE_NOW_UTC_MS })),
    ).toEqual(
      Result.err({
        errorCode: GovernanceErrorCode.ImpersonationReasonRequired,
      }),
    );
    expect(await run(start({ expiresAtUtcMs: FIXTURE_NOW_UTC_MS }))).toEqual(
      Result.err({ errorCode: GovernanceErrorCode.ImpersonationInvalidExpiry }),
    );
    expect(tx.transactions).toEqual([]);
  });

  it('answers a commit failure as the commit answers it', async () => {
    const down = RepositoryError.writeFailed(null, 'deadline exceeded');
    const tx = memoryTxPorts(memoryStore([]));
    const run = startImpersonation({
      ...tx,
      ...recordingTelemetry(),
      commit: async () => Result.err(down),
    });
    expect(await run(start())).toEqual(Result.err(down));
  });
});

describe('admitImpersonationCaller — the gate both callables share', () => {
  it('admits exactly the verified callers whose roles hold an admin role (`isAdmin()`)', () => {
    expect(admitImpersonationCaller(ADMIN, [Role.Admin])).toEqual(
      Result.ok(ADMIN),
    );
    expect(admitImpersonationCaller(ADMIN, [Role.ContentManager])).toEqual(
      Result.err({
        errorCode: GovernanceErrorCode.ImpersonationForbidden,
        callerUserId: ADMIN,
      }),
    );
    expect(admitImpersonationCaller(null, [Role.Admin])).toEqual(
      Result.err({
        errorCode: GovernanceErrorCode.ImpersonationUnauthenticated,
      }),
    );
  });
});
