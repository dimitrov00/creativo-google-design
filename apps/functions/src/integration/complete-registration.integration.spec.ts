import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import admin from 'firebase-admin';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore, Timestamp } from 'firebase-admin/firestore';
import {
  AuthDeployment,
  CustomerOrigin,
  E164,
  ErasureStatus,
  ParsedIdentifier,
  Registration,
  RegistrationState,
  type RegistrationFields,
  Role,
} from '@core/components';
import {
  CustomerId,
  IdentifierChannel,
  OperationId,
  TenantId,
  UserId,
} from '@core/primitives';
import { IdentityErrorCode } from '@core/errors';
import { Collections } from '@core/entities';
import {
  type CompleteRegistrationCommand,
  completeRegistration,
} from '@core/pipelines';
import {
  IdentityAuditSystem,
  RegistrationSystem,
  StoredDocumentSystem,
} from '@core/systems';
import {
  FIXTURE_NOW_UTC_MS,
  pinnedNowUtcMs,
  recordingTelemetry,
} from '@core/testing';
import { authClaimsPorts } from '../adapters/auth-claims.adapter';
import { sha256Hex } from '../adapters/crypto.adapter';
import { firestoreCommitPlan } from '../adapters/firestore-tx.adapter';
import { firestoreUserPorts } from '../adapters/firestore-users.adapter';
import { singleTenantPorts } from '../adapters/tenant.adapter';
import { bodyOf } from '../adapters/store-answer';

/**
 * `completeRegistration` against the REAL Firestore and Auth emulators
 * (identity flip (2), F2-7b, F2-8): the registered body is ONE `Set` over
 * the stub, the `REGISTRATION` client record is created beside it with
 * `userId == uid`, a re-run writes the same body and no second record (two
 * concurrent ones neither), and a uid that does not own the identifier
 * writes nothing. The FIRST completion commits one
 * `IDENTITY_REGISTRATION_COMPLETED` audit row with it — credited to the
 * verified caller, naming the call's operation; a re-run, a race's loser and
 * a forbidden call write none (audit-hardening Phase 3, P3-DEP-7).
 *
 * Emulator-only by construction, on a demo project of its own.
 */
const PROJECT_ID = 'demo-functions-registration';

const FIRESTORE_HOST = (process.env['FIRESTORE_EMULATOR_HOST'] ??=
  '127.0.0.1:8080');
const AUTH_HOST = (process.env['FIREBASE_AUTH_EMULATOR_HOST'] ??=
  '127.0.0.1:9099');
if (!FIRESTORE_HOST.includes('127.0.0.1') || !AUTH_HOST.includes('127.0.0.1')) {
  throw new Error('Refusing to run outside the local emulators.');
}

const UID = UserId.of('uid-ada');
const PHONE = E164.of('+359888123456');
const CUSTOMER = CustomerId.forUser(UID, sha256Hex);
/** A transport operation id the caller sent (WS-4.1) — the registration row names it. */
const OPERATION = OperationId.of('operation-0123456789ab');

/** Two snapshots' update times are the same instant — the document was not rewritten. */
function sameUpdate(
  a: { readonly updateTime?: Timestamp },
  b: { readonly updateTime?: Timestamp },
): boolean {
  return (
    a.updateTime !== undefined &&
    b.updateTime !== undefined &&
    a.updateTime.isEqual(b.updateTime)
  );
}

function command(
  callerUserId: UserId = UID,
  submitted: Partial<Record<keyof RegistrationFields, string>> = {
    firstName: 'Ada',
    lastName: 'Lovelace',
  },
): CompleteRegistrationCommand {
  return {
    callerUserId,
    identifierChannel: IdentifierChannel.Phone,
    rawIdentifier: PHONE,
    fields: { ...Registration.emptyFields(), ...submitted },
    // The optional transport id (RU-21): none sent.
    operationId: null,
  };
}

describe('completeRegistration (emulator)', () => {
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
    // What `verifyOtp` left: the Auth user and its flat stub.
    await auth.createUser({ uid: UID, phoneNumber: PHONE });
    await db
      .doc(`${Collections.Users}/${UID}`)
      .set(
        bodyOf(
          RegistrationSystem.provision(UID, ParsedIdentifier.phone(PHONE)),
        ),
      );
  });

  function run(cmd: CompleteRegistrationCommand) {
    const telemetry = recordingTelemetry();
    return completeRegistration({
      commit: firestoreCommitPlan(
        db,
        StoredDocumentSystem.guardOf,
        telemetry.log,
      ),
      nowUtcMs: pinnedNowUtcMs(),
      hash: sha256Hex,
      ...firestoreUserPorts(db),
      ...singleTenantPorts(TenantId.of('creativo')),
      ...authClaimsPorts(auth),
      authDeployment: AuthDeployment.DEFAULT,
      ...telemetry,
    })(cmd);
  }

  const user = () => db.doc(`${Collections.Users}/${UID}`).get();
  const customer = () => db.doc(`${Collections.Customers}/${CUSTOMER}`).get();
  const customerIds = async (): Promise<readonly string[]> =>
    (await db.collection(Collections.Customers).get()).docs.map(
      (doc) => doc.id,
    );
  /** Every `auditLog` document as `[id, body]`. */
  const auditRows = async (): Promise<
    readonly (readonly [string, unknown])[]
  > =>
    (await db.collection(Collections.AuditLog).get()).docs.map(
      (doc) => [doc.id, doc.data()] as const,
    );

  it('commits ONE IDENTITY_REGISTRATION_COMPLETED row with the first completion — the verified caller over the stored roles, the account, the operation (P3-DEP-7)', async () => {
    const answer = await run({ ...command(), operationId: OPERATION });
    expect(answer.ok).toBe(true);
    const plan = IdentityAuditSystem.planRegistrationCompleted(
      UID,
      RegistrationSystem.provision(UID, ParsedIdentifier.phone(PHONE)).roles,
      IdentifierChannel.Phone,
      OPERATION,
      FIXTURE_NOW_UTC_MS,
    );
    expect(await auditRows()).toEqual([[sha256Hex(plan.idBasis), plan.row]]);
    expect(plan.row).toMatchObject({
      targetUserId: UID,
      auditOperationId: OPERATION,
    });
    const serialised = JSON.stringify(await auditRows());
    for (const value of [PHONE, 'Ada', 'Lovelace']) {
      expect(serialised, value).not.toContain(value);
    }
  });

  it('sets the flat REGISTERED body over the stub and creates the REGISTRATION client record with userId == uid', async () => {
    const answer = await run(command());
    expect(answer.ok).toBe(true);
    const registered = RegistrationSystem.register(
      RegistrationSystem.provision(UID, ParsedIdentifier.phone(PHONE)),
      {
        firstName: 'Ada',
        lastName: 'Lovelace',
        phone: PHONE,
        email: null,
        birthDate: null,
        roles: [Role.Client],
      },
    );
    expect((await user()).data()).toEqual(bodyOf(registered));
    expect((await user()).data()?.['registrationState']).toBe(
      RegistrationState.Registered,
    );
    expect((await customer()).data()).toMatchObject({
      userId: UID,
      displayName: 'Ada Lovelace',
      phone: PHONE,
      email: null,
      customerOrigin: CustomerOrigin.Registration,
      erasureStatus: ErasureStatus.None,
    });
    expect((await auth.getUser(UID)).displayName).toBe('Ada Lovelace');
  });

  it('writes the same body on a re-run, and no second record', async () => {
    expect((await run(command())).ok).toBe(true);
    const first = await user();
    const record = await customer();
    const rows = await auditRows();
    expect(rows).toHaveLength(1);
    expect((await run(command())).ok).toBe(true);
    expect((await user()).data()).toEqual(first.data());
    expect(await customerIds()).toEqual([CUSTOMER]);
    expect(sameUpdate(await customer(), record)).toBe(true);
    // A re-run changes no state, so it plans no row (P3-RU-7).
    expect(await auditRows()).toEqual(rows);
  });

  it('creates ONE record when two registrations of the account race', async () => {
    const [one, two] = await Promise.all([run(command()), run(command())]);
    expect(one.ok && two.ok).toBe(true);
    expect(await customerIds()).toEqual([CUSTOMER]);
    expect(await auditRows()).toHaveLength(1);
  });

  it('writes nothing for a uid that does not own the identifier', async () => {
    const before = await user();
    const answer = await run(command(UserId.of('uid-mallory')));
    expect(!answer.ok && answer.error.errorCode).toBe(
      IdentityErrorCode.RegistrationForbidden,
    );
    const after = await user();
    expect(after.data()).toEqual(before.data());
    expect(sameUpdate(after, before)).toBe(true);
    expect(await customerIds()).toEqual([]);
    expect(await auditRows()).toEqual([]);
  });
});
