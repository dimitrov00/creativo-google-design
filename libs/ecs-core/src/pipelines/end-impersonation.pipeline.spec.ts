import { describe, expect, it } from 'vitest';
import {
  Actor,
  EndReasonFields,
  ImpersonationEndReason,
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
import { GovernanceErrorCode } from '@core/errors';
import { Collections, type ImpersonationSession } from '@core/entities';
import { AuditSystem } from '@core/systems';
import {
  FIXTURE_NOW_UTC_MS,
  fixtureHash,
  impersonationSessionFixture,
  memoryStore,
  memoryTxPorts,
  pinnedNowUtcMs,
  recordingTelemetry,
  unwrapOk,
} from '@core/testing';
import {
  type EndImpersonationCommand,
  endImpersonation,
} from './end-impersonation.pipeline';

/*
 * `endImpersonation` (Phase 4a 4A-3 (4), §1.2) — the SAME caller gate as
 * the start, asked BEFORE any read (no session → unauthenticated, no admin
 * role → forbidden: `endByAdmin` checks neither, so the gate is what keeps
 * a signed-in stranger holding a session id from ending an admin's
 * session); then the session read by id in the transaction and ended on
 * the server's clock; the plan ONE `Set` of the whole ENDED body, never a
 * field transition, so the TTL adapter re-stamps `purgeAt` to
 * `endedAtUtcMs` + 30 d — and, in the same commit, the end's audit row
 * (audit-hardening WS-3, DEP-12). Carries the legacy `EndImpersonationUseCase`
 * spec's cases (admin end before expiry, expired end, unknown session).
 */

const ADMIN = UserId.of('u-admin');
const SESSION = ImpersonationSessionId.of('imp-1');
const PATH = [Collections.ImpersonationSessions, SESSION];

/** The stored body: the session minus `id`. */
function bodyOf(session: ImpersonationSession): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(session).filter(([key]) => key !== 'id'),
  );
}

function rig(
  sessions: readonly ImpersonationSession[],
  now: UtcEpochMs = UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, 5 * 60_000),
) {
  const store = memoryStore(
    sessions.map((session) => ({
      path: [Collections.ImpersonationSessions, session.id],
      body: bodyOf(session),
    })),
  );
  const tx = memoryTxPorts(store, { nowUtcMs: pinnedNowUtcMs(now) });
  return {
    store,
    tx,
    run: endImpersonation({ ...tx, ...recordingTelemetry() }),
  };
}

/** The end's audit row as the plan `Create`s it, under `hash(basis)`. */
function auditCreateOf(
  ended: ImpersonationSession,
  actor: Actor,
  operationId: OperationId | null,
): WriteOp {
  const plan = AuditSystem.planImpersonationEnded(ended, actor, operationId);
  return WriteOp.create(
    [Collections.AuditLog, AuditEntryId.of(fixtureHash(plan.idBasis))],
    plan.row,
  );
}

const end = (
  extra: Partial<EndImpersonationCommand> = {},
): EndImpersonationCommand => ({
  sessionId: SESSION,
  adminUserId: ADMIN,
  adminRoles: [Role.Admin],
  operationId: null,
  ...extra,
});

describe('endImpersonation', () => {
  it('ends an active session ADMIN_ENDED before its expiry — ONE Set of the whole ENDED body and its audit row, one commit (DEP-12)', async () => {
    const at = UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, 5 * 60_000);
    const session = impersonationSessionFixture();
    const { tx, run } = rig([session], at);
    const answer = await run(end());
    expect(answer).toEqual(
      Result.ok({
        sessionId: SESSION,
        impersonationEndReason: ImpersonationEndReason.AdminEnded,
      }),
    );
    // The callable answers this value as it is (Law 5 — no wire encoder):
    // exactly these keys, in this order, byte for byte on the wire.
    expect(Object.keys(unwrapOk(answer))).toEqual([
      'sessionId',
      'impersonationEndReason',
    ]);
    const ended: ImpersonationSession = {
      ...session,
      impersonationStatus: ImpersonationStatus.Ended,
      endedAtUtcMs: at,
      ...EndReasonFields.adminEnded(ADMIN),
    };
    expect(tx.plans).toEqual([
      [
        WriteOp.set(PATH, {
          ...bodyOf(session),
          impersonationStatus: ImpersonationStatus.Ended,
          endedAtUtcMs: at,
          impersonationEndReason: ImpersonationEndReason.AdminEnded,
          endedByUserId: ADMIN,
        }),
        auditCreateOf(ended, Actor.admin(ADMIN), null),
      ],
    ]);
  });

  it('tags the reason EXPIRED when the window had already lapsed — on the session and on its row', async () => {
    const at = UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, 40 * 60_000);
    const { tx, run } = rig([impersonationSessionFixture()], at);
    expect(await run(end())).toEqual(
      Result.ok({
        sessionId: SESSION,
        impersonationEndReason: ImpersonationEndReason.Expired,
      }),
    );
    expect(tx.plans[0]?.[0]).toMatchObject({
      body: {
        impersonationStatus: ImpersonationStatus.Ended,
        endedAtUtcMs: at,
        impersonationEndReason: ImpersonationEndReason.Expired,
      },
    });
    expect(tx.plans[0]?.[1]).toMatchObject({
      body: {
        recordedAtUtcMs: at,
        auditAction: 'GOVERNANCE_IMPERSONATION_ENDED',
        impersonationEndReason: 'EXPIRED',
      },
    });
  });

  it('the row names the session resource, the impersonated account and the call’s operation id — never the reason', async () => {
    const op = OperationId.of('op-end-1');
    const reason = 'DISTINCTIVE-reason-text-8812';
    const session = impersonationSessionFixture({ reason });
    const { tx, run } = rig([session]);
    await run(end({ operationId: op }));
    expect(tx.plans[0]).toHaveLength(2);
    const auditOp = tx.plans[0]?.[1];
    expect(auditOp).toMatchObject({
      path: [Collections.AuditLog, expect.any(String)],
      body: {
        resourceId: `${Collections.ImpersonationSessions}/${SESSION}`,
        auditOperationId: op,
        impersonationSessionId: SESSION,
        impersonationScope: session.impersonationScope,
        impersonationExpiresAtUtcMs: session.expiresAtUtcMs,
        impersonationEndReason: 'ADMIN_ENDED',
        auditTarget: 'USER',
        targetUserId: session.targetUserId,
      },
    });
    expect(JSON.stringify(auditOp)).not.toContain(reason);
  });

  it('credits the sysadmin as STAFF with a role snapshot (RU-13)', async () => {
    const { tx, run } = rig([impersonationSessionFixture()]);
    await run(end({ adminRoles: [Role.Sysadmin] }));
    expect(tx.plans[0]?.[1]).toMatchObject({
      body: {
        actorRole: 'STAFF',
        actorUserId: ADMIN,
        actorRoles: ['sysadmin'],
      },
    });
  });

  it('reports an unknown session as not found, writing nothing', async () => {
    const { tx, run } = rig([]);
    expect(await run(end())).toEqual(
      Result.err({
        errorCode: GovernanceErrorCode.EndImpersonationNotFound,
        sessionId: SESSION,
      }),
    );
    expect(tx.plans).toEqual([]);
  });

  it('refuses a second end — the first end wins, before any plan: no audit op, no tripwire', async () => {
    const ended = impersonationSessionFixture({
      impersonationStatus: ImpersonationStatus.Ended,
      endedAtUtcMs: FIXTURE_NOW_UTC_MS,
      impersonationEndReason: ImpersonationEndReason.Expired,
    });
    const { tx, run } = rig([ended]);
    expect(await run(end())).toEqual(
      Result.err({
        errorCode: GovernanceErrorCode.ImpersonationAlreadyEnded,
        sessionId: SESSION,
      }),
    );
    expect(tx.plans).toEqual([]);
  });

  it('refuses no caller and a caller with no admin role with ZERO reads — the session untouched', async () => {
    const { store, tx, run } = rig([impersonationSessionFixture()]);
    const before = store.get(PATH.join('/'));
    expect(await run(end({ adminUserId: null }))).toEqual(
      Result.err({
        errorCode: GovernanceErrorCode.ImpersonationUnauthenticated,
      }),
    );
    expect(
      await run(
        end({ adminUserId: UserId.of('u-client'), adminRoles: [Role.Client] }),
      ),
    ).toEqual(
      Result.err({
        errorCode: GovernanceErrorCode.ImpersonationForbidden,
        callerUserId: UserId.of('u-client'),
      }),
    );
    expect(tx.transactions).toEqual([]);
    expect(store.get(PATH.join('/'))).toBe(before);
  });
});
