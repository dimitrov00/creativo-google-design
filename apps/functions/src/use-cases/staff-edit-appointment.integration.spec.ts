import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { BookingPolicy } from '@creativo/domain/scheduling';
import { FirestoreBookingStore } from '../adapters/firestore-booking-store';
import { FixedClock } from '../test-support/fixed-clock';
import { staffEditAppointment } from '../lib/booking/staff-edit-appointment';
import { RescheduleBookingUseCase } from './reschedule-booking.use-case';
import { StaffEditAppointmentUseCase } from './staff-edit-appointment.use-case';

/**
 * The CALLABLE reads its Firestore through `adminFirestore()`; here that is
 * this suite's own emulator project, so the production path (the callable,
 * the real use case, the real store, the audit rows) runs end to end.
 */
const wired = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('../lib/firebase-admin', () => ({
  adminFirestore: () => wired.db,
  adminAuth: () => {
    throw new Error('no Auth in this suite');
  },
}));

/**
 * One NAMED staff intent against the REAL Firestore emulator: the ledger is
 * decided inside the edit's transaction and written by the same
 * whole-document `set()` that applies the edit, and it has to survive the
 * OTHER whole-document writer — a client's move — for a late re-send to be
 * recognised. Those are exactly the semantics an in-memory fake cannot vouch
 * for.
 *
 * Emulator-only by construction (the same guard as the seed and the move's
 * suite), with its own demo project so the wipe between tests never touches
 * the dev stack's data.
 */
const PROJECT_ID = 'demo-functions-staff-operations';

const EMULATOR_HOST = (process.env['FIRESTORE_EMULATOR_HOST'] ??=
  '127.0.0.1:8080');
if (!EMULATOR_HOST.includes('127.0.0.1')) {
  throw new Error('Refusing to run outside the local emulators.');
}

const ZONE = 'Europe/Sofia';
const OWNER = 'user-ana';
const APPOINTMENT = 'appt-ana';
/** 2030-01-15 is a Tuesday; the clock reads the Sunday before. */
const DAY = '2030-01-15';
const NOW_ISO = '2030-01-13T08:00:00.000+02:00';
const OPERATION = 'operation-0123456789abcdef';

const HOURS = [
  ...Array.from({ length: 6 }, () => ({
    kind: 'open',
    opens: '09:00',
    closes: '20:00',
  })),
  { kind: 'closed' },
];

function iso(hour: number, minute = 0): string {
  return `${DAY}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000+02:00`;
}

describe('StaffEditAppointmentUseCase — one named intent, one change (emulator)', () => {
  let db: Firestore;

  beforeAll(() => {
    const app =
      admin.apps.find((a) => a?.name === PROJECT_ID) ??
      admin.initializeApp({ projectId: PROJECT_ID }, PROJECT_ID);
    db = app.firestore();
    wired.db = db;
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
      .set({
        name: { bg: 'Фейд', en: 'Fade' },
        description: { bg: '—', en: '—' },
        categoryId: 'cat-hair',
        priceMinorUnits: 4000,
        currencyCode: 'EUR',
        durationMinutes: 45,
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
      });
    const day = [{ start: '09:00', end: '18:00', locationId: 'loc-center' }];
    await db
      .collection('barberSchedules')
      .doc('ivan')
      .set({
        barberId: 'ivan',
        turnaroundMinutes: 0,
        versions: [
          {
            seq: 1,
            effectiveFrom: '2026-01-01',
            effectiveTo: null,
            weeklyPattern: { monday: day, tuesday: day, wednesday: day },
          },
        ],
      });
    await db
      .collection('appointments')
      .doc(APPOINTMENT)
      .set({
        locationId: 'loc-center',
        ownerUserId: OWNER,
        subjectUserIds: [OWNER],
        placement: 'self',
        barberIds: ['ivan'],
        busyKeys: [`ivan__${DAY}`],
        timeSlot: { startIso: iso(10), endIso: iso(10, 45), zone: ZONE },
        seats: [
          {
            id: 'seat-ana',
            serviceId: 'svc-fade',
            variantId: null,
            barberId: 'ivan',
            barberPref: 'specific',
            terms: {
              priceMinorUnits: 4000,
              currencyCode: 'EUR',
              durationMinutes: 45,
              setupMinutes: 0,
              cleanupMinutes: 10,
            },
            slot: { startIso: iso(10), endIso: iso(10, 45), zone: ZONE },
            subject: { kind: 'account', userId: OWNER, relationship: 'self' },
            outcome: { kind: 'scheduled' },
          },
        ],
        status: { kind: 'confirmed' },
        bookedAt: { iso: '2030-01-01T09:00:00.000+02:00', zone: ZONE },
        bookedFromAppointmentId: null,
        arrivedAt: null,
        contact: null,
        revision: 2,
      });
  });

  const clock = new FixedClock(NOW_ISO);

  function staffEdit(
    startIso: string,
    extra: { operationId?: string; expectedVersion?: number } = {},
  ) {
    return new StaffEditAppointmentUseCase(
      new FirestoreBookingStore(db),
      clock,
      BookingPolicy.default(),
    ).execute({
      appointmentId: APPOINTMENT,
      actorUserId: 'staff-ivan',
      actorRoles: ['barber'],
      command: { kind: 'move', startIso },
      ...extra,
    });
  }

  async function stored(): Promise<Record<string, unknown>> {
    return (
      (await db.collection('appointments').doc(APPOINTMENT).get()).data() ?? {}
    );
  }

  it('stamps the intent beside the edit, and answers its re-send without writing again', async () => {
    const first = await staffEdit(iso(11), {
      operationId: OPERATION,
      expectedVersion: 2,
    });
    expect(first.isSuccess() && first.value).toEqual({
      appointmentId: APPOINTMENT,
      revision: 3,
      replayed: false,
    });
    const afterFirst = await stored();
    expect(afterFirst['revision']).toBe(3);
    expect(afterFirst['appliedOperations']).toEqual([
      { id: OPERATION, revision: 3, digest: expect.any(String) },
    ]);

    // The response was lost; the sheet sends the same save again, still
    // claiming the revision it was drawn from.
    const resent = await staffEdit(iso(11), {
      operationId: OPERATION,
      expectedVersion: 2,
    });

    expect(resent.isSuccess() && resent.value).toEqual({
      appointmentId: APPOINTMENT,
      revision: 3,
      replayed: true,
    });
    expect(await stored()).toEqual(afterFirst);
  });

  it("keeps the ledger through a client's move, so a late re-send is still recognised", async () => {
    await staffEdit(iso(11), { operationId: OPERATION });
    let minted = 0;
    const moved = await new RescheduleBookingUseCase(
      new FirestoreBookingStore(db),
      clock,
      { next: () => `seat-new-${++minted}` },
      BookingPolicy.default(),
    ).execute({
      appointmentId: APPOINTMENT,
      locationId: 'loc-center',
      ownerUserId: OWNER,
      seats: [
        {
          lineId: 'line-1',
          serviceId: 'svc-fade',
          variantId: null,
          barberId: 'ivan',
          barberPref: 'specific',
          startIso: iso(14),
          subject: { kind: 'self' },
        },
      ],
    });
    expect(moved.isSuccess()).toBe(true);
    const afterMove = await stored();
    expect(afterMove['revision']).toBe(4);
    expect(afterMove['appliedOperations']).toEqual([
      expect.objectContaining({ id: OPERATION, revision: 3 }),
    ]);

    const resent = await staffEdit(iso(11), { operationId: OPERATION });

    // Answered, not re-applied over the client's 14:00.
    expect(resent.isSuccess() && resent.value).toEqual({
      appointmentId: APPOINTMENT,
      revision: 3,
      replayed: true,
    });
    expect(await stored()).toEqual(afterMove);
  });

  it('applies an unnamed send every time, exactly as before', async () => {
    await staffEdit(iso(11));
    await staffEdit(iso(11));

    const after = await stored();
    expect(after['revision']).toBe(4);
    expect(after['appliedOperations']).toBeUndefined();
  });

  /*
   * ONE PERSON, ONE CHAIR, THROUGH THE CALLABLE (round 4, 2026-09-25; by
   * seat identity since round 5). A visit that already seats one walk-in
   * label in two chairs at once (booked before the sheet numbered its
   * strangers) still takes any save that makes it no worse — the pair left
   * where it stood, dragged whole, or one of its seats moved — and a batch
   * that puts a person in two chairs ANEW is refused on the wire as
   * `booking.commit.invalid_input` naming the field.
   */
  describe('a double seating the visit already held (callable)', () => {
    const PAIR = 'appt-pair';
    const WALK_IN = 'Случаен клиент';

    function guestSeat(id: string, barberId: string, label = WALK_IN) {
      return {
        id,
        serviceId: 'svc-fade',
        variantId: null,
        barberId,
        barberPref: 'specific',
        terms: {
          priceMinorUnits: 4000,
          currencyCode: 'EUR',
          durationMinutes: 45,
          setupMinutes: 0,
          cleanupMinutes: 10,
        },
        slot: { startIso: iso(10), endIso: iso(10, 45), zone: ZONE },
        subject: { kind: 'anonymous', label },
        outcome: { kind: 'scheduled' },
      };
    }

    beforeEach(async () => {
      const day = [{ start: '09:00', end: '18:00', locationId: 'loc-center' }];
      await db
        .collection('barberSchedules')
        .doc('petar')
        .set({
          barberId: 'petar',
          turnaroundMinutes: 0,
          versions: [
            {
              seq: 1,
              effectiveFrom: '2026-01-01',
              effectiveTo: null,
              weeklyPattern: { monday: day, tuesday: day, wednesday: day },
            },
          ],
        });
      await db
        .collection('appointments')
        .doc(PAIR)
        .set({
          locationId: 'loc-center',
          ownerUserId: null,
          subjectUserIds: [],
          placement: 'staff',
          barberIds: ['ivan', 'petar'],
          busyKeys: [`ivan__${DAY}`, `petar__${DAY}`],
          timeSlot: { startIso: iso(10), endIso: iso(10, 45), zone: ZONE },
          seats: [guestSeat('seat-a', 'ivan'), guestSeat('seat-b', 'petar')],
          status: { kind: 'confirmed' },
          bookedAt: { iso: '2030-01-01T09:00:00.000+02:00', zone: ZONE },
          bookedFromAppointmentId: null,
          arrivedAt: null,
          contact: null,
          revision: 2,
        });
    });

    function call(
      command: unknown,
      extra: Record<string, unknown> = {},
    ): Promise<unknown> {
      return staffEditAppointment.run({
        data: { appointmentId: PAIR, command, ...extra },
        auth: { uid: 'staff-ivan', token: { roles: ['barber'] } },
      } as unknown as CallableRequest);
    }

    async function pair(): Promise<Record<string, unknown>> {
      return (await db.collection('appointments').doc(PAIR).get()).data() ?? {};
    }

    it('saves a batch that leaves the pair where it stood', async () => {
      await expect(
        call({ kind: 'reprice', seatId: 'seat-a', priceMinorUnits: 3000 }),
      ).resolves.toEqual({ appointmentId: PAIR, revision: 3 });

      const after = await pair();
      const seats = after['seats'] as readonly Record<string, unknown>[];
      expect(
        seats.map((seat) => [
          seat['barberId'],
          (seat['slot'] as Record<string, unknown>)['startIso'],
          (seat['subject'] as Record<string, unknown>)['label'],
        ]),
      ).toEqual([
        ['ivan', iso(10), WALK_IN],
        ['petar', iso(10), WALK_IN],
      ]);
      expect(
        (seats[0]?.['terms'] as Record<string, unknown>)['priceMinorUnits'],
      ).toBe(3000);
    });

    it('refuses a batch that seats one person twice, naming the field', async () => {
      const newPair = (seatId: string, barberId: string) => ({
        kind: 'addSeat',
        seatId,
        serviceId: 'svc-fade',
        barberId,
        startIso: iso(11),
        minutes: 45,
        subject: { kind: 'guest', label: 'Мария' },
      });
      await expect(
        call([newPair('seat-c', 'ivan'), newPair('seat-d', 'petar')]),
      ).rejects.toMatchObject({
        code: 'invalid-argument',
        details: {
          code: 'booking.commit.invalid_input',
          params: { field: 'person_overlap' },
        },
      });
      expect((await pair())['revision']).toBe(2);
    });

    // Round 5: the round-4 grandfather matched positions, so dragging the
    // whole visit — which leaves it no worse — was refused with the
    // client's "pick another time", and no time would do.
    it('saves a whole-visit drag of the pair, then a move of one seat that still overlaps', async () => {
      await expect(
        call({ kind: 'move', startIso: iso(11) }, { expectedVersion: 2 }),
      ).resolves.toEqual({ appointmentId: PAIR, revision: 3 });
      await expect(
        call(
          { kind: 'move', seatIds: ['seat-b'], startIso: iso(11, 15) },
          { expectedVersion: 3 },
        ),
      ).resolves.toEqual({ appointmentId: PAIR, revision: 4 });

      const seats = (await pair())['seats'] as readonly Record<
        string,
        unknown
      >[];
      expect(
        seats.map((seat) => [
          seat['id'],
          (seat['slot'] as Record<string, unknown>)['startIso'],
        ]),
      ).toEqual([
        ['seat-a', iso(11)],
        ['seat-b', iso(11, 15)],
      ]);
    });

    // Round 6: «Отмени» restores exactly what the save changed. A save that
    // removed one seat of the pair remembers the pair, under the revision
    // it stamped; the undo made on that stamp puts the seat back under its
    // old id. Anything written in between, and the seat is new again.
    const readdSeatB = {
      kind: 'addSeat',
      seatId: 'seat-b',
      serviceId: 'svc-fade',
      barberId: 'petar',
      startIso: iso(10),
      minutes: 45,
      subject: { kind: 'guest', label: WALK_IN },
    };

    it('lets the undo of a removal put the seat of the pair back', async () => {
      await expect(
        call({ kind: 'removeSeat', seatId: 'seat-b' }, { expectedVersion: 2 }),
      ).resolves.toEqual({ appointmentId: PAIR, revision: 3 });
      expect((await pair())['stoodSeatPairs']).toEqual({
        revision: 3,
        pairs: [{ seatId: 'seat-a', otherSeatId: 'seat-b' }],
      });

      await expect(call(readdSeatB, { expectedVersion: 3 })).resolves.toEqual({
        appointmentId: PAIR,
        revision: 4,
      });

      const after = await pair();
      const seats = after['seats'] as readonly Record<string, unknown>[];
      expect(seats.map((seat) => [seat['id'], seat['barberId']])).toEqual([
        ['seat-a', 'ivan'],
        ['seat-b', 'petar'],
      ]);
      expect(after['stoodSeatPairs']).toBeUndefined();
    });

    it('judges the seat new once another save landed after the removal', async () => {
      await call(
        { kind: 'removeSeat', seatId: 'seat-b' },
        { expectedVersion: 2 },
      );
      await call(
        { kind: 'reprice', seatId: 'seat-a', priceMinorUnits: 3000 },
        { expectedVersion: 3 },
      );

      await expect(
        call(readdSeatB, { expectedVersion: 4 }),
      ).rejects.toMatchObject({
        code: 'invalid-argument',
        details: {
          code: 'booking.commit.invalid_input',
          params: { field: 'person_overlap' },
        },
      });
      expect((await pair())['revision']).toBe(4);
    });

    // Round 5: the sheet claims the revision its draft was drawn from; a
    // colleague's save since is refused, typed, and nothing is written.
    it('refuses a save from a stale screen as failed-precondition, writing nothing', async () => {
      await call({ kind: 'move', startIso: iso(11) }, { expectedVersion: 2 });
      await expect(
        call({ kind: 'move', startIso: iso(12) }, { expectedVersion: 2 }),
      ).rejects.toMatchObject({
        code: 'failed-precondition',
        details: {
          code: 'booking.staffEdit.stale',
          params: { expected: '2', actual: '3' },
        },
      });
      expect((await pair())['revision']).toBe(3);
    });
  });
});
