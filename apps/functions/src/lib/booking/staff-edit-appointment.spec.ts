import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { fail, ok } from '@creativo/domain/kernel';
import { BookingPolicy } from '@creativo/domain/scheduling';
import { createProjectionFirestore } from '../../test-support/fake-projection-firestore';
import { StaffEditStaleError } from '../../use-cases/staff-edit-appointment.errors';
import {
  staffEditAppointment,
  toExpectedVersion,
  toStaffHttpsError,
} from './staff-edit-appointment';

/*
 * THE STALE-SCREEN GUARD, AT THE WIRE (round 5). The staff sheet now sends
 * the revision its draft was drawn from on every save; the callable must
 * hand it to the use case as sent — a malformed one refused by name there,
 * never dropped here as "no claim" — and answer a stale refusal as the
 * typed `failed-precondition` the sheet reloads on.
 */

const fake = vi.hoisted(() => ({
  db: null as unknown,
  staffEdit: vi.fn(),
}));

vi.mock('firebase-functions', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock('../firebase-admin', () => ({ adminFirestore: () => fake.db }));
vi.mock('./load-booking-policy', () => ({
  loadBookingPolicy: async () => BookingPolicy.default(),
}));
vi.mock('./audit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./audit')>();
  return { ...actual, appendAudit: vi.fn(async () => undefined) };
});
vi.mock('../../use-cases/staff-edit-appointment.use-case', () => ({
  StaffEditAppointmentUseCase: class {
    execute = fake.staffEdit;
  },
}));

const APPT = 'appt-1';
const staff = { uid: 'dev-staff-ivan', token: { roles: ['barber'] } };

function call(data: Record<string, unknown>): Promise<unknown> {
  return staffEditAppointment.run({
    data: {
      appointmentId: APPT,
      command: { kind: 'move', startIso: '2030-01-15T11:00:00+02:00' },
      ...data,
    },
    auth: staff,
  } as unknown as CallableRequest);
}

/** What the callable handed the use case as `expectedVersion`. */
function sentVersion(): unknown {
  const input = fake.staffEdit.mock.lastCall?.[0] as
    { expectedVersion?: unknown } | undefined;
  return input?.expectedVersion;
}

beforeEach(() => {
  fake.staffEdit.mockReset();
  fake.staffEdit.mockResolvedValue(ok({ appointmentId: APPT, revision: 4 }));
  fake.db = createProjectionFirestore().db;
});

describe('staffEditAppointment — the revision the intent was made on', () => {
  it('hands the use case the claim as sent', async () => {
    await call({ expectedVersion: 3 });
    expect(sentVersion()).toBe(3);
  });

  it('reads an absent claim as no claim', async () => {
    await call({});
    expect(sentVersion()).toBeNull();
    await call({ expectedVersion: null });
    expect(sentVersion()).toBeNull();
  });

  // It used to read every non-number as "no claim", which switched the
  // guard off for exactly the caller that got its claim wrong.
  it.each([['3'], [true], [{}]])(
    'passes a malformed claim (%j) on as NaN, for the use case to refuse by name',
    async (raw) => {
      await call({ expectedVersion: raw });
      expect(sentVersion()).toBeNaN();
    },
  );

  it('answers a stale refusal as the typed failed-precondition the sheet reloads on', async () => {
    fake.staffEdit.mockResolvedValue(fail(new StaffEditStaleError(3, 4)));
    const refusal = await call({ expectedVersion: 3 }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(refusal).toBeInstanceOf(HttpsError);
    expect((refusal as HttpsError).code).toBe('failed-precondition');
    expect((refusal as HttpsError).details).toEqual({
      code: 'booking.staffEdit.stale',
      params: { expected: '3', actual: '4' },
    });
  });
});

describe('toExpectedVersion / toStaffHttpsError — the pure halves', () => {
  it('keeps numbers, absence and nothing else', () => {
    expect(toExpectedVersion(undefined)).toBeNull();
    expect(toExpectedVersion(null)).toBeNull();
    expect(toExpectedVersion(0)).toBe(0);
    expect(toExpectedVersion(7)).toBe(7);
    expect(toExpectedVersion('7')).toBeNaN();
  });

  it('maps the stale refusal to failed-precondition, never a retryable abort', () => {
    expect(toStaffHttpsError(new StaffEditStaleError(1, 2)).code).toBe(
      'failed-precondition',
    );
  });
});
