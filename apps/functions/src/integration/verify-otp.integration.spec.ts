import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import admin from 'firebase-admin';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore, Timestamp } from 'firebase-admin/firestore';
import {
  AuditAction,
  E164,
  Identifier,
  OtpCode,
  OtpDestinationType,
  OtpRefusalReason,
  ParsedIdentifier,
  RegistrationState,
  SessionKind,
} from '@core/components';
import { OperationId, OtpId, UserId, UtcEpochMs } from '@core/primitives';
import { IdentityErrorCode } from '@core/errors';
import { Collections, type Otp } from '@core/entities';
import { type VerifyOtpCommand, verifyOtp } from '@core/pipelines';
import {
  type AuditRowPlan,
  IdentityAuditSystem,
  RegistrationSystem,
  StoredDocumentSystem,
} from '@core/systems';
import {
  FIXTURE_NOW_UTC_MS,
  otpFixture,
  pinnedNowUtcMs,
  recordingTelemetry,
} from '@core/testing';
import { authClaimsPorts } from '../adapters/auth-claims.adapter';
import { sha256Hex } from '../adapters/crypto.adapter';
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
 * The sign-in rows (audit-hardening Phase 3, P3-DEP-7): each state change
 * commits its row with it — a recorded wrong code `IDENTITY_OTP_REFUSED`
 * (`WRONG_CODE`, `LOCKED_OUT` on the attempt that exhausts the challenge),
 * the consumption `IDENTITY_OTP_VERIFIED`, and after the mint
 * `IDENTITY_SESSION_ISSUED` naming the account and the call's operation; a
 * refusal that changes nothing (expired, consumed, already locked, not
 * found) writes none (P3-L-2); no row ever holds the destination or the
 * code (R36 / T5).
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

/** A transport operation id the caller sent (WS-4.1) — only the session row names it. */
const OPERATION = OperationId.of('operation-0123456789ab');

/** Sentinel destination and code for the PII scan (§4): any trace of either in a row is a leak. */
const SENTINEL_PHONE = E164.of('+359880000777');
const SENTINEL_CODE = OtpCode.of('738291');

/** The planned row's document id and body — the id `hash(idBasis)` (the server's `sha256Hex`). */
function rowOf(plan: AuditRowPlan): readonly [string, unknown] {
  return [sha256Hex(plan.idBasis), plan.row];
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
      hash: sha256Hex,
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

  /** Every `auditLog` document as `[id, body]`, ordered by id. */
  const auditRows = async (): Promise<
    readonly (readonly [string, unknown])[]
  > =>
    (await db.collection(Collections.AuditLog).get()).docs
      .map((doc) => [doc.id, doc.data()] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const byId = (
    rows: readonly (readonly [string, unknown])[],
  ): readonly (readonly [string, unknown])[] =>
    [...rows].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  it('increments the attempt count on every wrong code and locks the challenge out at maxAttempts — even for the right code', async () => {
    const otp = phoneOtp('otp-lock');
    await seedOtp(otp);
    for (let i = 1; i <= otp.maxAttempts; i++) {
      const wrong = await run({
        otpId: otp.id,
        code: WRONG,
        operationId: null,
      });
      expect(!wrong.ok && wrong.error.errorCode).toBe(
        IdentityErrorCode.OtpWrongCode,
      );
      expect(
        (await db.doc(`${Collections.Otps}/${otp.id}`).get()).data()?.[
          'attemptCount'
        ],
      ).toBe(i);
    }
    const locked = await run({ otpId: otp.id, code: CODE, operationId: null });
    expect(!locked.ok && locked.error.errorCode).toBe(
      IdentityErrorCode.OtpLockedOut,
    );
    expect(await usersIds()).toEqual([]);
  });

  it('commits one IDENTITY_OTP_REFUSED row per recorded wrong code — WRONG_CODE, then LOCKED_OUT on the attempt that exhausts the challenge; the locked attempt after writes none (P3-DEP-7)', async () => {
    const otp = phoneOtp('otp-refused');
    await seedOtp(otp);
    for (let i = 1; i <= otp.maxAttempts; i++) {
      await run({ otpId: otp.id, code: WRONG, operationId: OPERATION });
    }
    const expected = byId(
      Array.from({ length: otp.maxAttempts }, (_, index) =>
        rowOf(
          IdentityAuditSystem.planOtpRefused(
            { ...otp, attemptCount: index + 1 },
            index + 1 < otp.maxAttempts
              ? OtpRefusalReason.WrongCode
              : OtpRefusalReason.LockedOut,
            FIXTURE_NOW_UTC_MS,
          ),
        ),
      ),
    );
    expect(await auditRows()).toEqual(expected);
    // Pre-session rows name no operation, even when the call sent one (P3-L-20).
    for (const [, body] of expected) {
      expect(body).toMatchObject({
        auditAction: AuditAction.IdentityOtpRefused,
        auditOperationId: null,
      });
    }
    const locked = await run({ otpId: otp.id, code: CODE, operationId: null });
    expect(!locked.ok && locked.error.errorCode).toBe(
      IdentityErrorCode.OtpLockedOut,
    );
    expect(await auditRows()).toEqual(expected);
  });

  it('commits IDENTITY_OTP_VERIFIED with the consumption and, after the mint, IDENTITY_SESSION_ISSUED naming the uid and the operation (P3-DEP-7)', async () => {
    const otp = phoneOtp('otp-rows');
    await seedOtp(otp);
    const answer = await run({
      otpId: otp.id,
      code: CODE,
      operationId: OPERATION,
    });
    expect(answer.ok && answer.value.sessionKind).toBe(SessionKind.New);
    const uid = UserId.of(answer.ok ? uidOf(answer.value.customToken) : '');
    const consumed = { ...otp, consumedAtUtcMs: FIXTURE_NOW_UTC_MS };
    expect(await auditRows()).toEqual(
      byId([
        rowOf(IdentityAuditSystem.planOtpVerified(consumed)),
        rowOf(
          IdentityAuditSystem.planSessionIssued(
            otp,
            uid,
            SessionKind.New,
            OPERATION,
            FIXTURE_NOW_UTC_MS,
          ),
        ),
      ]),
    );
    const session = (await auditRows()).find(
      ([, body]) =>
        (body as Record<string, unknown>)['auditAction'] ===
        AuditAction.IdentitySessionIssued,
    );
    expect(session?.[1]).toMatchObject({
      targetUserId: uid,
      auditOperationId: OPERATION,
    });
  });

  it('writes no row for a refusal that changes nothing — expired, already consumed, not found (P3-L-2)', async () => {
    const expired = phoneOtp('otp-expired');
    await seedOtp({
      ...expired,
      expiresAtUtcMs: UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, -60_000),
    });
    const consumed = phoneOtp('otp-consumed');
    await seedOtp({
      ...consumed,
      consumedAtUtcMs: UtcEpochMs.plusMs(FIXTURE_NOW_UTC_MS, -60_000),
    });
    const refusals = [
      await run({ otpId: expired.id, code: CODE, operationId: OPERATION }),
      await run({ otpId: consumed.id, code: CODE, operationId: OPERATION }),
      await run({
        otpId: OtpId.of('otp-missing'),
        code: CODE,
        operationId: OPERATION,
      }),
    ];
    expect(refusals.map((answer) => answer.ok)).toEqual([false, false, false]);
    expect(await auditRows()).toEqual([]);
  });

  it('leaves neither the destination nor the code in any auditLog document after a full sign-in with a wrong code first (R36 / T5)', async () => {
    const otp = otpFixture({
      id: OtpId.of('otp-scan'),
      destination: Identifier.of(SENTINEL_PHONE),
      otpDestinationType: OtpDestinationType.Sms,
      salt: SALT,
      codeHash: crypto.otpCrypto.hashCode(SENTINEL_CODE, SALT),
    });
    await seedOtp(otp);
    await run({ otpId: otp.id, code: WRONG, operationId: OPERATION });
    const answer = await run({
      otpId: otp.id,
      code: SENTINEL_CODE,
      operationId: OPERATION,
    });
    expect(answer.ok).toBe(true);
    const rows = await auditRows();
    expect(
      rows
        .map(([, body]) => (body as Record<string, unknown>)['auditAction'])
        .sort(),
    ).toEqual(
      [
        AuditAction.IdentityOtpRefused,
        AuditAction.IdentityOtpVerified,
        AuditAction.IdentitySessionIssued,
      ].sort(),
    );
    const serialised = JSON.stringify(rows.map(([, body]) => body));
    for (const secret of [
      SENTINEL_PHONE,
      SENTINEL_PHONE.replace('+', ''),
      SENTINEL_CODE,
      SALT,
      otp.codeHash,
    ]) {
      expect(serialised, secret).not.toContain(secret);
    }
  });

  it('verifies end to end: the challenge consumed, the flat PROVISIONED stub created, a NEW session', async () => {
    const otp = phoneOtp('otp-1');
    await seedOtp(otp);
    const answer = await run({ otpId: otp.id, code: CODE, operationId: null });
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
      run({ otpId: OtpId.of('otp-a'), code: CODE, operationId: null }),
      run({ otpId: OtpId.of('otp-b'), code: CODE, operationId: null }),
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
    const answer = await run({
      otpId: OtpId.of('otp-orphan'),
      code: CODE,
      operationId: null,
    });
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
    const answer = await run({
      otpId: OtpId.of('otp-drift'),
      code: CODE,
      operationId: null,
    });
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
