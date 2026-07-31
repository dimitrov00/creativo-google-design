import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type { Firestore } from 'firebase/firestore';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { Money, Result } from '@creativo/domain/kernel';
import {
  Appointment,
  AppointmentId,
  Seat,
  SeatId,
  SeatSubject,
  TimeSlot,
} from '@creativo/domain/scheduling';
import { UserId } from '@creativo/domain/accounts';
import {
  BarberId,
  ServiceId,
  ServiceTerms,
  ServiceVariantId,
} from '@creativo/domain/catalog';

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) {
    throw new Error(`fixture setup failed: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

type FakeDocRef = { __type: 'doc'; path: string };
type FakeCollectionRef = { __type: 'collection'; path: string };
type FakeQuery = {
  __type: 'query';
  collectionRef: FakeCollectionRef;
  constraints: unknown[];
};

const store = new Map<string, Record<string, unknown>>();
let lastOnSnapshotArgs: {
  query: FakeQuery;
  onNext: (snapshot: {
    docs: { id: string; data: () => Record<string, unknown> }[];
  }) => void;
  onError: (error: unknown) => void;
} | null = null;

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(
    (_db: unknown, ...segments: string[]): FakeCollectionRef => ({
      __type: 'collection',
      path: segments.join('/'),
    }),
  ),
  doc: vi.fn((_db: unknown, ...segments: string[]): FakeDocRef => ({
    __type: 'doc',
    path: segments.join('/'),
  })),
  getDoc: vi.fn(async (ref: FakeDocRef) => {
    const data = store.get(ref.path);
    return {
      exists: () => data !== undefined,
      data: () => data,
      id: ref.path.split('/').pop() as string,
    };
  }),
  setDoc: vi.fn(async (ref: FakeDocRef, data: Record<string, unknown>) => {
    store.set(ref.path, data);
  }),
  query: vi.fn(
    (
      collectionRef: FakeCollectionRef,
      ...constraints: unknown[]
    ): FakeQuery => ({
      __type: 'query',
      collectionRef,
      constraints,
    }),
  ),
  where: vi.fn((field: string, op: string, value: unknown) => ({
    field,
    op,
    value,
  })),
  orderBy: vi.fn((field: string) => ({ field })),
  onSnapshot: vi.fn(
    (
      q: FakeQuery,
      onNext: (snapshot: {
        docs: { id: string; data: () => Record<string, unknown> }[];
      }) => void,
      onError: (error: unknown) => void,
    ) => {
      lastOnSnapshotArgs = { query: q, onNext, onError };
      return () => {
        lastOnSnapshotArgs = null;
      };
    },
  ),
}));

// Imported AFTER the mock so the adapter picks up the mocked module.
const { FirestoreAppointmentRepository, appointmentToDocument } =
  await import('./appointment-repository.adapter');

function createRepo(db: Firestore = {} as Firestore) {
  TestBed.configureTestingModule({
    providers: [
      { provide: FIREBASE_FIRESTORE, useValue: db },
      FirestoreAppointmentRepository,
    ],
  });
  return TestBed.inject(FirestoreAppointmentRepository);
}

function buildAppointment(overrides?: { ownerUserId?: string }): Appointment {
  const ownerUserId = overrides?.ownerUserId ?? 'user-1';
  const timeSlot = TimeSlot.create({
    startIso: '2030-01-01T10:00:00',
    endIso: '2030-01-01T10:30:00',
    zone: 'Europe/Sofia',
  });
  if (timeSlot.isFailure()) throw new Error('bad fixture time slot');

  const price = unwrap(Money.fromMinorUnitsAndCode(1500, 'EUR'));
  const seat = Seat.of({
    id: unwrap(SeatId.create('seat-1')),
    subject: SeatSubject.account(unwrap(UserId.create(ownerUserId)), 'self'),
    serviceId: unwrap(ServiceId.create('service-1')),
    variantId: unwrap(ServiceVariantId.create('long')),
    barberId: unwrap(BarberId.create('barber-1')),
    terms: unwrap(ServiceTerms.create(price, 30)),
    startsAt: timeSlot.value.start,
  });

  const result = Appointment.reconstitute({
    id: 'appt-1',
    locationId: 'location-1',
    seats: [seat],
    status: { kind: 'confirmed' },
  });
  if (result.isFailure()) throw new Error('bad fixture appointment');
  return result.value;
}

describe('FirestoreAppointmentRepository', () => {
  beforeEach(() => {
    store.clear();
    lastOnSnapshotArgs = null;
  });

  it('REFUSES to save from the browser — appointments are committed server-side', async () => {
    // This used to be a bare setDoc. Together with a `create` rule that only
    // checked ownerUserId, it let any signed-in user write an appointment
    // naming any barber, any time and any price over anyone else's booking.
    const repo = createRepo();
    const result = await repo.save();

    expect(result.isFailure()).toBe(true);
    expect(store.get('appointments/appt-1')).toBeUndefined();
  });

  it('reads back a document written in the canonical persisted shape', async () => {
    // Seeded through the exported mapper rather than through `save`, so this
    // pins the CONTRACT the commitBooking function writes. A save→read
    // round-trip could not: both halves would share any shape bug.
    const repo = createRepo();
    const appointment = buildAppointment();
    store.set('appointments/appt-1', appointmentToDocument(appointment));

    const found = await repo.findById(appointment.id);
    expect(found.isSuccess()).toBe(true);
    if (found.isSuccess()) {
      expect(found.value?.id.equals(appointment.id)).toBe(true);
      expect(found.value?.status).toEqual({ kind: 'confirmed' });
      // The seats are the truth on read — the envelope is recomputed.
      expect(found.value?.seats).toHaveLength(1);
      expect(found.value?.barberIds().map((id) => id.value)).toEqual([
        'barber-1',
      ]);
    }
  });

  it('findById returns null when the document does not exist', async () => {
    const repo = createRepo();
    const appointment = buildAppointment();
    const found = await repo.findById(appointment.id);
    expect(found.isSuccess()).toBe(true);
    if (found.isSuccess()) {
      expect(found.value).toBeNull();
    }
  });

  it('derives the denormalized ownerUserId from the self seat', async () => {
    const stored = appointmentToDocument(
      buildAppointment({ ownerUserId: 'user-42' }),
    );
    expect(stored['ownerUserId']).toBe('user-42');
  });

  it('mirrors barberIds and the envelope for querying, without reading them back', async () => {
    const repo = createRepo();
    const doc = appointmentToDocument(buildAppointment());
    expect(doc['barberIds']).toEqual(['barber-1']);
    expect(doc['timeSlot']).toMatchObject({ zone: 'Europe/Sofia' });

    // A CORRUPT mirror must not change what the appointment says: the seats
    // are the truth and both fields are recomputed on read.
    store.set('appointments/appt-1', {
      ...doc,
      barberIds: ['someone-else'],
      timeSlot: {
        startIso: '1999-01-01T00:00:00+02:00',
        endIso: '1999-01-01T01:00:00+02:00',
        zone: 'Europe/Sofia',
      },
    });

    const found = await repo.findById(unwrap(AppointmentId.create('appt-1')));
    if (found.isFailure()) throw new Error('unexpected');
    expect(found.value?.barberIds().map((id) => id.value)).toEqual([
      'barber-1',
    ]);
    expect(found.value?.timeSlot.start.toISO()).toContain('2030-01-01');
  });

  it('observeUpcomingFor filters out terminal-status appointments from the live snapshot', async () => {
    const repo = createRepo();
    const emitted: unknown[] = [];
    const subscription = repo
      .observeUpcomingFor(unwrap(UserId.create('user-1')))
      .subscribe((r) => {
        emitted.push(r);
      });

    expect(lastOnSnapshotArgs).not.toBeNull();

    const seatSlot = {
      startIso: '2030-01-01T10:00:00',
      endIso: '2030-01-01T10:30:00',
      zone: 'Europe/Sofia',
    };
    const confirmedDoc = {
      locationId: 'location-1',
      ownerUserId: 'user-1',
      barberIds: ['barber-1'],
      timeSlot: seatSlot,
      seats: [
        {
          id: 'seat-1',
          serviceId: 'service-1',
          variantId: null,
          barberId: 'barber-1',
          terms: {
            priceMinorUnits: 1500,
            currencyCode: 'EUR',
            durationMinutes: 30,
          },
          slot: seatSlot,
          subject: { kind: 'account', userId: 'user-1', relationship: 'self' },
        },
      ],
      status: { kind: 'confirmed' },
    };
    const cancelledDoc = {
      ...confirmedDoc,
      status: { kind: 'cancelled', reason: 'no longer needed' },
    };

    lastOnSnapshotArgs?.onNext({
      docs: [
        { id: 'appt-confirmed', data: () => confirmedDoc },
        { id: 'appt-cancelled', data: () => cancelledDoc },
      ],
    });

    expect(emitted).toHaveLength(1);
    const result = emitted[0] as { isSuccess: () => boolean; value: unknown[] };
    expect(result.isSuccess()).toBe(true);
    expect(result.value).toHaveLength(1);

    subscription.unsubscribe();
  });
});
