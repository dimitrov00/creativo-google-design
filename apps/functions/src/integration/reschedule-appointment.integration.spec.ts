import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import {
  Actor,
  BlockKind,
  MinuteBlock,
  Seat,
  SeatOccupant,
  SubjectRelationship,
  RequestedSubjectRole,
} from '@core/components';
import {
  BarberId,
  BusyKey,
  ClientOperationId,
  CustomerId,
  OperationId,
  SeatId,
  ServiceId,
  UserId,
} from '@core/primitives';
import { CarriedSeatRefusal, MoveErrorCode } from '@core/errors';
import { type Appointment, Collections } from '@core/entities';
import { ZonedTimeSystem } from '@core/systems';
import {
  type RescheduleAppointmentCommand,
  rescheduleAppointment,
} from '@core/pipelines';
import {
  appointmentFixture,
  at,
  barberBusyDayFixture,
  barberFixture,
  barberScheduleFixture,
  FIXTURE_IDS,
  FIXTURE_TIME_ZONE,
  localDate,
  locationFixture,
  pinnedNowUtcMs,
  recordingTelemetry,
  seatFixture,
  serviceFixture,
  termsFixture,
  until,
  utcMs,
} from '@core/testing';
import { sha256Hex } from '../adapters/crypto.adapter';
import { firestoreAuditPorts } from '../adapters/firestore-audit.adapter';
import { firestoreSettingsPorts } from '../adapters/firestore-settings.adapter';
import { firestoreCommitPlan } from '../adapters/firestore-tx.adapter';

/**
 * A client's move against the REAL Firestore emulator — the successor of
 * `use-cases/reschedule-booking.integration.spec.ts` (flip 1 §5.2): the
 * transaction, the root-field `Update` of the placement and the busy merge
 * are exactly what an in-memory plan cannot vouch for.
 *
 * Emulator-only by construction (same guard as the seed): refuses to run
 * without a local `FIRESTORE_EMULATOR_HOST`, and uses its own demo project so
 * the wipe between tests never touches the dev stack's data.
 */
const PROJECT_ID = 'demo-functions-reschedule';

const EMULATOR_HOST = (process.env['FIRESTORE_EMULATOR_HOST'] ??=
  '127.0.0.1:8080');
if (!EMULATOR_HOST.includes('127.0.0.1')) {
  throw new Error('Refusing to run outside the local emulators.');
}

const PETAR = BarberId.of('b-petar');
const SON = UserId.of('u-son');
const SON_CUSTOMER = CustomerId.forUser(SON, sha256Hex);
const SON_SEAT = SeatId.of('seat-son');
const BEARD = ServiceId.of('svc-beard');
/** Thursday and Friday of the week the pinned Monday 09:00 opens. */
const THURSDAY = localDate('2026-10-01');
const FRIDAY = localDate('2026-10-02');
const PATH = `${Collections.Appointments}/${FIXTURE_IDS.appointment}`;
const ATTEMPT = ((): ClientOperationId => {
  const id = ClientOperationId.parse('attempt-0123456789abcdef');
  if (!id.ok) throw new Error('a broken fixture');
  return id.value;
})();

function bodyOf(entity: { readonly id: string }): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(entity).filter(([key]) => key !== 'id'),
  );
}

const BEARD_TERMS = termsFixture(2000, 30);

/** The father's cut with Ivan and — seated by the shop, priced by hand — his son's beard with Petar, both at 10:00. */
function fatherAndSon(): Appointment {
  const father = seatFixture();
  const son = seatFixture({
    seatId: SON_SEAT,
    serviceId: BEARD,
    barberId: PETAR,
    terms: Seat.termsOf(termsFixture(1500, 30), BEARD_TERMS),
    occupant: SeatOccupant.account(
      SON,
      SON_CUSTOMER,
      SubjectRelationship.Companion,
    ),
  });
  return appointmentFixture({
    localDate: THURSDAY,
    utcEpochMs: utcMs('2026-10-01T10:00:00.000+03:00'),
    seats: [father, son],
    subjectUserIds: [FIXTURE_IDS.client, SON],
    subjectCustomerIds: [FIXTURE_IDS.customer, SON_CUSTOMER],
    barberIds: [FIXTURE_IDS.barber, PETAR],
    busyKeys: [
      BusyKey.of(FIXTURE_IDS.barber, THURSDAY),
      BusyKey.of(PETAR, THURSDAY),
    ],
    revision: 1,
  });
}

const MOVE: RescheduleAppointmentCommand = {
  appointmentId: FIXTURE_IDS.appointment,
  callerUserId: FIXTURE_IDS.client,
  locationId: FIXTURE_IDS.location,
  // The shop's wall clock — the pipeline places it on the location's zone (4A-4).
  localDate: FRIDAY,
  seats: [
    {
      lineId: 'line-1',
      serviceId: FIXTURE_IDS.service,
      variantId: null,
      barberId: FIXTURE_IDS.barber,
      barberPreference: null,
      startMinutes: 14 * 60,
      subject: { requestedSubjectRole: RequestedSubjectRole.Self },
    },
  ],
  attemptId: null,
  actor: Actor.user(FIXTURE_IDS.client),
};

describe('rescheduleAppointment (emulator)', () => {
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
      [`${Collections.Barbers}/${PETAR}`, bodyOf(barberFixture({ id: PETAR }))],
      [
        `${Collections.Services}/${FIXTURE_IDS.service}`,
        bodyOf(serviceFixture()),
      ],
      [
        `${Collections.Services}/${BEARD}`,
        bodyOf(
          serviceFixture({
            id: BEARD,
            ...BEARD_TERMS,
            offerings: [{ barberId: PETAR, overrides: [], ...BEARD_TERMS }],
          }),
        ),
      ],
      [
        `${Collections.BarberSchedules}/${FIXTURE_IDS.barber}`,
        bodyOf(barberScheduleFixture()),
      ],
      [
        `${Collections.BarberSchedules}/${PETAR}`,
        bodyOf(barberScheduleFixture({ id: PETAR })),
      ],
      [PATH, bodyOf(fatherAndSon())],
    ];
    for (const [path, body] of writes) await db.doc(path).set(body);
  });

  function run(cmd: RescheduleAppointmentCommand) {
    const telemetry = recordingTelemetry();
    let minted = 0;
    return rescheduleAppointment({
      commit: firestoreCommitPlan(db),
      nowUtcMs: pinnedNowUtcMs(),
      nextId: () => `id-${++minted}`,
      hash: sha256Hex,
      ...firestoreSettingsPorts(db),
      ...firestoreAuditPorts(db, telemetry),
      ...telemetry,
    })(cmd);
  }

  const stored = async (): Promise<Record<string, unknown>> =>
    (await db.doc(PATH).get()).data() ?? {};

  it('moves the father and CARRIES his son — same seat, same terms, new time, both chairs claimed', async () => {
    const answer = await run(MOVE);
    expect(answer).toEqual({
      ok: true,
      value: {
        appointmentId: FIXTURE_IDS.appointment,
        revision: 2,
        replayed: false,
      },
    });

    const visit = await stored();
    const seats = visit['seats'] as readonly Record<string, unknown>[];
    expect(seats).toHaveLength(2);
    const son = seats.find((seat) => seat['seatId'] === SON_SEAT);
    expect(son).toMatchObject({
      seatSubject: 'ACCOUNT',
      subjectUserId: SON,
      subjectCustomerId: SON_CUSTOMER,
      subjectRelationship: 'COMPANION',
      priceCents: 1500,
      startMinutes: at(14),
    });
    expect(visit).toMatchObject({
      localDate: FRIDAY,
      startMinutes: at(14),
      utcEpochMs: utcMs('2026-10-02T14:00:00.000+03:00'),
      subjectUserIds: [FIXTURE_IDS.client, SON],
      busyKeys: [
        BusyKey.of(FIXTURE_IDS.barber, FRIDAY),
        BusyKey.of(PETAR, FRIDAY),
      ],
      revision: 2,
      // The root-field Update kept what the move does not own.
      placement: 'SELF',
      bookedAtUtcMs: fatherAndSon().bookedAtUtcMs,
      bookingStatus: 'CONFIRMED',
    });

    const petar = (
      await db
        .doc(`${Collections.BarberBusy}/${BusyKey.of(PETAR, FRIDAY)}`)
        .get()
    ).data();
    expect(petar).toMatchObject({
      barberId: PETAR,
      localDate: FRIDAY,
      utcEpochMs: ZonedTimeSystem.startOfLocalDay(FRIDAY, FIXTURE_TIME_ZONE),
      blocks: [expect.objectContaining({ startMinutes: at(14) })],
    });
    // The busy day carries its TTL stamp, written by the adapter alone.
    expect(petar?.['purgeAt']).toBeDefined();
  });

  it('answers a retried move without writing again', async () => {
    await run(MOVE);
    const replay = await run(MOVE);

    expect(replay).toEqual({
      ok: true,
      value: {
        appointmentId: FIXTURE_IDS.appointment,
        revision: 2,
        replayed: true,
      },
    });
    expect((await stored())['revision']).toBe(2);
  });

  it('stamps a NAMED move in the visit’s ledger, and answers its retry from it after the visit moved on', async () => {
    const named = { ...MOVE, attemptId: ATTEMPT };
    const first = await run(named);
    expect(first.ok).toBe(true);

    expect((await stored())['appliedOperations']).toEqual([
      expect.objectContaining({
        operationId: OperationId.of(`move:${ATTEMPT}`),
        revision: 2,
      }),
    ]);

    // The shop touches the visit before the lost response's retry arrives.
    await db.doc(PATH).update({ revision: 3, contactNote: 'дойде по-рано' });
    const replay = await run(named);

    // The move's own revision, from the ledger — not the visit's 3.
    expect(replay).toEqual({
      ok: true,
      value: {
        appointmentId: FIXTURE_IDS.appointment,
        revision: 2,
        replayed: true,
      },
    });
    expect(await stored()).toMatchObject({
      revision: 3,
      contactNote: 'дойде по-рано',
    });
  });

  it('refuses the whole move when the son’s barber is taken, and leaves the visit as it was', async () => {
    const taken = BusyKey.of(PETAR, FRIDAY);
    await db.doc(`${Collections.BarberBusy}/${taken}`).set(
      bodyOf(
        barberBusyDayFixture({
          barberId: PETAR,
          localDate: FRIDAY,
          utcEpochMs: ZonedTimeSystem.startOfLocalDay(
            FRIDAY,
            FIXTURE_TIME_ZONE,
          ),
          blocks: [MinuteBlock.of(at(14), until(15), BlockKind.Busy)],
        }),
      ),
    );

    const answer = await run(MOVE);

    expect(!answer.ok && answer.error).toMatchObject({
      errorCode: MoveErrorCode.CarriedSeatUnplaceable,
      seatIds: [SON_SEAT],
    });
    expect(await stored()).toMatchObject({
      revision: 1,
      localDate: THURSDAY,
      startMinutes: at(10),
    });
  });

  it('refuses a visit left holding only the son — the shop moves it — and writes nothing', async () => {
    // Staff removed the father's own seat when he could not come.
    const onlySon = fatherAndSon();
    await db.doc(PATH).update({
      seats: onlySon.seats.filter((seat) => seat.seatId === SON_SEAT),
      subjectUserIds: [SON],
      subjectCustomerIds: [SON_CUSTOMER],
      barberIds: [PETAR],
      busyKeys: [BusyKey.of(PETAR, THURSDAY)],
    });

    const answer = await run(MOVE);

    expect(!answer.ok && answer.error).toMatchObject({
      errorCode: MoveErrorCode.CarriedSeatUnplaceable,
      refusal: CarriedSeatRefusal.ShopOnly,
    });
    const visit = await stored();
    expect(visit['revision']).toBe(1);
    expect(visit['seats']).toHaveLength(1);
  });
});
