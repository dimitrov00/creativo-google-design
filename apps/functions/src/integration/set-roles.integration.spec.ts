import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import admin from 'firebase-admin';
import type { Auth } from 'firebase-admin/auth';
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import {
  AccountLifecycle,
  Actor,
  AuditAction,
  AuditTargetRef,
  GovernedCollection,
  Role,
} from '@core/components';
import {
  AuditResourceId,
  OperationId,
  TenantId,
  UserId,
} from '@core/primitives';
import { GovernanceErrorCode } from '@core/errors';
import { Collections, type User } from '@core/entities';
import { RegistrationSystem, StoredDocumentSystem } from '@core/systems';
import { auditDocumentChange, setRoles } from '@core/pipelines';
import {
  bodyOf,
  FIXTURE_NOW_UTC_MS,
  pinnedNowUtcMs,
  recordingTelemetry,
  registeredUserFixture,
} from '@core/testing';
import {
  authClaimsPorts,
  authSessionRevokePorts,
} from '../adapters/auth-claims.adapter';
import { sha256Hex } from '../adapters/crypto.adapter';
import { firestoreAuditPorts } from '../adapters/firestore-audit.adapter';
import { firestoreCommitPlan } from '../adapters/firestore-tx.adapter';
import { decodeDocumentChangeEvent } from '../wire/triggers.wire';

/**
 * `setRoles` against the REAL Firestore and Auth emulators (security
 * hardening S-WS-E, S-DEP-6), over the real commit adapter and the real
 * session revocation (`authSessionRevokePorts`): an admin promotes a client
 * to barber — `users.roles` is written in dictionary order with exactly ONE
 * `PROFILE_ROLES_CHANGED` row whose ids match, in the same commit; the
 * target's sessions are revoked (its `tokensValidAfterTime` moves forward;
 * a separate case proves, through the same revoke adapter, that the ID
 * token of a sign-in before the revoke then fails the Admin SDK's
 * revocation check — on the emulator's default project, where its REST
 * sign-in lands);
 * the profile trigger, handed the write's before / after image, plans NO
 * second row (the `profileEditedAtUtcMs` marker, S-RU-12); a custom token
 * minted through the real claims path afterwards carries the written roles
 * (S-RU-10). Self, a `sysadmin` target and an `ERASED` target are refused
 * with nothing written; a target with no Auth user has its roles written
 * and its revoke treated as done.
 *
 * The Auth emulator never fails an Admin revoke, so the failed revoke is
 * the pipeline spec's (`set-roles.pipeline.spec.ts`). Emulator-only by
 * construction, on a demo project of its own.
 */
const PROJECT_ID = 'demo-functions-set-roles';

const FIRESTORE_HOST = (process.env['FIRESTORE_EMULATOR_HOST'] ??=
  '127.0.0.1:8080');
const AUTH_HOST = (process.env['FIREBASE_AUTH_EMULATOR_HOST'] ??=
  '127.0.0.1:9099');
if (!FIRESTORE_HOST.includes('127.0.0.1') || !AUTH_HOST.includes('127.0.0.1')) {
  throw new Error('Refusing to run outside the local emulators.');
}

const ADMIN = UserId.of('u-admin');
const TARGET = UserId.of('u-client');
const OPERATION = OperationId.of('operation-0123456789ab');
const TENANT = TenantId.of('creativo');
/** The project the Auth emulator answers API-key REST calls from (`emulators:exec --project`). */
const REST_PROJECT_ID = 'demo-creativo-test';
const REST_APP = 'set-roles-sessions';
/** The session proof's own account in that project — no other spec's uid. */
const SESSION_USER = UserId.of('u-set-roles-session');
/** The Auth emulator takes any API key; this one is a public placeholder. */
const API_KEY = 'demo-api-key';

/** A JWT's payload segment, decoded — the emulator's tokens are unsigned. */
function payloadOf(token: string): Record<string, unknown> {
  const segment = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

/** An identitytoolkit REST call to the Auth emulator: its status and body. */
async function identityToolkit(
  method: string,
  body: Record<string, unknown>,
): Promise<{
  readonly status: number;
  readonly body: Record<string, unknown>;
}> {
  const response = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/${method}?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  return { status: response.status, body: await response.json() };
}

describe('setRoles (emulator)', () => {
  let db: Firestore;
  let auth: Auth;

  beforeAll(() => {
    const app =
      admin.apps.find((a) => a?.name === PROJECT_ID) ??
      admin.initializeApp({ projectId: PROJECT_ID }, PROJECT_ID);
    db = app.firestore();
    auth = app.auth();
  });

  afterAll(async () => {
    await Promise.all(admin.apps.map((app) => app?.delete()));
  });

  beforeEach(async () => {
    await fetch(
      `http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
      { method: 'DELETE' },
    );
    await fetch(
      `http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`,
      { method: 'DELETE' },
    );
    await db
      .doc(`${Collections.Users}/${ADMIN}`)
      .set(bodyOf(registeredUserFixture({ id: ADMIN, roles: [Role.Admin] })));
  });

  /** The target's stored account — a registered client unless a case says otherwise. */
  const seedTarget = (overrides: Partial<User> = {}) =>
    db
      .doc(`${Collections.Users}/${TARGET}`)
      .set(bodyOf(registeredUserFixture({ id: TARGET, ...overrides })));

  const run = (targetUserId: UserId = TARGET) => {
    const telemetry = recordingTelemetry();
    return setRoles({
      commit: firestoreCommitPlan(
        db,
        StoredDocumentSystem.guardOf,
        telemetry.log,
      ),
      nowUtcMs: pinnedNowUtcMs(),
      hash: sha256Hex,
      ...authSessionRevokePorts(auth),
      ...telemetry,
    })({
      adminUserId: ADMIN,
      adminRoles: [Role.Admin],
      targetUserId,
      roles: [Role.Barber, Role.Client],
      operationId: OPERATION,
    });
  };

  const targetRef = (): DocumentReference =>
    db.doc(`${Collections.Users}/${TARGET}`);
  /** Every `auditLog` document as `[id, body]`. */
  const auditRows = async (): Promise<
    readonly (readonly [string, Record<string, unknown>])[]
  > =>
    (await db.collection(Collections.AuditLog).get()).docs.map(
      (doc) => [doc.id, doc.data()] as const,
    );

  it('an admin promotes a client to barber: the roles in dictionary order and ONE PROFILE_ROLES_CHANGED row in the same commit, then the sessions revoked', async () => {
    await seedTarget();
    await auth.createUser({ uid: TARGET });
    // A fresh emulator account has never been revoked: no
    // `tokensValidAfterTime` yet.
    expect((await auth.getUser(TARGET)).tokensValidAfterTime).toBeUndefined();

    const before = await targetRef().get();
    const answer = await run();
    const after = await targetRef().get();

    expect(answer).toEqual({
      ok: true,
      value: {
        targetUserId: TARGET,
        roles: [Role.Client, Role.Barber],
        rolesChanged: true,
      },
    });
    expect(after.data()).toMatchObject({
      roles: [Role.Client, Role.Barber],
      profileEditedAtUtcMs: FIXTURE_NOW_UTC_MS,
    });

    // Exactly ONE row, its ids matching the act: credited to the admin over
    // the STORED roles, targeted at the account, on users/<uid>, the roles as tags.
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.[1]).toMatchObject({
      auditAction: AuditAction.ProfileRolesChanged,
      ...Actor.admin(ADMIN),
      ...AuditTargetRef.user(TARGET),
      resourceId: AuditResourceId.forUser(TARGET),
      auditOperationId: OPERATION,
      recordedAtUtcMs: FIXTURE_NOW_UTC_MS,
      profileFields: ['roles'],
      profileRolesFrom: [Role.Client],
      profileRolesTo: [Role.Client, Role.Barber],
    });
    const serialised = JSON.stringify(rows);
    for (const value of ['Maria', 'Petrova']) {
      expect(serialised, value).not.toContain(value);
    }

    // The target's sessions are revoked: its tokens are now valid only from
    // the revoke on (the refusal of a live session is the next case's).
    const revokedFrom = Date.parse(
      (await auth.getUser(TARGET)).tokensValidAfterTime ?? '',
    );
    expect(Number.isFinite(revokedFrom)).toBe(true);

    // The profile trigger over the same write plans NO second row (S-RU-12).
    const telemetry = recordingTelemetry();
    const audited = await auditDocumentChange({
      ...firestoreAuditPorts(db, telemetry),
      hash: sha256Hex,
      nowUtcMs: pinnedNowUtcMs(),
    })(
      decodeDocumentChangeEvent(GovernedCollection.Users, {
        id: 'evt-roles-change',
        time: '2026-09-28T06:00:00.000Z',
        params: { docId: TARGET },
        data: { before, after },
        authType: 'service_account',
      }),
    );
    expect(audited).toEqual({ ok: true, value: { rows: 0 } });
    expect(await auditRows()).toHaveLength(1);

    // The next sign-in's claims come from the written roles (S-RU-10): a
    // custom token minted through the real claims path carries them.
    const stored = after.data() as User;
    const minted = await authClaimsPorts(auth).mintCustomToken(
      TARGET,
      RegistrationSystem.claimsFor(
        stored.registrationState,
        stored.roles,
        TENANT,
      ),
    );
    expect(minted.ok).toBe(true);
    if (minted.ok) {
      expect(payloadOf(minted.value)['claims']).toMatchObject({
        roles: [Role.Client, Role.Barber],
      });
    }
  });

  it('the revoke refuses a live session: the ID token of a sign-in before it fails the revocation check', async () => {
    // The Auth emulator answers every API-key REST call (the sign-in) from
    // its default project (firebase-tools `getProjectIdByApiKey`), so this
    // proof runs there, through the SAME revoke adapter the callable wires,
    // on an account of its own.
    const sessions =
      admin.apps.find((a) => a?.name === REST_APP)?.auth() ??
      admin.initializeApp({ projectId: REST_PROJECT_ID }, REST_APP).auth();
    await sessions.deleteUser(SESSION_USER).catch(() => undefined);
    const signedIn = await identityToolkit('accounts:signInWithCustomToken', {
      token: await sessions.createCustomToken(SESSION_USER),
      returnSecureToken: true,
    });
    expect(signedIn.status).toBe(200);
    const idToken = String(signedIn.body['idToken']);
    // The revocation check a server runs (`checkRevoked`) admits it ...
    await expect(sessions.verifyIdToken(idToken, true)).resolves.toMatchObject({
      uid: SESSION_USER,
    });
    // ... the revoke lands at least one second later (whole-second
    // `validSince`) ...
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    expect(
      await authSessionRevokePorts(sessions).revokeRefreshTokens(SESSION_USER),
    ).toEqual({ ok: true, value: undefined });
    // ... and from then on refuses the same token. (Google refusing the
    // refresh itself is its documented behaviour; the emulator checks no
    // refresh against the revoke.)
    await expect(sessions.verifyIdToken(idToken, true)).rejects.toMatchObject({
      code: 'auth/id-token-revoked',
    });
    await sessions.deleteUser(SESSION_USER);
  });

  it('a target with no Auth user: the roles are written and the revoke is treated as done', async () => {
    await seedTarget();
    const answer = await run();
    expect(answer.ok).toBe(true);
    expect((await targetRef().get()).data()?.['roles']).toEqual([
      Role.Client,
      Role.Barber,
    ]);
    expect(await auditRows()).toHaveLength(1);
  });

  it('refuses one’s own roles, a sysadmin target and an ERASED target — nothing written', async () => {
    const self = await run(ADMIN);
    expect(!self.ok && self.error.errorCode).toBe(
      GovernanceErrorCode.RolesSelf,
    );

    await seedTarget({ roles: [Role.Sysadmin] });
    const sysadmin = await run();
    expect(!sysadmin.ok && sysadmin.error.errorCode).toBe(
      GovernanceErrorCode.RolesTargetSysadmin,
    );
    expect((await targetRef().get()).data()?.['roles']).toEqual([
      Role.Sysadmin,
    ]);

    await seedTarget(AccountLifecycle.erase(FIXTURE_NOW_UTC_MS));
    const erased = await run();
    expect(!erased.ok && erased.error.errorCode).toBe(
      GovernanceErrorCode.RolesTargetErased,
    );
    expect((await targetRef().get()).data()?.['roles']).toEqual([Role.Client]);
    expect(await auditRows()).toEqual([]);
  });
});
