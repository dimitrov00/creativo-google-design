import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type {
  RulesTestContext,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import {
  Appointment,
  COMPLETED,
  Seat,
  SeatId,
  SeatSubject,
} from '@creativo/domain/scheduling';
import { UserId } from '@creativo/domain/accounts';
import { BarberId, ServiceId, ServiceTerms } from '@creativo/domain/catalog';
import { Money, Result, ZonedDateTime } from '@creativo/domain/kernel';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import {
  createEmulatorTestEnv,
  modularFirestore,
} from '../testing/emulator-test-env';
import { appointmentToDocument } from './appointment-repository.adapter';
import { FirestoreClientHistoryReader } from './client-history-reader.adapter';

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) {
    throw new Error(`fixture setup failed: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function readerFor(context: RulesTestContext): FirestoreClientHistoryReader {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: FIREBASE_FIRESTORE, useValue: modularFirestore(context) },
      FirestoreClientHistoryReader,
    ],
  });
  return TestBed.inject(FirestoreClientHistoryReader);
}

function seat(
  userId: string,
  relationship: 'self' | 'companion',
  barber: string,
  startIso: string,
): Seat {
  return Seat.of({
    id: SeatId.generate(),
    subject: SeatSubject.account(unwrap(UserId.create(userId)), relationship),
    serviceId: unwrap(ServiceId.create('svc-fade')),
    variantId: null,
    barberId: unwrap(BarberId.create(barber)),
    terms: unwrap(
      ServiceTerms.create(unwrap(Money.fromMinorUnitsAndCode(2500, 'EUR')), 30),
    ),
    startsAt: unwrap(ZonedDateTime.fromISO(startIso, 'Europe/Sofia')),
  });
}

/** A visit at `startIso` (Sofia), booked by `booker`, with `companion` in the next chair. */
function visit(
  id: string,
  startIso: string,
  booker: string,
  companion?: string,
): Appointment {
  const seats = [seat(booker, 'self', 'ivan', startIso)];
  if (companion !== undefined) {
    seats.push(seat(companion, 'companion', 'niko', startIso));
  }
  return unwrap(
    Appointment.reconstitute({
      id,
      locationId: 'loc-center',
      seats,
      status: COMPLETED,
    }),
  );
}

const ids = (page: { appointments: readonly Appointment[] }) =>
  page.appointments.map((a) => a.id.value);

describe('FirestoreClientHistoryReader (emulator)', () => {
  let testEnv: RulesTestEnvironment;

  async function seed(...appointments: readonly Appointment[]) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = modularFirestore(ctx);
      for (const appointment of appointments) {
        await setDoc(
          doc(db, 'appointments', appointment.id.value),
          appointmentToDocument(appointment),
        );
      }
    });
  }

  const barber = () =>
    readerFor(
      testEnv.authenticatedContext('staff-ivan', { roles: ['barber'] }),
    );

  beforeAll(async () => {
    testEnv = await createEmulatorTestEnv('demo-firestore-client-history');
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await seed(
      visit('a-01', '2026-06-02T10:00:00', 'georgi'),
      visit('a-02', '2026-07-01T10:00:00', 'martin', 'georgi'),
      visit('a-03', '2026-08-05T10:00:00', 'georgi'),
      visit('a-04', '2026-09-02T10:00:00', 'martin'),
      visit('a-05', '2026-09-28T10:00:00', 'georgi'),
    );
  });

  it('reads every visit with a seat for the person — as company too — newest first', async () => {
    const page = await barber().pageForSubject('georgi', {
      beforeIso: null,
      limit: 10,
    });
    if (page.isFailure()) throw page.error;
    expect(ids(page.value)).toEqual(['a-05', 'a-03', 'a-02', 'a-01']);
    expect(page.value.nextBeforeIso).toBeNull();
  });

  it('pages on the stored start until nothing older is left', async () => {
    const reader = barber();
    const first = await reader.pageForSubject('georgi', {
      beforeIso: null,
      limit: 3,
    });
    if (first.isFailure()) throw first.error;
    expect(ids(first.value)).toEqual(['a-05', 'a-03', 'a-02']);
    expect(first.value.nextBeforeIso).toBe(
      visit('x', '2026-07-01T10:00:00', 'georgi').timeSlot.start.toISO(),
    );
    const next = await reader.pageForSubject('georgi', {
      beforeIso: first.value.nextBeforeIso,
      limit: 3,
    });
    if (next.isFailure()) throw next.error;
    expect(ids(next.value)).toEqual(['a-01']);
    expect(next.value.nextBeforeIso).toBeNull();
  });

  it('keeps visits starting at the same instant on one page, and says when nothing is older', async () => {
    await seed(visit('a-05b', '2026-09-28T10:00:00', 'georgi'));
    const reader = barber();
    const page = await reader.pageForSubject('georgi', {
      beforeIso: null,
      limit: 1,
    });
    if (page.isFailure()) throw page.error;
    expect([...ids(page.value)].sort()).toEqual(['a-05', 'a-05b']);
    const rest = await reader.pageForSubject('georgi', {
      beforeIso: page.value.nextBeforeIso,
      limit: 5,
    });
    expect(rest.isSuccess() && ids(rest.value)).toEqual([
      'a-03',
      'a-02',
      'a-01',
    ]);

    await testEnv.clearFirestore();
    await seed(
      visit('b-01', '2026-09-28T10:00:00', 'georgi'),
      visit('b-02', '2026-09-28T10:00:00', 'georgi'),
    );
    const only = await reader.pageForSubject('georgi', {
      beforeIso: null,
      limit: 1,
    });
    expect(only.isSuccess() && only.value.nextBeforeIso).toBeNull();
    expect(only.isSuccess() && only.value.appointments).toHaveLength(2);
  });

  it('drops a document that does not parse, never the page', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(modularFirestore(ctx), 'appointments', 'a-broken'), {
        subjectUserIds: ['georgi'],
        timeSlot: { startIso: '2026-09-10T10:00:00.000+03:00' },
        seats: 'nope',
      });
    });
    const page = await barber().pageForSubject('georgi', {
      beforeIso: null,
      limit: 10,
    });
    expect(page.isSuccess() && ids(page.value)).toEqual([
      'a-05',
      'a-03',
      'a-02',
      'a-01',
    ]);
  });

  it('is the book’s: a content manager is refused', async () => {
    const copy = readerFor(
      testEnv.authenticatedContext('copy-1', { roles: ['content_manager'] }),
    );
    const page = await copy.pageForSubject('georgi', {
      beforeIso: null,
      limit: 5,
    });
    expect(page.isFailure()).toBe(true);
  });
});
