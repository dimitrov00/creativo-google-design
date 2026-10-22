import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import {
  Actor,
  BarberPreference,
  RequestedSubjectRole,
} from '@core/components';
import {
  AppointmentId,
  BusyKey,
  CustomerId,
  UtcEpochMs,
} from '@core/primitives';
import { Collections } from '@core/entities';
import { type BookAppointmentCommand, bookAppointment } from '@core/pipelines';
import {
  barberFixture,
  barberScheduleFixture,
  FIXTURE_IDS,
  localDate,
  locationFixture,
  pinnedNowUtcMs,
  recordingTelemetry,
  serviceFixture,
  utcMs,
} from '@core/testing';
import { sha256Hex } from '../adapters/crypto.adapter';
import { firestoreAccountPorts } from '../adapters/firestore-accounts.adapter';
import { firestoreAuditPorts } from '../adapters/firestore-audit.adapter';
import { firestoreSettingsPorts } from '../adapters/firestore-settings.adapter';
import { firestoreCommitPlan } from '../adapters/firestore-tx.adapter';

/**
 * A client's booking against the REAL Firestore emulator (flip 1 §5.3):
 * the attempt id IS the appointment id, so a retried commit finds its own
 * document and answers it; and the client record a first booking creates
 * (D29, F1-5) is created ONCE however many first bookings race for it — the
 * loser's transaction re-reads a record that is there, or its `Create`
 * meets ALREADY_EXISTS and the pipeline re-runs it once.
 *
 * Emulator-only by construction, on a demo project of its own.
 */
const PROJECT_ID = 'demo-functions-book';

const EMULATOR_HOST = (process.env['FIRESTORE_EMULATOR_HOST'] ??=
  '127.0.0.1:8080');
if (!EMULATOR_HOST.includes('127.0.0.1')) {
  throw new Error('Refusing to run outside the local emulators.');
}

/** Thursday of the week the pinned Monday 09:00 opens. */
const THURSDAY = localDate('2026-10-01');
const CUSTOMER = CustomerId.forUser(FIXTURE_IDS.client, sha256Hex);
const ATTEMPT = AppointmentId.of('attempt-0123456789abcdef');

function bodyOf(entity: { readonly id: string }): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entity).filter(([key]) => key !== 'id'),
  );
}

/** A booking on the shop's wall clock — the pipeline places it on the location's zone (4A-4). */
function booking(
  attemptId: AppointmentId,
  startMinutes: number,
): BookAppointmentCommand {
  return {
    locationId: FIXTURE_IDS.location,
    localDate: THURSDAY,
    seats: [
      {
        lineId: 'line-1',
        serviceId: FIXTURE_IDS.service,
        variantId: null,
        barberId: FIXTURE_IDS.barber,
        barberPreference: BarberPreference.Specific,
        startMinutes,
        subject: { requestedSubjectRole: RequestedSubjectRole.Self },
      },
    ],
    attemptId,
    bookedFromAppointmentId: null,
    contact: null,
    ownerUserId: FIXTURE_IDS.client,
    staffPlacement: false,
    actor: Actor.user(FIXTURE_IDS.client),
  };
}

describe('bookAppointment (emulator)', () => {
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
    const writes: readonly (readonly [string, Record<string, unknown>])[] = [
      [
        `${Collections.Locations}/${FIXTURE_IDS.location}`,
        bodyOf(locationFixture()),
      ],
      [`${Collections.Barbers}/${FIXTURE_IDS.barber}`, bodyOf(barberFixture())],
      [
        `${Collections.Services}/${FIXTURE_IDS.service}`,
        bodyOf(serviceFixture()),
      ],
      [
        `${Collections.BarberSchedules}/${FIXTURE_IDS.barber}`,
        bodyOf(barberScheduleFixture()),
      ],
      // The account a first booking copies its contact from.
      [
        `${Collections.Users}/${FIXTURE_IDS.client}`,
        {
          firstName: 'Maria',
          lastName: 'Ivanova',
          phone: '+359888123456',
          email: null,
        },
      ],
    ];
    for (const [path, body] of writes) await db.doc(path).set(body);
  });

  function run(cmd: BookAppointmentCommand) {
    const telemetry = recordingTelemetry();
    let minted = 0;
    return bookAppointment({
      commit: firestoreCommitPlan(db),
      nowUtcMs: pinnedNowUtcMs(),
      nextId: () => `id-${++minted}`,
      hash: sha256Hex,
      ...firestoreSettingsPorts(db),
      ...firestoreAccountPorts(db),
      ...firestoreAuditPorts(db, telemetry),
      ...telemetry,
    })(cmd);
  }

  const ids = async (collection: string): Promise<readonly string[]> =>
    (await db.collection(collection).get()).docs.map((doc) => doc.id).sort();

  it('books once, and answers a retried attempt with the original id, writing nothing more', async () => {
    const first = await run(booking(ATTEMPT, 600));
    expect(first).toEqual({
      ok: true,
      value: { appointmentId: ATTEMPT, replayed: false },
    });

    const ref = db.doc(`${Collections.Appointments}/${ATTEMPT}`);
    const written = await ref.get();
    expect(written.data()).toMatchObject({
      bookingStatus: 'CONFIRMED',
      localDate: THURSDAY,
      utcEpochMs: utcMs('2026-10-01T10:00:00.000+03:00'),
      ownerUserId: FIXTURE_IDS.client,
      ownerCustomerId: CUSTOMER,
      subjectCustomerIds: [CUSTOMER],
      busyKeys: [BusyKey.of(FIXTURE_IDS.barber, THURSDAY)],
    });
    expect(
      (
        await db
          .doc(
            `${Collections.BarberBusy}/${BusyKey.of(FIXTURE_IDS.barber, THURSDAY)}`,
          )
          .get()
      ).data()?.['purgeAt'],
    ).toBeDefined();
    expect(await ids(Collections.AuditLog)).toHaveLength(1);

    const replay = await run(booking(ATTEMPT, 600));

    expect(replay).toEqual({
      ok: true,
      value: { appointmentId: ATTEMPT, replayed: true },
    });
    expect((await ref.get()).updateTime?.isEqual(written.updateTime!)).toBe(
      true,
    );
    expect(await ids(Collections.Appointments)).toEqual([ATTEMPT]);
    expect(await ids(Collections.AuditLog)).toHaveLength(1);
  });

  it('creates the client record of a first booking — the account’s contact copied — and never twice when two first bookings race', async () => {
    const second = AppointmentId.of('attempt-fedcba9876543210');
    const [one, two] = await Promise.all([
      run(booking(ATTEMPT, 600)),
      run(booking(second, 840)),
    ]);
    expect(one.ok && two.ok).toBe(true);

    expect(await ids(Collections.Customers)).toEqual([CUSTOMER]);
    const record = (
      await db.doc(`${Collections.Customers}/${CUSTOMER}`).get()
    ).data();
    expect(record).toMatchObject({
      userId: FIXTURE_IDS.client,
      displayName: 'Maria Ivanova',
      phone: '+359888123456',
      customerOrigin: 'FIRST_BOOKING',
    });
    expect(UtcEpochMs.of(Number(record?.['createdAtUtcMs'])).ok).toBe(true);
    for (const id of [ATTEMPT, second]) {
      expect(
        (await db.doc(`${Collections.Appointments}/${id}`).get()).data()?.[
          'ownerCustomerId'
        ],
      ).toBe(CUSTOMER);
    }
  });
});
