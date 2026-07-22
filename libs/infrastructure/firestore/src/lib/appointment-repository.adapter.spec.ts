import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type { Firestore } from 'firebase/firestore';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { Result } from '@creativo/domain/kernel';
import {
  Appointment,
  Seat,
  SeatId,
  SeatSubject,
  TimeSlot,
} from '@creativo/domain/scheduling';
import { UserId } from '@creativo/domain/accounts';
import { ServiceId } from '@creativo/domain/catalog';

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
const { FirestoreAppointmentRepository } =
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

  const seat = Seat.of({
    id: unwrap(SeatId.create('seat-1')),
    subject: SeatSubject.account(unwrap(UserId.create(ownerUserId)), 'self'),
    serviceId: unwrap(ServiceId.create('service-1')),
  });

  const result = Appointment.reconstitute({
    id: 'appt-1',
    barberId: 'barber-1',
    locationId: 'location-1',
    timeSlot: timeSlot.value,
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

  it('round-trips save → findById', async () => {
    const repo = createRepo();
    const appointment = buildAppointment();

    const saveResult = await repo.save(appointment);
    expect(saveResult.isSuccess()).toBe(true);

    const found = await repo.findById(appointment.id);
    expect(found.isSuccess()).toBe(true);
    if (found.isSuccess()) {
      expect(found.value?.id.equals(appointment.id)).toBe(true);
      expect(found.value?.status).toEqual({ kind: 'confirmed' });
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

  it('persists a denormalized ownerUserId derived from the self seat', async () => {
    const repo = createRepo();
    const appointment = buildAppointment({ ownerUserId: 'user-42' });
    await repo.save(appointment);
    const stored = store.get('appointments/appt-1');
    expect(stored?.['ownerUserId']).toBe('user-42');
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

    const confirmedDoc = {
      barberId: 'barber-1',
      locationId: 'location-1',
      ownerUserId: 'user-1',
      timeSlot: {
        startIso: '2030-01-01T10:00:00',
        endIso: '2030-01-01T10:30:00',
        zone: 'Europe/Sofia',
      },
      seats: [
        {
          id: 'seat-1',
          serviceId: 'service-1',
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
