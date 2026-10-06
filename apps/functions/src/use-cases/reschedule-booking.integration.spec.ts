import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import { ZonedDateTime } from '@creativo/domain/kernel';
import { BookingPolicy } from '@creativo/domain/scheduling';
import { FirestoreBookingStore } from '../adapters/firestore-booking-store';
import { RescheduleBookingUseCase } from './reschedule-booking.use-case';
import { FixedClock } from '../test-support/fixed-clock';

/**
 * A client's move against the REAL Firestore emulator — the transaction, the
 * whole-document `set()` and the busy merge are exactly what an in-memory
 * fake cannot vouch for.
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

const ZONE = 'Europe/Sofia';
const OWNER = 'user-father';
const SON = 'user-son';
const APPOINTMENT = 'appt-father-and-son';
/** 2030-01-15 is a Tuesday; the clock reads the Sunday before. */
const DAY = '2030-01-15';
const NOW_ISO = '2030-01-13T08:00:00.000+02:00';

const HOURS = [
  ...Array.from({ length: 6 }, () => ({
    kind: 'open',
    opens: '09:00',
    closes: '20:00',
  })),
  { kind: 'closed' },
];

function roster(barberId: string) {
  const day = [{ start: '09:00', end: '18:00', locationId: 'loc-center' }];
  return {
    barberId,
    turnaroundMinutes: 0,
    versions: [
      {
        seq: 1,
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        weeklyPattern: { monday: day, tuesday: day, wednesday: day },
      },
    ],
  };
}

function service(id: string, durationMinutes: number, price: number) {
  return {
    name: { bg: id, en: id },
    description: { bg: '—', en: '—' },
    categoryId: 'cat-hair',
    priceMinorUnits: price,
    currencyCode: 'EUR',
    durationMinutes,
    setupMinutes: 0,
    cleanupMinutes: 10,
    locationIds: ['loc-center'],
    conflictsWith: [],
    variants: [],
    offerings: [],
    composition: { kind: 'single' },
    upsellOnly: false,
    popular: false,
    status: 'active',
    sortOrder: 1,
  };
}

function iso(hour: number, minute = 0): string {
  return `${DAY}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000+02:00`;
}

function seat(
  id: string,
  barberId: string,
  serviceId: string,
  durationMinutes: number,
  priceMinorUnits: number,
  subject: Record<string, unknown>,
  hour: number,
  minute = 0,
) {
  const start = ZonedDateTime.fromISO(iso(hour, minute), ZONE);
  if (start.isFailure()) throw new Error('fixture');
  return {
    id,
    serviceId,
    variantId: null,
    barberId,
    barberPref: 'specific',
    terms: {
      priceMinorUnits,
      currencyCode: 'EUR',
      durationMinutes,
      setupMinutes: 0,
      cleanupMinutes: 10,
    },
    slot: {
      startIso: start.value.toISO(),
      endIso: start.value.plusMinutes(durationMinutes).toISO(),
      zone: ZONE,
    },
    subject,
    outcome: { kind: 'scheduled' },
  };
}

describe('RescheduleBookingUseCase (emulator)', () => {
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
    await db
      .collection('locations')
      .doc('loc-center')
      .set({ timezone: ZONE, status: 'active', hours: HOURS });
    await db
      .collection('services')
      .doc('svc-fade')
      .set(service('svc-fade', 45, 4000));
    await db
      .collection('services')
      .doc('svc-beard')
      .set(service('svc-beard', 30, 2000));
    await db.collection('barberSchedules').doc('ivan').set(roster('ivan'));
    await db.collection('barberSchedules').doc('petar').set(roster('petar'));
    await db
      .collection('appointments')
      .doc(APPOINTMENT)
      .set({
        locationId: 'loc-center',
        ownerUserId: OWNER,
        subjectUserIds: [OWNER, SON],
        placement: 'staff',
        barberIds: ['ivan', 'petar'],
        busyKeys: [`ivan__${DAY}`, `petar__${DAY}`],
        timeSlot: { startIso: iso(10), endIso: iso(10, 45), zone: ZONE },
        seats: [
          seat(
            'seat-father',
            'ivan',
            'svc-fade',
            45,
            4000,
            {
              kind: 'account',
              userId: OWNER,
              relationship: 'self',
            },
            10,
          ),
          // Staff seated the son and priced his trim by hand.
          seat(
            'seat-son',
            'petar',
            'svc-beard',
            30,
            1500,
            {
              kind: 'account',
              userId: SON,
              relationship: 'companion',
            },
            10,
          ),
        ],
        status: { kind: 'confirmed' },
        bookedAt: { iso: '2030-01-01T09:00:00.000+02:00', zone: ZONE },
        bookedFromAppointmentId: null,
        arrivedAt: null,
        contact: null,
        revision: 2,
        staffNote: 'идва с малкия',
      });
  });

  function useCase(): RescheduleBookingUseCase {
    let minted = 0;
    return new RescheduleBookingUseCase(
      new FirestoreBookingStore(db),
      new FixedClock(NOW_ISO),
      { next: () => `seat-new-${++minted}` },
      BookingPolicy.default(),
    );
  }

  const MOVE = {
    appointmentId: APPOINTMENT,
    locationId: 'loc-center',
    ownerUserId: OWNER,
    seats: [
      {
        lineId: 'line-1',
        serviceId: 'svc-fade',
        variantId: null,
        barberId: 'ivan',
        barberPref: 'specific' as const,
        startIso: iso(14),
        subject: { kind: 'self' as const },
      },
    ],
  };

  it('moves the father and CARRIES his son — same seat, same terms, new time, both chairs claimed', async () => {
    const result = await useCase().execute(MOVE);
    expect(result.isSuccess()).toBe(true);

    const stored = (
      await db.collection('appointments').doc(APPOINTMENT).get()
    ).data();
    const seats = stored?.['seats'] as Record<string, unknown>[];
    expect(seats).toHaveLength(2);
    const son = seats.find((entry) => entry['id'] === 'seat-son');
    expect(son?.['subject']).toEqual({
      kind: 'account',
      userId: SON,
      relationship: 'companion',
    });
    expect(son?.['terms']).toMatchObject({ priceMinorUnits: 1500 });
    expect((son?.['slot'] as Record<string, unknown>)['startIso']).toBe(
      iso(14),
    );
    expect(stored?.['subjectUserIds']).toEqual([OWNER, SON].sort());
    // The whole-document write kept what the mapper does not own, and
    // counted the change.
    expect(stored?.['staffNote']).toBe('идва с малкия');
    expect(stored?.['revision']).toBe(3);
    expect(stored?.['placement']).toBe('staff');

    const petar = (
      await db.collection('barberBusy').doc(`petar__${DAY}`).get()
    ).data();
    expect(petar?.['busy']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          startIso: expect.stringContaining('T14:00'),
        }),
      ]),
    );
  });

  it('answers a retried move without writing again', async () => {
    await useCase().execute(MOVE);
    const replay = await useCase().execute(MOVE);

    expect(replay.isSuccess()).toBe(true);
    if (replay.isFailure()) return;
    expect(replay.value.replayed).toBe(true);
    expect(replay.value.revision).toBe(3);
    const stored = (
      await db.collection('appointments').doc(APPOINTMENT).get()
    ).data();
    expect(stored?.['revision']).toBe(3);
  });

  it('stamps a NAMED move in the visit’s ledger, and answers its retry from it after the visit moved on', async () => {
    const named = { ...MOVE, attemptId: 'attempt-0123456789abcdef' };
    const first = await useCase().execute(named);
    expect(first.isSuccess()).toBe(true);

    const ref = db.collection('appointments').doc(APPOINTMENT);
    expect((await ref.get()).data()?.['appliedOperations']).toEqual([
      expect.objectContaining({
        id: 'move:attempt-0123456789abcdef',
        revision: 3,
      }),
    ]);

    // The shop touches the visit before the lost response's retry arrives.
    await ref.update({ staffNote: 'дойде по-рано', revision: 4 });
    const replay = await useCase().execute(named);

    expect(replay.isSuccess()).toBe(true);
    if (replay.isFailure()) return;
    expect(replay.value).toMatchObject({
      replayed: true,
      replayedAttempt: true,
      // The move's own revision, from the ledger — not the visit's 4.
      revision: 3,
    });
    const stored = (await ref.get()).data();
    expect(stored?.['revision']).toBe(4);
    expect(stored?.['staffNote']).toBe('дойде по-рано');
  });

  it('refuses the whole move when the son’s barber is taken, and leaves the visit as it was', async () => {
    await db
      .collection('barberBusy')
      .doc(`petar__${DAY}`)
      .set({
        barberId: 'petar',
        dayKey: DAY,
        zone: ZONE,
        busy: [{ startIso: iso(14), endIso: iso(15), zone: ZONE }],
      });

    const result = await useCase().execute(MOVE);

    expect(result.isFailure()).toBe(true);
    if (result.isSuccess()) return;
    expect(result.error.code).toBe(
      'booking.reschedule.carried_seat_unplaceable',
    );
    const stored = (
      await db.collection('appointments').doc(APPOINTMENT).get()
    ).data();
    expect(stored?.['revision']).toBe(2);
    expect((stored?.['timeSlot'] as Record<string, unknown>)['startIso']).toBe(
      iso(10),
    );
  });

  it('refuses a visit left holding only the son — the shop moves it — and writes nothing', async () => {
    // Staff removed the father's own seat when he could not come.
    const visit = db.collection('appointments').doc(APPOINTMENT);
    const before = (await visit.get()).data() ?? {};
    await visit.set({
      ...before,
      subjectUserIds: [SON],
      barberIds: ['petar'],
      busyKeys: [`petar__${DAY}`],
      seats: (before['seats'] as Record<string, unknown>[]).filter(
        (entry) => entry['id'] === 'seat-son',
      ),
    });

    const result = await useCase().execute(MOVE);

    expect(result.isFailure()).toBe(true);
    if (result.isSuccess()) return;
    expect(result.error.code).toBe(
      'booking.reschedule.carried_seat_unplaceable',
    );
    expect(result.error.params).toMatchObject({ refusal: 'shop_only' });
    const stored = (await visit.get()).data();
    expect(stored?.['revision']).toBe(2);
    expect(stored?.['seats']).toHaveLength(1);
  });
});
