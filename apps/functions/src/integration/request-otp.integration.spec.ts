import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import admin from 'firebase-admin';
import { type Firestore, Timestamp } from 'firebase-admin/firestore';
import {
  AuditAction,
  AuthDeployment,
  OtpDestinationType,
  ParsedIdentifier,
} from '@core/components';
import { OperationId, OtpId, Result, TenantId } from '@core/primitives';
import { IdentityErrorCode, RepositoryErrorCode } from '@core/errors';
import { Collections, type Otp } from '@core/entities';
import type { OtpDeliveryPorts } from '@core/ports';
import { type RequestOtpCommand, requestOtp } from '@core/pipelines';
import { IdentityAuditSystem, StoredDocumentSystem } from '@core/systems';
import { pinnedNowUtcMs, recordingTelemetry } from '@core/testing';
import { sha256Hex } from '../adapters/crypto.adapter';
import { firestoreOtpPorts } from '../adapters/firestore-otps.adapter';
import { purgeAtFor } from '../adapters/firestore-ttl.adapter';
import { firestoreCommitPlan } from '../adapters/firestore-tx.adapter';
import { nodeOtpCryptoPorts } from '../adapters/otp-crypto.adapter';
import { refusingOtpSender } from '../adapters/refusing-otp-sender.adapter';
import { singleTenantPorts } from '../adapters/tenant.adapter';

/**
 * `requestOtp` against the REAL Firestore emulator (audit-hardening Phase 3,
 * P3-RU-6, P3-DEP-6, P3-DEP-7): the challenge is saved by ONE
 * `firestoreCommitPlan` commit — the whole-body `Set` of `otps/<id>` and its
 * `IDENTITY_OTP_REQUESTED` audit row — so
 *
 * - one request leaves the `otps` document and exactly one row, the row
 *   naming no operation even when the call sent one (P3-L-20);
 * - the TTL invariant survives the move off the store's own save member (`firestore-layout.md`
 *   "must not regress"): the committed `otps/<id>` carries the root
 *   `purgeAt` Timestamp `purgeAtFor` stamps — the expiry + 24 h;
 * - a commit that fails (the row's `auditLog/<id>` already there, so its
 *   `Create` meets ALREADY_EXISTS) leaves neither the challenge nor a row,
 *   and sends nothing;
 * - a refused send (the deployed sender, WS-0) follows its ALREADY committed
 *   challenge and row — RU-3's order, the plan's §7 item 5;
 * - no row field holds the destination, the code, the hash or the salt
 *   (R36 / T5): the destination is a SENTINEL and the rows are searched.
 *
 * Emulator-only by construction, on a demo project of its own.
 */
const PROJECT_ID = 'demo-functions-request-otp';

const FIRESTORE_HOST = (process.env['FIRESTORE_EMULATOR_HOST'] ??=
  '127.0.0.1:8080');
if (!FIRESTORE_HOST.includes('127.0.0.1')) {
  throw new Error('Refusing to run outside the local emulators.');
}

/** The default deployment's channel is e-mail OTP; the destination is a sentinel. */
const SENTINEL_EMAIL = 'sentinel@example.invalid';
/** A transport operation id the caller sent (WS-4.1) — never on a pre-session row. */
const OPERATION = OperationId.of('operation-0123456789ab');
/** The code the rig issues — fixed, so the scan searches for a known value. */
const SENTINEL_CODE = '738291';
/** The one id the rig's `nextId` mints — so a row id is known before the call. */
const OTP_ID = OtpId.of('otp-request-1');
const DAY_MS = 86_400_000;

const COMMAND: RequestOtpCommand = {
  otpDestinationType: OtpDestinationType.Email,
  rawDestination: SENTINEL_EMAIL,
  operationId: OPERATION,
};

/** The planned row's document id — `hash(idBasis)`, the server's `sha256Hex`; it depends on the challenge id alone. */
const rowIdOf = (otp: Otp): string =>
  sha256Hex(IdentityAuditSystem.planOtpRequested(otp).idBasis);

describe('requestOtp (emulator)', () => {
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

  /** The codes a recording sender was handed, in order. */
  type Sent = { destination: ParsedIdentifier; code: string }[];

  function run(
    cmd: RequestOtpCommand,
    delivery: OtpDeliveryPorts | null = null,
  ): {
    readonly sent: Sent;
    readonly answer: ReturnType<ReturnType<typeof requestOtp>>;
  } {
    const telemetry = recordingTelemetry();
    const sent: Sent = [];
    const recording: OtpDeliveryPorts = {
      sendOtp: async (destination, code) => {
        sent.push({ destination, code });
        return Result.ok(undefined);
      },
    };
    const answer = requestOtp({
      commit: firestoreCommitPlan(
        db,
        StoredDocumentSystem.guardOf,
        telemetry.log,
      ),
      nowUtcMs: pinnedNowUtcMs(),
      nextId: () => OTP_ID,
      hash: sha256Hex,
      ...firestoreOtpPorts(db),
      otpCrypto: {
        ...nodeOtpCryptoPorts().otpCrypto,
        nextCode: () => SENTINEL_CODE,
      },
      ...singleTenantPorts(TenantId.of('creativo')),
      authDeployment: AuthDeployment.DEFAULT,
      ...(delivery ?? recording),
      ...telemetry,
    })(cmd);
    return { sent, answer };
  }

  const otpDocs = async () =>
    (await db.collection(Collections.Otps).get()).docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
  /** Every `auditLog` document as `[id, body]`. */
  const auditRows = async (): Promise<
    readonly (readonly [string, unknown])[]
  > =>
    (await db.collection(Collections.AuditLog).get()).docs.map(
      (doc) => [doc.id, doc.data()] as const,
    );

  /** The stored challenge as the entity — the body minus the adapter's `purgeAt` stamp. */
  async function storedOtp(): Promise<Otp> {
    const snap = await db.doc(`${Collections.Otps}/${OTP_ID}`).get();
    const body = Object.fromEntries(
      Object.entries(snap.data() ?? {}).filter(([key]) => key !== 'purgeAt'),
    );
    return { id: OTP_ID, ...body } as Otp;
  }

  it('saves the challenge and exactly one IDENTITY_OTP_REQUESTED row in one commit — no operation id on the row — then sends', async () => {
    const { sent, answer } = run(COMMAND);
    const answered = await answer;
    expect(answered.ok && answered.value.otpId).toBe(OTP_ID);
    expect((await otpDocs()).map((doc) => doc.id)).toEqual([OTP_ID]);
    const otp = await storedOtp();
    const plan = IdentityAuditSystem.planOtpRequested(otp);
    expect(await auditRows()).toEqual([[rowIdOf(otp), plan.row]]);
    expect(plan.row).toMatchObject({
      auditAction: AuditAction.IdentityOtpRequested,
      resourceId: `${Collections.Otps}/${OTP_ID}`,
      auditOperationId: null,
    });
    expect(sent).toHaveLength(1);
  });

  it('stamps the committed otps/<id> with the root purgeAt Timestamp purgeAtFor answers — the expiry + 24 h (the TTL invariant after the save moved into the commit)', async () => {
    expect((await run(COMMAND).answer).ok).toBe(true);
    const stored = (await db.doc(`${Collections.Otps}/${OTP_ID}`).get()).data();
    const { id, ...body } = await storedOtp();
    const stamp = purgeAtFor([Collections.Otps, id], body);
    expect(stamp).not.toBeNull();
    expect(stored?.['purgeAt']).toBeInstanceOf(Timestamp);
    expect(stored?.['purgeAt']).toEqual(stamp);
    expect(stored?.['purgeAt']).toEqual(
      Timestamp.fromMillis(body.expiresAtUtcMs + DAY_MS),
    );
  });

  it('a commit that meets its row already there leaves neither the challenge nor a row, sends nothing, and answers the store failure', async () => {
    // The row's own id, seeded first: its `Create` meets ALREADY_EXISTS
    // inside the transaction, and the whole plan — the `Set` included — fails.
    const rowId = rowIdOf({ id: OTP_ID } as Otp);
    await db.doc(`${Collections.AuditLog}/${rowId}`).set({
      resourceId: `${Collections.Otps}/${OTP_ID}`,
    });
    const { sent, answer } = run(COMMAND);
    const answered = await answer;
    expect(!answered.ok && answered.error.errorCode).toBe(
      RepositoryErrorCode.AlreadyExists,
    );
    expect(await otpDocs()).toEqual([]);
    expect(await auditRows()).toEqual([
      [rowId, { resourceId: `${Collections.Otps}/${OTP_ID}` }],
    ]);
    expect(sent).toEqual([]);
  });

  it('a refused send follows the ALREADY committed challenge and its row (RU-3 order; §7 item 5)', async () => {
    const answered = await run(COMMAND, refusingOtpSender()).answer;
    expect(!answered.ok && answered.error.errorCode).toBe(
      IdentityErrorCode.OtpSendUnavailable,
    );
    expect((await otpDocs()).map((doc) => doc.id)).toEqual([OTP_ID]);
    expect(await auditRows()).toHaveLength(1);
  });

  it('leaves neither the destination, the code, the hash nor the salt in any row (R36 / T5)', async () => {
    const { sent, answer } = run(COMMAND);
    expect((await answer).ok).toBe(true);
    const otp = await storedOtp();
    expect(sent.map(({ code }) => code)).toEqual([SENTINEL_CODE]);
    // The bodies only: a row id is a hex digest, never a value.
    const serialised = JSON.stringify(
      (await auditRows()).map(([, body]) => body),
    );
    for (const secret of [
      SENTINEL_EMAIL,
      otp.destination,
      otp.codeHash,
      otp.salt,
      SENTINEL_CODE,
    ]) {
      expect(serialised, secret).not.toContain(secret);
    }
  });
});
