import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import admin from 'firebase-admin';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore, Timestamp } from 'firebase-admin/firestore';
import {
  E164,
  Identifier,
  OtpCode,
  OtpDestinationType,
  ParsedIdentifier,
  RegistrationState,
  SessionKind,
} from '@core/components';
import { OtpId, UserId } from '@core/primitives';
import { IdentityErrorCode } from '@core/errors';
import { Collections, type Otp } from '@core/entities';
import { type VerifyOtpCommand, verifyOtp } from '@core/pipelines';
import { RegistrationSystem, StoredDocumentSystem } from '@core/systems';
import { otpFixture, pinnedNowUtcMs, recordingTelemetry } from '@core/testing';
import { authClaimsPorts } from '../adapters/auth-claims.adapter';
import { firestoreCommitPlan } from '../adapters/firestore-tx.adapter';
import { firestoreUserPorts } from '../adapters/firestore-users.adapter';
import { nodeOtpCryptoPorts } from '../adapters/otp-crypto.adapter';
import { verifyOtpRefusal } from '../wire/identity.wire';

/**
 * `verifyOtp` against the REAL Firestore and Auth emulators (identity flip
 * (2), F2-9): a wrong code's increment commits and locks the challenge out
 * at `maxAttempts`; two concurrent first verifications of one phone end as
 * ONE Auth user, ONE stub and two sign-ins into the same uid (the tx-2
 * `Create` that loses re-runs and settles); an orphan Auth user is adopted
 * with its stub created; an Auth user whose document carries another
 * contact is refused, nothing written.
 *
 * Emulator-only by construction, on a demo project of its own.
 */
const PROJECT_ID = 'demo-functions-verify-otp';

const FIRESTORE_HOST = (process.env['FIRESTORE_EMULATOR_HOST'] ??=
  '127.0.0.1:8080');
const AUTH_HOST = (process.env['FIREBASE_AUTH_EMULATOR_HOST'] ??=
  '127.0.0.1:9099');
if (!FIRESTORE_HOST.includes('127.0.0.1') || !AUTH_HOST.includes('127.0.0.1')) {
  throw new Error('Refusing to run outside the local emulators.');
}

const PHONE = E164.of('+359888123456');
const OTHER_PHONE = E164.of('+359888000111');
const CODE = OtpCode.of('123456');
const WRONG = OtpCode.of('000000');
const SALT = '9f86d081884c7d659a2feaa0c55ad015';
const crypto = nodeOtpCryptoPorts();

/** A login challenge for the phone, its hash the REAL scrypt of `CODE`. */
function phoneOtp(id: string): Otp {
  return otpFixture({
    id: OtpId.of(id),
    destination: Identifier.of(PHONE),
    otpDestinationType: OtpDestinationType.Sms,
    salt: SALT,
    codeHash: crypto.otpCrypto.hashCode(CODE, SALT),
  });
}

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

/** The uid a custom token signs into — its unsigned payload's `uid`. */
function uidOf(customToken: string): string {
  const payload = customToken.split('.')[1] ?? '';
  return String(
    JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))['uid'],
  );
}

describe('verifyOtp (emulator)', () => {
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
  });

  function run(cmd: VerifyOtpCommand) {
    const telemetry = recordingTelemetry();
    return verifyOtp({
      commit: firestoreCommitPlan(
        db,
        StoredDocumentSystem.guardOf,
        telemetry.log,
      ),
      nowUtcMs: pinnedNowUtcMs(),
      ...crypto,
      ...firestoreUserPorts(db),
      ...authClaimsPorts(auth),
      ...telemetry,
    })(cmd);
  }

  async function seedOtp(otp: Otp): Promise<void> {
    await db.doc(`${Collections.Otps}/${otp.id}`).set(bodyOf(otp));
  }

  const usersIds = async (): Promise<readonly string[]> =>
    (await db.collection(Collections.Users).get()).docs.map((doc) => doc.id);

  it('increments the attempt count on every wrong code and locks the challenge out at maxAttempts — even for the right code', async () => {
    const otp = phoneOtp('otp-lock');
    await seedOtp(otp);
    for (let i = 1; i <= otp.maxAttempts; i++) {
      const wrong = await run({ otpId: otp.id, code: WRONG });
      expect(!wrong.ok && wrong.error.errorCode).toBe(
        IdentityErrorCode.OtpWrongCode,
      );
      expect(
        (await db.doc(`${Collections.Otps}/${otp.id}`).get()).data()?.[
          'attemptCount'
        ],
      ).toBe(i);
    }
    const locked = await run({ otpId: otp.id, code: CODE });
    expect(!locked.ok && locked.error.errorCode).toBe(
      IdentityErrorCode.OtpLockedOut,
    );
    expect(await usersIds()).toEqual([]);
  });

  it('verifies end to end: the challenge consumed, the flat PROVISIONED stub created, a NEW session', async () => {
    const otp = phoneOtp('otp-1');
    await seedOtp(otp);
    const answer = await run({ otpId: otp.id, code: CODE });
    expect(answer.ok && answer.value.sessionKind).toBe(SessionKind.New);
    const uid = answer.ok ? uidOf(answer.value.customToken) : '';
    expect(
      (await db.doc(`${Collections.Otps}/${otp.id}`).get()).data(),
    ).toMatchObject({ consumedAtUtcMs: otp.createdAtUtcMs });
    expect((await db.doc(`${Collections.Users}/${uid}`).get()).data()).toEqual(
      bodyOf(
        RegistrationSystem.provision(
          UserId.of(uid),
          ParsedIdentifier.phone(PHONE),
        ),
      ),
    );
    expect((await auth.getUserByPhoneNumber(PHONE)).uid).toBe(uid);
  });

  it('signs two concurrent first verifications of one phone into ONE uid — one Auth user, one stub', async () => {
    await seedOtp(phoneOtp('otp-a'));
    await seedOtp(phoneOtp('otp-b'));
    const [a, b] = await Promise.all([
      run({ otpId: OtpId.of('otp-a'), code: CODE }),
      run({ otpId: OtpId.of('otp-b'), code: CODE }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    const uidA = a.ok ? uidOf(a.value.customToken) : 'a';
    const uidB = b.ok ? uidOf(b.value.customToken) : 'b';
    expect(uidA).toBe(uidB);
    expect(await usersIds()).toEqual([uidA]);
    expect((await auth.getUserByPhoneNumber(PHONE)).uid).toBe(uidA);
    expect(
      (await db.doc(`${Collections.Users}/${uidA}`).get()).data(),
    ).toMatchObject({
      registrationState: RegistrationState.Provisioned,
      phone: PHONE,
    });
  });

  it('adopts an orphan Auth user — Auth holds the phone, no users doc — creating its stub and signing in', async () => {
    const orphan = await auth.createUser({ phoneNumber: PHONE });
    await seedOtp(phoneOtp('otp-orphan'));
    const answer = await run({ otpId: OtpId.of('otp-orphan'), code: CODE });
    expect(answer.ok && answer.value.sessionKind).toBe(SessionKind.New);
    expect(answer.ok && uidOf(answer.value.customToken)).toBe(orphan.uid);
    expect(await usersIds()).toEqual([orphan.uid]);
  });

  it('refuses an Auth user whose users doc carries another contact — IDENTITY_TOKEN_MINTING_FAILURE on the wire, nothing written', async () => {
    const held = await auth.createUser({ phoneNumber: PHONE });
    const drifted = RegistrationSystem.provision(
      UserId.of(held.uid),
      ParsedIdentifier.phone(OTHER_PHONE),
    );
    await db.doc(`${Collections.Users}/${held.uid}`).set(bodyOf(drifted));
    const before = await db.doc(`${Collections.Users}/${held.uid}`).get();
    await seedOtp(phoneOtp('otp-drift'));
    const answer = await run({ otpId: OtpId.of('otp-drift'), code: CODE });
    expect(!answer.ok && answer.error.errorCode).toBe(
      IdentityErrorCode.OtpAccountConflict,
    );
    if (!answer.ok) {
      // The wire flip (Phase 4a 4A-4): the refusal leaves as its ecs-core
      // struct, a refused adoption as a failed provisioning (F2-9).
      expect(verifyOtpRefusal(answer.error)).toEqual({
        errorCode: IdentityErrorCode.TokenMintingFailure,
      });
    }
    const after = await db.doc(`${Collections.Users}/${held.uid}`).get();
    expect(after.data()).toEqual(bodyOf(drifted));
    expect(sameUpdate(after, before)).toBe(true);
    expect(await usersIds()).toEqual([held.uid]);
  });
});
