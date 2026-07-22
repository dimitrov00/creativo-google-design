import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type {
  RulesTestEnvironment,
  RulesTestContext,
} from '@firebase/rules-unit-testing';
import {
  Appointment,
  AppointmentId,
  Seat,
  SeatId,
  SeatSubject,
  TimeSlot,
} from '@creativo/domain/scheduling';
import { UserId } from '@creativo/domain/accounts';
import { ServiceId } from '@creativo/domain/catalog';
import { Result } from '@creativo/domain/kernel';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import {
  createEmulatorTestEnv,
  modularFirestore,
} from '../testing/emulator-test-env';
import { FirestoreAppointmentRepository } from './appointment-repository.adapter';

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
  const seat = Seat.of({
    id: unwrap(SeatId.create('seat-1')),
    subject: SeatSubject.account(unwrap(UserId.create(ownerUserId)), 'self'),
    serviceId: unwrap(ServiceId.create('service-1')),
  });
  return unwrap(
    Appointment.reconstitute({
      id,
      barberId: 'barber-1',
      locationId: 'location-1',
      timeSlot,
      seats: [seat],
      status: { kind: status },
    }),
  );
}

describe('FirestoreAppointmentRepository (emulator)', () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await createEmulatorTestEnv('demo-firestore-appointment-repo');
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  it('round-trips save → findById for a client booking their own appointment', async () => {
    const repo = repoFor(
      testEnv.authenticatedContext('user-1', { roles: ['client'] }),
    );
    const appointment = buildAppointment('appt-own', 'user-1');

    const saveResult = await repo.save(appointment);
    expect(saveResult.isSuccess()).toBe(true);

    const found = await repo.findById(appointment.id);
    expect(found.isSuccess()).toBe(true);
    if (found.isSuccess()) {
      expect(found.value?.id.equals(appointment.id)).toBe(true);
    }
  });

  it('rejects a client creating an appointment owned by someone else', async () => {
    const repo = repoFor(
      testEnv.authenticatedContext('user-1', { roles: ['client'] }),
    );
    const appointment = buildAppointment('appt-other', 'user-2');

    const saveResult = await repo.save(appointment);
    expect(saveResult.isFailure()).toBe(true);
  });

  it('observeUpcomingFor emits only the requesting user’s own appointments', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const seedRepo = repoFor(ctx);
      await seedRepo.save(buildAppointment('appt-mine', 'user-1'));
      await seedRepo.save(buildAppointment('appt-someone-elses', 'user-2'));
    });

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
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const seedRepo = repoFor(ctx);
      await seedRepo.save(
        buildAppointment('appt-for-staff', 'user-1', 'pending'),
      );
    });

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

    const confirmed = unwrap(found.value.confirm());
    const saveResult = await staffRepo.save(confirmed);
    expect(saveResult.isSuccess()).toBe(true);
  });
});
