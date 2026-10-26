import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import {
  Actor,
  CancellationReason,
  VoucherCode,
  VoucherLifecycle,
  type VoucherRedemption,
} from '@core/components';
import { Currency, GiftVoucherId } from '@core/primitives';
import { CancellationRefusalCode } from '@core/errors';
import { type GiftVoucher, Collections } from '@core/entities';
import { StoredDocumentSystem } from '@core/systems';
import { cancelAppointment } from '@core/pipelines';
import {
  appointmentFixture,
  cents,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  localDate,
  pinnedNowUtcMs,
  recordingTelemetry,
  utcMs,
} from '@core/testing';
import { sha256Hex } from '../adapters/crypto.adapter';
import { firestoreAuditPorts } from '../adapters/firestore-audit.adapter';
import { firestoreSettingsPorts } from '../adapters/firestore-settings.adapter';
import { firestoreCommitPlan } from '../adapters/firestore-tx.adapter';

/**
 * A client's cancel against the REAL Firestore emulator (flip 1 §5.3): the
 * visit's variant transition — the old variant's fields DELETED — and the
 * gift voucher's restored balance commit in ONE transaction, or neither.
 *
 * Emulator-only by construction, on a demo project of its own.
 */
const PROJECT_ID = 'demo-functions-cancel';

const EMULATOR_HOST = (process.env['FIRESTORE_EMULATOR_HOST'] ??=
  '127.0.0.1:8080');
if (!EMULATOR_HOST.includes('127.0.0.1')) {
  throw new Error('Refusing to run outside the local emulators.');
}

const VOUCHER = GiftVoucherId.of('v-gift50');
const PATH = `${Collections.Appointments}/${FIXTURE_IDS.appointment}`;
const VOUCHER_PATH = `${Collections.GiftVouchers}/${VOUCHER}`;

function bodyOf(entity: { readonly id: string }): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entity).filter(([key]) => key !== 'id'),
  );
}

/** 20,00 € of the visit paid from a 50,00 € voucher, 10,00 € left on it. */
const LINE: VoucherRedemption = {
  voucherId: VOUCHER,
  code: VoucherCode.of('GIFT50'),
  amountCents: cents(2000),
  balanceAfterCents: cents(1000),
  currency: Currency.EUR,
  appliedAtUtcMs: utcMs('2026-09-27T10:00:00.000+03:00'),
  reversedAtUtcMs: null,
};

const voucher: GiftVoucher = {
  id: VOUCHER,
  code: VoucherCode.of('GIFT50'),
  initialValueCents: cents(5000),
  balanceCents: cents(1000),
  currency: Currency.EUR,
  issuedAtUtcMs: utcMs('2026-09-01T10:00:00.000+03:00'),
  expiresAtUtcMs: null,
  expiresLocalDate: null,
  issuedToCustomerId: null,
  holderUserId: null,
  ...VoucherLifecycle.active(),
};

describe('cancelAppointment (emulator)', () => {
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
      `http://${EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
      { method: 'DELETE' },
    );
    await db.doc(VOUCHER_PATH).set(bodyOf(voucher));
  });

  function run() {
    const telemetry = recordingTelemetry();
    return cancelAppointment({
      commit: firestoreCommitPlan(
        db,
        StoredDocumentSystem.guardOf,
        telemetry.log,
      ),
      nowUtcMs: pinnedNowUtcMs(),
      nextId: () => 'id-1',
      hash: sha256Hex,
      ...firestoreSettingsPorts(db),
      ...firestoreAuditPorts(db, telemetry),
      ...telemetry,
    })({
      appointmentId: FIXTURE_IDS.appointment,
      callerUserId: FIXTURE_IDS.client,
      reason: CancellationReason.Unspecified,
      actor: Actor.user(FIXTURE_IDS.client),
    });
  }

  it('cancels the visit and gives the voucher back what it paid, in the same transaction', async () => {
    // Thursday — days outside the 24 h window.
    await db.doc(PATH).set(
      bodyOf(
        appointmentFixture({
          localDate: localDate('2026-10-01'),
          utcEpochMs: utcMs('2026-10-01T10:00:00.000+03:00'),
          voucherRedemptions: [LINE],
        }),
      ),
    );

    const answer = await run();

    expect(answer).toEqual({
      ok: true,
      value: { appointmentId: FIXTURE_IDS.appointment },
    });
    const visit = (await db.doc(PATH).get()).data();
    expect(visit).toMatchObject({
      bookingStatus: 'CANCELLED',
      cancelledAtUtcMs: FIXTURE_NOW_UTC_MS,
      voucherRedemptions: [{ ...LINE, reversedAtUtcMs: FIXTURE_NOW_UTC_MS }],
    });
    // One variant on disk: the confirmed variant's stamp is gone.
    expect(visit).not.toHaveProperty('confirmedAtUtcMs');
    expect((await db.doc(VOUCHER_PATH).get()).data()).toMatchObject({
      balanceCents: 3000,
      voucherStatus: 'ACTIVE',
    });
    expect((await db.collection(Collections.AuditLog).get()).size).toBe(1);
  });

  it('refuses inside the window and writes nothing — the visit and the voucher as they were', async () => {
    // The fixture visit is at 10:00 today — an hour away.
    await db
      .doc(PATH)
      .set(bodyOf(appointmentFixture({ voucherRedemptions: [LINE] })));

    const answer = await run();

    expect(!answer.ok && answer.error.errorCode).toBe(
      CancellationRefusalCode.WindowClosed,
    );
    expect((await db.doc(PATH).get()).data()).toMatchObject({
      bookingStatus: 'CONFIRMED',
    });
    expect((await db.doc(VOUCHER_PATH).get()).data()?.['balanceCents']).toBe(
      1000,
    );
    expect((await db.collection(Collections.AuditLog).get()).size).toBe(0);
  });
});
