import { describe, expect, it } from 'vitest';
import {
  AccountLifecycle,
  Actor,
  BlockReason,
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
import {
  GovernanceErrorCode,
  PipelineError,
  PipelineErrorCode,
  RepositoryError,
} from '@core/errors';
import {
  Collections,
  type ImpersonationSession,
  type User,
} from '@core/entities';
import { AuditSystem, RegistrationSystem } from '@core/systems';
import {
  bodyOf,
  FIXTURE_NOW_UTC_MS,
  FIXTURE_TENANT_ID,
  fixedTenantPorts,
  fixtureHash,
  memoryStore,
  memoryTxPorts,
  provisionedUserFixture,
  recordingReadAsTokenPorts,
  recordingTelemetry,
  registeredUserFixture,
  sequentialIds,
  unwrapOk,
} from '@core/testing';
import {
  admitImpersonationCaller,
  type StartImpersonationCommand,
  startImpersonation,
} from './start-impersonation.pipeline';

/*
 * `startImpersonation` (Phase 4a 4A-3 (4); the support read-as, OR-24,
 * docs/designs/support-read-as.md) — the callable that replaced the admin's
 * direct write: the caller gate first (no session → unauthenticated, no
 * support role → forbidden, nothing written), then
 * `ImpersonationSystem.start` over a minted id and the server's clock (a
 * `READ` window of at most 15 minutes), and ONE commit of the flat ACTIVE
 * body's `Create` and its audit row's (audit-hardening WS-3, DEP-12); then
 * the read-as token, minted AFTER the commit for the target with the
 * target's own claims and the four read-as claims. Carries the legacy
 * `StartImpersonationUseCase` spec's cases. Since security hardening
 * S-DEP-3 the commit reads `users/{target}` and refuses an absent, erased
 * or never-registered target, so the rig seeds a registered target for
 * every start case. Since the owner's ruling of 2026-11-24 the caller is
 * the sysadmin alone: the shop's admin is refused.
 */

const SUPPORT = UserId.of('u-support');
const TARGET = UserId.of('u-client');
const IN_15_MINUTES = UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, 15 * 60_000);

/** The stored target every start case opens on unless it says otherwise. */
const REGISTERED_TARGET: User = registeredUserFixture({ id: TARGET });

/** The ports over a store holding `target` at `users/{TARGET}` (`null`: no document). */
function rig(target: User | null = REGISTERED_TARGET) {
  const tx = memoryTxPorts(
    memoryStore(
      target === null
        ? []
        : [{ path: [Collections.Users, TARGET], body: bodyOf(target) }],
    ),
    { nextId: sequentialIds('session') },
  );
  const telemetry = recordingTelemetry();
  const mint = recordingReadAsTokenPorts();
  return {
    tx,
    telemetry,
    mint,
    run: startImpersonation({
      ...tx,
      ...telemetry,
      ...fixedTenantPorts(),
      ...mint,
    }),
  };
}

const start = (
  extra: Partial<StartImpersonationCommand> = {},
): StartImpersonationCommand => ({
  adminUserId: SUPPORT,
  adminRoles: [Role.Sysadmin],
  targetUserId: TARGET,
  impersonationScope: ImpersonationScope.Read,
  reason: 'support ticket #123',
  expiresAtUtcMs: IN_15_MINUTES,
  operationId: null,
  ...extra,
});

/** The session the start writes, as the audit planner reads it. */
const SESSION: ImpersonationSession = {
  id: ImpersonationSessionId.of('session-1'),
  adminUserId: SUPPORT,
  targetUserId: TARGET,
  impersonationScope: ImpersonationScope.Read,
  reason: 'support ticket #123',
  startedAtUtcMs: FIXTURE_NOW_UTC_MS,
  expiresAtUtcMs: IN_15_MINUTES,
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
  it('commits the flat ACTIVE body and its audit row together, then answers the session and its read-as token (DEP-12, OR-24)', async () => {
    const { tx, run } = rig();
    const answer = await run(start({ reason: '  support ticket #123 ' }));
    expect(answer).toEqual(
      Result.ok({
        sessionId: ImpersonationSessionId.of('session-1'),
        customToken: `read-as:${TARGET}:1`,
      }),
    );
    // The callable answers this value as it is (Law 5 — no wire encoder):
    // exactly these keys, in this order, byte for byte on the wire.
    expect(Object.keys(unwrapOk(answer))).toEqual(['sessionId', 'customToken']);
    expect(tx.plans).toEqual([
      [
        WriteOp.create([Collections.ImpersonationSessions, 'session-1'], {
          adminUserId: SUPPORT,
          targetUserId: TARGET,
          impersonationScope: ImpersonationScope.Read,
          reason: 'support ticket #123',
          startedAtUtcMs: FIXTURE_NOW_UTC_MS,
          expiresAtUtcMs: IN_15_MINUTES,
          impersonationStatus: ImpersonationStatus.Active,
        }),
        auditCreateOf(Actor.forCaller(SUPPORT, [Role.Sysadmin]), null),
      ],
    ]);
  });

  it('mints the token for the TARGET, with the target’s own claims and the four read-as claims', async () => {
    const owner = registeredUserFixture({
      id: TARGET,
      roles: [Role.Client, Role.Barber, Role.Admin],
    });
    const { mint, run } = rig(owner);
    await run(start());
    expect(mint.minted).toEqual([
      {
        uid: TARGET,
        claims: RegistrationSystem.claimsFor(
          owner.registrationState,
          owner.roles,
          FIXTURE_TENANT_ID,
        ),
        readAs: {
          readAsSessionId: ImpersonationSessionId.of('session-1'),
          readAsByUserId: SUPPORT,
          readAsScope: ImpersonationScope.Read,
          readAsExpiresAtUtcMs: IN_15_MINUTES,
        },
        token: `read-as:${TARGET}:1`,
      },
    ]);
    expect(mint.minted[0]?.claims.roles).toEqual(
      expect.arrayContaining([Role.Admin, Role.Barber]),
    );
  });

  it('the row names the session resource, the impersonated account and the call’s operation id — never the reason; the sysadmin is STAFF (RU-13)', async () => {
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
        actorRole: 'STAFF',
        actorUserId: SUPPORT,
        actorRoles: ['sysadmin'],
        auditAction: 'GOVERNANCE_IMPERSONATION_STARTED',
        impersonationSessionId: 'session-1',
        impersonationScope: 'READ',
        impersonationExpiresAtUtcMs: IN_15_MINUTES,
        auditTarget: 'USER',
        targetUserId: TARGET,
      },
    });
    expect(JSON.stringify(auditOp)).not.toContain(reason);
  });

  it('refuses no caller as unauthenticated and a caller who is not support as forbidden — the shop’s admin included (ruling 2026-11-24) — before anything is written', async () => {
    const { tx, mint, run } = rig();
    expect(await run(start({ adminUserId: null }))).toEqual(
      Result.err({
        errorCode: GovernanceErrorCode.ImpersonationUnauthenticated,
      }),
    );
    for (const roles of [
      [Role.Client],
      [Role.Barber, Role.Receptionist],
      [Role.Admin],
      [Role.Barber, Role.Admin],
    ]) {
      expect(await run(start({ adminRoles: roles }))).toEqual(
        Result.err({
          errorCode: GovernanceErrorCode.ImpersonationForbidden,
          callerUserId: SUPPORT,
        }),
      );
    }
    expect(tx.transactions).toEqual([]);
    expect(mint.minted).toEqual([]);
  });

  it('answers the FIRST structural fault — self, then no reason, then no window — as one flat refusal, writing nothing', async () => {
    const { tx, run } = rig();
    const answer = await run(
      start({
        targetUserId: SUPPORT,
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

  it('offers READ alone, and a window of at most 15 minutes — nothing read, nothing written, no token', async () => {
    const { tx, mint, run } = rig();
    expect(
      await run(start({ impersonationScope: ImpersonationScope.Write })),
    ).toEqual(
      Result.err({
        errorCode: GovernanceErrorCode.ImpersonationScopeNotOffered,
      }),
    );
    expect(
      await run(start({ expiresAtUtcMs: UtcEpochMs.plusMs(IN_15_MINUTES, 1) })),
    ).toEqual(
      Result.err({
        errorCode: GovernanceErrorCode.ImpersonationWindowTooLong,
      }),
    );
    expect(tx.transactions).toEqual([]);
    expect(mint.minted).toEqual([]);
    // Exactly fifteen minutes is the cap, not past it.
    expect((await run(start({ expiresAtUtcMs: IN_15_MINUTES }))).ok).toBe(true);
  });

  it('reads the target’s account — the ONE read — inside the commit (S-RU-5)', async () => {
    const { tx, run } = rig();
    await run(start());
    expect(tx.transactions.map((t) => t.reads)).toEqual([
      [[Collections.Users, TARGET]],
    ]);
  });

  it('refuses a target with no account document as NOT_FOUND — nothing committed, one refusal line, no token', async () => {
    const { tx, telemetry, mint, run } = rig(null);
    expect(await run(start())).toEqual(
      Result.err({
        errorCode: GovernanceErrorCode.ImpersonationTargetNotFound,
        targetUserId: TARGET,
      }),
    );
    expect(tx.plans).toEqual([]);
    expect(mint.minted).toEqual([]);
    expect(telemetry.lines).toEqual([
      {
        level: 'info',
        msg: 'impersonation.start.refused',
        fields: {
          errorCode: GovernanceErrorCode.ImpersonationTargetNotFound,
        },
      },
    ]);
  });

  it('refuses an ERASED target — no session, no audit row', async () => {
    const { tx, telemetry, run } = rig(
      registeredUserFixture({
        id: TARGET,
        ...AccountLifecycle.erase(FIXTURE_NOW_UTC_MS),
      }),
    );
    expect(await run(start())).toEqual(
      Result.err({
        errorCode: GovernanceErrorCode.ImpersonationTargetErased,
        targetUserId: TARGET,
      }),
    );
    expect(tx.plans).toEqual([]);
    expect(telemetry.lines.map((line) => line.msg)).toEqual([
      'impersonation.start.refused',
    ]);
  });

  it('refuses a PROVISIONED stub that never finished registering — nothing written', async () => {
    const { tx, telemetry, run } = rig(provisionedUserFixture({ id: TARGET }));
    expect(await run(start())).toEqual(
      Result.err({
        errorCode: GovernanceErrorCode.ImpersonationTargetNotRegistered,
        targetUserId: TARGET,
      }),
    );
    expect(tx.plans).toEqual([]);
    expect(telemetry.lines).toEqual([
      {
        level: 'info',
        msg: 'impersonation.start.refused',
        fields: {
          errorCode: GovernanceErrorCode.ImpersonationTargetNotRegistered,
        },
      },
    ]);
  });

  it('still starts on a BLOCKED target (S-L-13)', async () => {
    const { tx, run } = rig(
      registeredUserFixture({
        id: TARGET,
        ...AccountLifecycle.block(BlockReason.Manual, null),
      }),
    );
    expect(await run(start())).toEqual(
      Result.ok({
        sessionId: ImpersonationSessionId.of('session-1'),
        customToken: `read-as:${TARGET}:1`,
      }),
    );
    expect(tx.plans).toHaveLength(1);
  });

  it('refuses the caller gate and a self-impersonation BEFORE the target is read', async () => {
    const { tx, run } = rig(null);
    await run(start({ adminUserId: null }));
    await run(start({ adminRoles: [Role.Client] }));
    expect(
      await run(start({ targetUserId: SUPPORT, adminUserId: SUPPORT })),
    ).toEqual(Result.err({ errorCode: GovernanceErrorCode.ImpersonationSelf }));
    expect(tx.transactions).toEqual([]);
  });

  it('answers a commit failure as the commit answers it — and mints no token', async () => {
    const down = RepositoryError.writeFailed(null, 'deadline exceeded');
    const tx = memoryTxPorts(memoryStore([]));
    const mint = recordingReadAsTokenPorts();
    const run = startImpersonation({
      ...tx,
      ...recordingTelemetry(),
      ...fixedTenantPorts(),
      ...mint,
      commit: async () => Result.err(down),
    });
    expect(await run(start())).toEqual(Result.err(down));
    expect(mint.minted).toEqual([]);
  });

  it('answers Auth failing to mint as the port answers it — the audited session stays, unusable, until it expires', async () => {
    const failed = PipelineError.bare(PipelineErrorCode.Unavailable);
    const { tx, telemetry } = rig();
    const run = startImpersonation({
      ...tx,
      ...telemetry,
      ...fixedTenantPorts(),
      mintReadAsToken: async () => Result.err(failed),
    });
    expect(await run(start())).toEqual(Result.err(failed));
    expect(tx.plans).toHaveLength(1);
  });
});

describe('admitImpersonationCaller — the gate both callables share', () => {
  it('admits exactly the verified callers whose roles hold the support role (`Roles.SUPPORT`, the sysadmin alone)', () => {
    expect(admitImpersonationCaller(SUPPORT, [Role.Sysadmin])).toEqual(
      Result.ok(SUPPORT),
    );
    for (const roles of [[Role.Admin], [Role.ContentManager]]) {
      expect(admitImpersonationCaller(SUPPORT, roles)).toEqual(
        Result.err({
          errorCode: GovernanceErrorCode.ImpersonationForbidden,
          callerUserId: SUPPORT,
        }),
      );
    }
    expect(admitImpersonationCaller(null, [Role.Sysadmin])).toEqual(
      Result.err({
        errorCode: GovernanceErrorCode.ImpersonationUnauthenticated,
      }),
    );
  });
});
