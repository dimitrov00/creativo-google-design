import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import admin from 'firebase-admin';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore, Timestamp } from 'firebase-admin/firestore';
import {
  AuthDeployment,
  CustomerOrigin,
  E164,
  ParsedIdentifier,
  Registration,
  RegistrationState,
  type RegistrationFields,
  Role,
} from '@core/components';
import {
  CustomerId,
  IdentifierChannel,
  TenantId,
  UserId,
} from '@core/primitives';
import { IdentityErrorCode } from '@core/errors';
import { Collections } from '@core/entities';
import {
  type CompleteRegistrationCommand,
  completeRegistration,
} from '@core/pipelines';
import { RegistrationSystem, StoredDocumentSystem } from '@core/systems';
import { pinnedNowUtcMs, recordingTelemetry } from '@core/testing';
import { authClaimsPorts } from '../adapters/auth-claims.adapter';
import { sha256Hex } from '../adapters/crypto.adapter';
import { firestoreCommitPlan } from '../adapters/firestore-tx.adapter';
import { firestoreUserPorts } from '../adapters/firestore-users.adapter';
import { singleTenantPorts } from '../adapters/tenant.adapter';

/**
 * `completeRegistration` against the REAL Firestore and Auth emulators
 * (identity flip (2), F2-7b, F2-8): the registered body is ONE `Set` over
 * the stub, the `REGISTRATION` client record is created beside it with
 * `userId == uid`, a re-run writes the same body and no second record (two
 * concurrent ones neither), and a uid that does not own the identifier
 * writes nothing.
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

function bodyOf(entity: { readonly id: string }): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entity).filter(([key]) => key !== 'id'),
  );
}

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
    });
    expect((await auth.getUser(UID)).displayName).toBe('Ada Lovelace');
  });

  it('writes the same body on a re-run, and no second record', async () => {
    expect((await run(command())).ok).toBe(true);
    const first = await user();
    const record = await customer();
    expect((await run(command())).ok).toBe(true);
    expect((await user()).data()).toEqual(first.data());
    expect(await customerIds()).toEqual([CUSTOMER]);
    expect(sameUpdate(await customer(), record)).toBe(true);
  });

  it('creates ONE record when two registrations of the account race', async () => {
    const [one, two] = await Promise.all([run(command()), run(command())]);
    expect(one.ok && two.ok).toBe(true);
    expect(await customerIds()).toEqual([CUSTOMER]);
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
  });
});
