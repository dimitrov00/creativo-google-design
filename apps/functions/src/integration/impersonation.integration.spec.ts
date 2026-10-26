import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import admin from 'firebase-admin';
import type { Firestore, Timestamp } from 'firebase-admin/firestore';
import {
  Actor,
  AuditAction,
  AuditTargetRef,
  ImpersonationEndReason,
  ImpersonationScope,
  Role,
} from '@core/components';
import {
  AuditResourceId,
  ImpersonationSessionId,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import { GovernanceErrorCode } from '@core/errors';
import { Collections } from '@core/entities';
import { StoredDocumentSystem } from '@core/systems';
import { endImpersonation, startImpersonation } from '@core/pipelines';
import {
  FIXTURE_NOW_UTC_MS,
  pinnedNowUtcMs,
  recordingTelemetry,
} from '@core/testing';
import { sha256Hex } from '../adapters/crypto.adapter';
import { firestoreCommitPlan } from '../adapters/firestore-tx.adapter';

/**
 * The impersonation callables' pipelines against the REAL Firestore
 * emulator (Phase 4a 4A-3 (4)) — the only writers of
 * `impersonationSessions` once the rules refused the admin's direct write:
 * a start writes ONE body whose TTL stamp is its expiry + 30 days; an end
 * writes ONE `Set` of the ENDED body, so the adapter RE-STAMPS `purgeAt` on
 * the end + 30 days (an `Update` would have kept the expiry's); a session
 * nobody holds is refused, nothing written. Since audit-hardening WS-3
 * (DEP-12) each start and each end also CREATES its audit row in the same
 * commit — credited to the admin, targeted at the impersonated user, on the
 * session's resource, never carrying the reason; the refusal writes none.
 *
 * Emulator-only by construction, on a demo project of its own.
 */
const PROJECT_ID = 'demo-functions-impersonation';

const FIRESTORE_HOST = (process.env['FIRESTORE_EMULATOR_HOST'] ??=
  '127.0.0.1:8080');
if (!FIRESTORE_HOST.includes('127.0.0.1')) {
  throw new Error('Refusing to run outside the local emulators.');
}

const DAY_MS = 86_400_000;
const OWNER = UserId.of('u-owner');
const CLIENT = UserId.of('u-client');
const SESSION = ImpersonationSessionId.of('imp-1');

/** An instant `ms` after the fixtures' pinned now. */
function after(ms: number): UtcEpochMs {
  const instant = UtcEpochMs.of(FIXTURE_NOW_UTC_MS + ms);
  if (!instant.ok) throw new Error('a broken fixture');
  return instant.value;
}

const EXPIRES = after(3_600_000);
const ENDED = after(600_000);

describe('startImpersonation / endImpersonation (emulator)', () => {
  let db: Firestore;

  beforeAll(() => {
    const app =
      admin.apps.find((a) => a?.name === PROJECT_ID) ??
      admin.initializeApp({ projectId: PROJECT_ID }, PROJECT_ID);
    db = app.firestore();
  });

  afterAll(async () => {
    await Promise.all(admin.apps.map((app) => app?.delete()));
  });

  beforeEach(async () => {
    await fetch(
      `http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
      { method: 'DELETE' },
    );
  });

  const ports = (nowUtcMs: UtcEpochMs = FIXTURE_NOW_UTC_MS) => {
    const telemetry = recordingTelemetry();
    return {
      commit: firestoreCommitPlan(
        db,
        StoredDocumentSystem.guardOf,
        telemetry.log,
      ),
      nowUtcMs: pinnedNowUtcMs(nowUtcMs),
      nextId: () => SESSION,
      hash: sha256Hex,
      ...telemetry,
    };
  };

  const stored = async () =>
    (
      await db.doc(`${Collections.ImpersonationSessions}/${SESSION}`).get()
    ).data();
  const auditRows = async () =>
    (await db.collection(Collections.AuditLog).get()).docs.map((row) =>
      row.data(),
    );
  /** What every row of this session names: who, about whom, on what. */
  const SESSION_ROW = {
    ...Actor.admin(OWNER),
    ...AuditTargetRef.user(CLIENT),
    resourceId: AuditResourceId.forImpersonationSession(SESSION),
    impersonationSessionId: SESSION,
    impersonationScope: ImpersonationScope.Read,
    impersonationExpiresAtUtcMs: EXPIRES,
    // No transport id was sent (RU-21): the row names no operation.
    auditOperationId: null,
  };
  const purgeAtOf = (body: Record<string, unknown> | undefined): number =>
    (body?.['purgeAt'] as Timestamp).toMillis();

  const start = () =>
    startImpersonation(ports())({
      adminUserId: OWNER,
      adminRoles: [Role.Admin],
      targetUserId: CLIENT,
      impersonationScope: ImpersonationScope.Read,
      reason: 'support ticket 42',
      expiresAtUtcMs: EXPIRES,
      // The optional transport id (RU-21): none sent.
      operationId: null,
    });

  it('starts ONE session, stamped to purge 30 days after its expiry', async () => {
    expect(await start()).toEqual({ ok: true, value: { sessionId: SESSION } });
    const body = await stored();
    expect(body).toMatchObject({
      adminUserId: OWNER,
      targetUserId: CLIENT,
      startedAtUtcMs: FIXTURE_NOW_UTC_MS,
      expiresAtUtcMs: EXPIRES,
    });
    expect(purgeAtOf(body)).toBe(EXPIRES + 30 * DAY_MS);
    // ONE audit row, committed with the session (DEP-12) — never the reason.
    const rows = await auditRows();
    expect(rows).toEqual([
      expect.objectContaining({
        ...SESSION_ROW,
        auditAction: AuditAction.GovernanceImpersonationStarted,
        recordedAtUtcMs: FIXTURE_NOW_UTC_MS,
      }),
    ]);
    expect(JSON.stringify(rows)).not.toContain('support ticket 42');
  });

  it('ends it with ONE Set of the ended body — purgeAt RE-STAMPED on the end + 30 days', async () => {
    await start();
    expect(
      await endImpersonation(ports(ENDED))({
        sessionId: SESSION,
        adminUserId: OWNER,
        adminRoles: [Role.Admin],
        operationId: null,
      }),
    ).toEqual({
      ok: true,
      value: {
        sessionId: SESSION,
        impersonationEndReason: ImpersonationEndReason.AdminEnded,
      },
    });
    const body = await stored();
    expect(body).toMatchObject({
      endedAtUtcMs: ENDED,
      impersonationEndReason: ImpersonationEndReason.AdminEnded,
    });
    expect(purgeAtOf(body)).toBe(ENDED + 30 * DAY_MS);
    // The start's row and the end's, each committed with its own write.
    const rows = await auditRows();
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual(
      expect.objectContaining({
        ...SESSION_ROW,
        auditAction: AuditAction.GovernanceImpersonationEnded,
        impersonationEndReason: ImpersonationEndReason.AdminEnded,
        recordedAtUtcMs: ENDED,
      }),
    );
    expect(JSON.stringify(rows)).not.toContain('support ticket 42');
  });

  it('refuses a session nobody holds, and writes nothing', async () => {
    const answer = await endImpersonation(ports(ENDED))({
      sessionId: SESSION,
      adminUserId: OWNER,
      adminRoles: [Role.Admin],
      operationId: null,
    });
    expect(!answer.ok && answer.error.errorCode).toBe(
      GovernanceErrorCode.EndImpersonationNotFound,
    );
    expect(await stored()).toBeUndefined();
    expect(await auditRows()).toEqual([]);
  });
});
