import { describe, expect, it } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { BookingPolicy } from '@creativo/domain/scheduling';
import {
  type StaffEditCommand,
  appointmentFromDocument,
} from '@creativo/application/booking';
import { FirestoreBookingStore } from '../adapters/firestore-booking-store';
import { createProjectionFirestore } from '../test-support/fake-projection-firestore';
import { FixedClock } from '../test-support/fixed-clock';
import { StaffEditAppointmentUseCase } from './staff-edit-appointment.use-case';

/*
 * «ОТМЕНИ» OF A SAVE THAT BROKE A HELD PAIR, ON THE PRODUCTION PATH (round
 * 6): the real use case, the real `FirestoreBookingStore` and its real
 * write (the extra fields, then the mapper's), over the in-memory Admin SDK.
 * What the save remembers has to survive the store's own `set()` and be
 * read back by the next edit's plan, or the undo is refused all the same.
 *
 * The busy projection is left out: the span a save vacates is cleared by
 * the rebuild trigger, which this suite does not run, and the sheet's own
 * retry covers the moment before it does. Only the people rule is at stake.
 */

const ZONE = 'Europe/Sofia';
const APPOINTMENT = 'appt-walk-ins';
/** 2030-01-15 is a Tuesday. */
const DAY = '2030-01-15';
const WALK_IN = 'Случаен клиент';

function iso(hour: number, minute = 0): string {
  return `${DAY}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000+02:00`;
}

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
        weeklyPattern: { tuesday: day },
      },
    ],
  };
}

function walkIn(id: string, barberId: string) {
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
    subject: { kind: 'anonymous', label: WALK_IN },
    outcome: { kind: 'scheduled' },
  };
}

/**
 * Two walk-ins under the old shared label, side by side at 10:00 with Ivan
 * and Petar — one person in two chairs, from before the rule — at
 * revision 1.
 */
function seeded() {
  return createProjectionFirestore({
    'locations/loc-center': {
      timezone: ZONE,
      status: 'active',
      hours: [
        ...Array.from({ length: 6 }, () => ({
          kind: 'open',
          opens: '09:00',
          closes: '20:00',
        })),
        { kind: 'closed' },
      ],
    },
    'services/svc-fade': {
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
    },
    'barberSchedules/ivan': roster('ivan'),
    'barberSchedules/petar': roster('petar'),
    [`appointments/${APPOINTMENT}`]: {
      locationId: 'loc-center',
      ownerUserId: null,
      subjectUserIds: [],
      barberIds: ['ivan', 'petar'],
      busyKeys: [`ivan__${DAY}`, `petar__${DAY}`],
      timeSlot: { startIso: iso(10), endIso: iso(10, 45), zone: ZONE },
      seats: [walkIn('seat-1', 'ivan'), walkIn('seat-2', 'petar')],
      status: { kind: 'confirmed' },
      bookedAt: { iso: '2030-01-01T09:00:00.000+02:00', zone: ZONE },
      bookedFromAppointmentId: null,
      arrivedAt: null,
      contact: null,
      revision: 1,
    },
  });
}

function harness() {
  const fake = seeded();
  const useCase = new StaffEditAppointmentUseCase(
    new FirestoreBookingStore(fake.db as unknown as Firestore),
    new FixedClock('2030-01-13T08:00:00.000+02:00'),
    BookingPolicy.default(),
  );
  const stored = () => fake.docs.get(`appointments/${APPOINTMENT}`) ?? {};
  const edit = (
    command: StaffEditCommand | readonly StaffEditCommand[],
    expectedVersion: number,
  ) =>
    useCase.execute({
      appointmentId: APPOINTMENT,
      actorUserId: 'dev-staff-ivan',
      actorRoles: ['barber'],
      command,
      expectedVersion,
    });
  /** A write that stamps no revision — how arrival, outcome, tip and client
   * cancel land (`tx.update`), leaving `revision` and `stoodSeatPairs` alone. */
  const updateInPlace = (fields: Record<string, unknown>) =>
    fake.docs.set(`appointments/${APPOINTMENT}`, { ...stored(), ...fields });
  return { stored, edit, updateInPlace };
}

/** The undo's re-add of seat-2, as the sheet sends it: its old id, its old place. */
const READD: StaffEditCommand = {
  kind: 'addSeat',
  seatId: 'seat-2',
  serviceId: 'svc-fade',
  barberId: 'petar',
  startIso: iso(10),
  minutes: 45,
  subject: { kind: 'guest', label: WALK_IN },
};

describe('staffEditAppointment — the undo of a save that broke a held pair, through the store', () => {
  it('puts back the seat the save removed, and the visit reads as it did', async () => {
    const { stored, edit } = harness();

    const save = await edit({ kind: 'removeSeat', seatId: 'seat-2' }, 1);
    expect(save.isSuccess() && save.value.revision).toBe(2);
    // The memory survived the store's own write.
    expect(stored()['stoodSeatPairs']).toEqual({
      revision: 2,
      pairs: [{ seatId: 'seat-1', otherSeatId: 'seat-2' }],
    });

    // «Отмени», made on the save's own stamp — as the sheet reads it,
    // through the mapper.
    const claim = appointmentFromDocument(APPOINTMENT, stored());
    expect(claim.isSuccess() && claim.value.revision).toBe(2);
    const undo = await edit(READD, 2);

    expect(undo.isSuccess() && undo.value.revision).toBe(3);
    const back = appointmentFromDocument(APPOINTMENT, stored());
    if (back.isFailure()) throw new Error('the undone visit does not read');
    expect(
      back.value.seats.map((seat) => [
        seat.id.value,
        seat.barberId.value,
        seat.startsAt.toISO(),
      ]),
    ).toEqual([
      ['seat-1', 'ivan', iso(10)],
      ['seat-2', 'petar', iso(10)],
    ]);
    // Spent: the undo broke nothing, and leaves nothing to stand by.
    expect(stored()).not.toHaveProperty('stoodSeatPairs');
  });

  it('keeps the undo open across a write that stamps no revision, such as an arrival', async () => {
    const { stored, edit, updateInPlace } = harness();

    await edit({ kind: 'removeSeat', seatId: 'seat-2' }, 1);
    // The barber marks the client arrived: an in-place update, no new stamp.
    updateInPlace({ arrivedAt: { iso: iso(10, 2), zone: ZONE } });
    expect(stored()['revision']).toBe(2);

    // The window is "until the next revision-stamping write" (a staff edit
    // or a client move), so the save's undo still puts the pair back.
    const undo = await edit(READD, 2);

    expect(undo.isSuccess() && undo.value.revision).toBe(3);
    expect((stored()['seats'] as readonly unknown[]).length).toBe(2);
  });

  it('judges the seat new once another staff edit stamped a revision after the save', async () => {
    const { stored, edit } = harness();

    await edit({ kind: 'removeSeat', seatId: 'seat-2' }, 1);
    const between = await edit(
      { kind: 'reprice', seatId: 'seat-1', priceMinorUnits: 3000 },
      2,
    );
    expect(between.isSuccess()).toBe(true);
    expect(stored()['revision']).toBe(3);

    const late = await edit(READD, 3);

    expect(late.isFailure() && late.error.params).toMatchObject({
      field: 'person_overlap',
    });
    // Nothing written: the visit holds the one seat the save left.
    expect(stored()['revision']).toBe(3);
    expect((stored()['seats'] as readonly unknown[]).length).toBe(1);
  });
});
