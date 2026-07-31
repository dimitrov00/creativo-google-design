import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type {
  RulesTestEnvironment,
  RulesTestContext,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import {
  Appointment,
  AppointmentId,
  Seat,
  SeatId,
  SeatSubject,
  TimeSlot,
} from '@creativo/domain/scheduling';
import { UserId } from '@creativo/domain/accounts';
import { BarberId, ServiceId, ServiceTerms } from '@creativo/domain/catalog';
import { Money, Result } from '@creativo/domain/kernel';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import {
  createEmulatorTestEnv,
  modularFirestore,
} from '../testing/emulator-test-env';
import {
  FirestoreAppointmentRepository,
  appointmentToDocument,
} from './appointment-repository.adapter';

function unwrap<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) {
    throw new Error(`fixture setup failed: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function repoFor(context: RulesTestContext): FirestoreAppointmentRepository {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: FIREBASE_FIRESTORE, useValue: modularFirestore(context) },
      FirestoreAppointmentRepository,
    ],
  });
  return TestBed.inject(FirestoreAppointmentRepository);
}

function buildAppointment(
  id: string,
  ownerUserId: string,
  status: 'pending' | 'confirmed' = 'confirmed',
): Appointment {
  const timeSlot = unwrap(
    TimeSlot.create({
      startIso: '2030-01-01T10:00:00',
      endIso: '2030-01-01T10:30:00',
      zone: 'Europe/Sofia',
    }),
  );
  const price = unwrap(Money.fromMinorUnitsAndCode(1500, 'EUR'));
  const seat = Seat.of({
    id: unwrap(SeatId.create('seat-1')),
    subject: SeatSubject.account(unwrap(UserId.create(ownerUserId)), 'self'),
    serviceId: unwrap(ServiceId.create('service-1')),
    variantId: null,
    barberId: unwrap(BarberId.create('barber-1')),
    terms: unwrap(ServiceTerms.create(price, 30)),
    startsAt: timeSlot.start,
  });
  return unwrap(
    Appointment.reconstitute({
      id,
      locationId: 'location-1',
      seats: [seat],
      status: { kind: status },
    }),
  );
}

describe('FirestoreAppointmentRepository (emulator)', () => {
  let testEnv: RulesTestEnvironment;

  /**
   * Seeds appointments the way the server does. The browser adapter refuses to
   * write (appointments are committed by the `commitBooking` callable), so
   * tests write the canonical document shape directly with rules disabled.
   */
  async function seed(...appointments: readonly Appointment[]): Promise<void> {
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

  beforeAll(async () => {
    testEnv = await createEmulatorTestEnv('demo-firestore-appointment-repo');
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  it('a client reads back their own server-written appointment', async () => {
    const appointment = buildAppointment('appt-own', 'user-1');
    await seed(appointment);

    const repo = repoFor(
      testEnv.authenticatedContext('user-1', { roles: ['client'] }),
    );
    const found = await repo.findById(appointment.id);
    expect(found.isSuccess()).toBe(true);
    if (found.isSuccess()) {
      expect(found.value?.id.equals(appointment.id)).toBe(true);
    }
  });

  it('RULES: a client cannot create an appointment at all — not even their own', async () => {
    // The hole this closes: `create` used to allow any signed-in user whose
    // `ownerUserId` matched, with no check on barber, time, price or overlap.
    const db = modularFirestore(
      testEnv.authenticatedContext('user-1', { roles: ['client'] }),
    );
    await expect(
      setDoc(
        doc(db, 'appointments', 'appt-forged'),
        appointmentToDocument(buildAppointment('appt-forged', 'user-1')),
      ),
    ).rejects.toThrow();
  });

  it('RULES: a client cannot forge an appointment owned by someone else', async () => {
    const db = modularFirestore(
      testEnv.authenticatedContext('user-1', { roles: ['client'] }),
    );
    await expect(
      setDoc(
        doc(db, 'appointments', 'appt-other'),
        appointmentToDocument(buildAppointment('appt-other', 'user-2')),
      ),
    ).rejects.toThrow();
  });

  it('RULES: staff may still create at the counter', async () => {
    const db = modularFirestore(
      testEnv.authenticatedContext('staff-1', { roles: ['barber'] }),
    );
    await expect(
      setDoc(
        doc(db, 'appointments', 'appt-counter'),
        appointmentToDocument(buildAppointment('appt-counter', 'user-1')),
      ),
    ).resolves.toBeUndefined();
  });

  it('observeUpcomingFor emits only the requesting user’s own appointments', async () => {
    await seed(
      buildAppointment('appt-mine', 'user-1'),
      buildAppointment('appt-someone-elses', 'user-2'),
    );

    const repo = repoFor(
      testEnv.authenticatedContext('user-1', { roles: ['client'] }),
    );

    const emitted = await new Promise<readonly Appointment[]>(
      (resolve, reject) => {
        const subscription = repo
          .observeUpcomingFor(unwrap(UserId.create('user-1')))
          .subscribe((result) => {
            if (result.isFailure()) {
              reject(result.error);
              return;
            }
            subscription.unsubscribe();
            resolve(result.value);
          });
      },
    );

    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.id.value).toBe('appt-mine');
  });

  it('lets staff read and confirm any appointment’s lifecycle', async () => {
    await seed(buildAppointment('appt-for-staff', 'user-1', 'pending'));

    const staffRepo = repoFor(
      testEnv.authenticatedContext('barber-1', { roles: ['barber'] }),
    );

    const found = await staffRepo.findById(
      unwrap(AppointmentId.create('appt-for-staff')),
    );
    expect(found.isSuccess()).toBe(true);
    if (!found.isSuccess() || found.value === null) {
      throw new Error('expected appointment to exist');
    }

    // The transition itself is domain logic and stays testable here; the
    // WRITE is a targeted status update, which is what the staff rule grants
    // (a whole-document save is refused for everyone now).
    const confirmed = unwrap(found.value.confirm());
    expect(confirmed.status.kind).toBe('confirmed');

    const staffDb = modularFirestore(
      testEnv.authenticatedContext('barber-1', { roles: ['barber'] }),
    );
    await expect(
      updateDoc(doc(staffDb, 'appointments', 'appt-for-staff'), {
        status: confirmed.status,
      }),
    ).resolves.toBeUndefined();
  });
});
