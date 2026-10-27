import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import admin from 'firebase-admin';
import type { Firestore, Timestamp } from 'firebase-admin/firestore';
import { AuditAction, Email } from '@core/components';
import { UserId } from '@core/primitives';
import { AccountsErrorCode } from '@core/errors';
import { Collections } from '@core/entities';
import { type UpdateProfileCommand, updateProfile } from '@core/pipelines';
import { SearchFieldsSystem, StoredDocumentSystem } from '@core/systems';
import {
  FIXTURE_NOW_UTC_MS,
  pinnedNowUtcMs,
  provisionedUserFixture,
  recordingTelemetry,
  registeredUserFixture,
} from '@core/testing';
import { sha256Hex } from '../adapters/crypto.adapter';
import { firestoreCommitPlan } from '../adapters/firestore-tx.adapter';

/**
 * `updateProfile` against the REAL Firestore emulator (identity flip (2),
 * F2-5; Phase 4a 4A-16): ONE root-key update of the five owner keys, the
 * search keys from the STORED contact and the `profileEditedAtUtcMs` marker,
 * beside ONE audit row credited to the USER in the same transaction (the
 * profile trigger skips the event the marker names); an identical second
 * call writes nothing; a provisioned stub is refused, untouched.
 *
 * Emulator-only by construction, on a demo project of its own.
 */
const PROJECT_ID = 'demo-functions-update-profile';

const FIRESTORE_HOST = (process.env['FIRESTORE_EMULATOR_HOST'] ??=
  '127.0.0.1:8080');
if (!FIRESTORE_HOST.includes('127.0.0.1')) {
  throw new Error('Refusing to run outside the local emulators.');
}

const UID = UserId.of('u-client');
const MAIL = Email.of('maria@example.com');

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

const rename: UpdateProfileCommand = {
  callerUserId: UID,
  edits: { firstName: 'Mariya', lastName: null, birthDate: null },
  // The optional transport id (RU-21): none sent.
  operationId: null,
};

describe('updateProfile (emulator)', () => {
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

  function run(cmd: UpdateProfileCommand) {
    const telemetry = recordingTelemetry();
    return updateProfile({
      commit: firestoreCommitPlan(
        db,
        StoredDocumentSystem.guardOf,
        telemetry.log,
      ),
      nowUtcMs: pinnedNowUtcMs(),
      hash: sha256Hex,
      ...telemetry,
    })(cmd);
  }

  const doc = () => db.doc(`${Collections.Users}/${UID}`).get();
  const auditRows = async () =>
    (await db.collection(Collections.AuditLog).get()).docs.map((row) =>
      row.data(),
    );

  it('writes once — the names and the search keys re-derived from the STORED contact, every other key kept', async () => {
    const maria = registeredUserFixture({ email: MAIL });
    await db.doc(`${Collections.Users}/${UID}`).set(bodyOf(maria));
    expect(await run(rename)).toEqual({ ok: true, value: { changed: true } });
    expect((await doc()).data()).toEqual({
      ...bodyOf(maria),
      firstName: 'Mariya',
      ...SearchFieldsSystem.searchFields(
        'Mariya',
        'Petrova',
        maria.phone,
        maria.email,
      ),
      profileEditedAtUtcMs: FIXTURE_NOW_UTC_MS,
    });
    // ONE row, the user's own edit, written in the same transaction.
    expect(await auditRows()).toEqual([
      expect.objectContaining({
        auditAction: AuditAction.ProfileUpdated,
        actorRole: 'USER',
        actorUserId: UID,
        recordedAtUtcMs: FIXTURE_NOW_UTC_MS,
        // No transport id was sent (RU-21): the row names no operation (WS-4.4).
        auditOperationId: null,
      }),
    ]);
  });

  it('writes nothing for an identical second call', async () => {
    await db
      .doc(`${Collections.Users}/${UID}`)
      .set(bodyOf(registeredUserFixture({ email: MAIL })));
    await run(rename);
    const first = await doc();
    expect(await run(rename)).toEqual({ ok: true, value: { changed: false } });
    const second = await doc();
    expect(sameUpdate(second, first)).toBe(true);
    expect(await auditRows()).toHaveLength(1);
  });

  it('refuses a provisioned stub as not found, untouched', async () => {
    const stub = provisionedUserFixture();
    await db.doc(`${Collections.Users}/${UID}`).set(bodyOf(stub));
    const before = await doc();
    const answer = await run(rename);
    expect(!answer.ok && answer.error.errorCode).toBe(
      AccountsErrorCode.UpdateProfileNotFound,
    );
    expect(sameUpdate(await doc(), before)).toBe(true);
    expect(await auditRows()).toEqual([]);
  });
});
