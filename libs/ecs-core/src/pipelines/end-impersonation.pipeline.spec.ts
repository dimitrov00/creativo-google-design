import { describe, expect, it } from 'vitest';
import {
  ImpersonationEndReason,
  ImpersonationStatus,
  Role,
  WriteOp,
} from '@core/components';
import {
  ImpersonationSessionId,
  Result,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import { GovernanceErrorCode } from '@core/errors';
import { Collections, type ImpersonationSession } from '@core/entities';
import {
  FIXTURE_NOW_UTC_MS,
  impersonationSessionFixture,
  memoryStore,
  memoryTxPorts,
  pinnedNowUtcMs,
  recordingTelemetry,
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
 * `endedAtUtcMs` + 30 d. Carries the legacy `EndImpersonationUseCase`
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

const end = (
  extra: Partial<EndImpersonationCommand> = {},
): EndImpersonationCommand => ({
  sessionId: SESSION,
  adminUserId: ADMIN,
  adminRoles: [Role.Admin],
  ...extra,
});

describe('endImpersonation', () => {
  it('ends an active session ADMIN_ENDED before its expiry — ONE Set of the whole ENDED body', async () => {
    const at = UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, 5 * 60_000);
    const session = impersonationSessionFixture();
    const { tx, run } = rig([session], at);
    expect(await run(end())).toEqual(
      Result.ok({
        sessionId: SESSION,
        impersonationEndReason: ImpersonationEndReason.AdminEnded,
      }),
    );
    expect(tx.plans).toEqual([
      [
        WriteOp.set(PATH, {
          ...bodyOf(session),
          impersonationStatus: ImpersonationStatus.Ended,
          endedAtUtcMs: at,
          impersonationEndReason: ImpersonationEndReason.AdminEnded,
          endedByUserId: ADMIN,
        }),
      ],
    ]);
  });

  it('tags the reason EXPIRED when the window had already lapsed', async () => {
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

  it('refuses a second end — the first end wins', async () => {
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
