import { describe, expect, it } from 'vitest';
import {
  ImpersonationScope,
  ImpersonationStatus,
  Role,
  WriteOp,
} from '@core/components';
import {
  GovernanceErrorCode,
  ImpersonationSessionId,
  RepositoryError,
  Result,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import { Collections } from '@core/entities';
import {
  FIXTURE_NOW_UTC_MS,
  memoryStore,
  memoryTxPorts,
  recordingTelemetry,
  sequentialIds,
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
 * ONE `Create` of the flat ACTIVE body. Carries the legacy
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
  ...extra,
});

describe('startImpersonation', () => {
  it('starts and writes ONE Create of the flat ACTIVE body for an admin — the id minted, the clock the server’s', async () => {
    const { tx, run } = rig();
    expect(await run(start({ reason: '  support ticket #123 ' }))).toEqual(
      Result.ok({ sessionId: ImpersonationSessionId.of('session-1') }),
    );
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
      ],
    ]);
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
