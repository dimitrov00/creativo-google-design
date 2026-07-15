import { ZonedDateTime } from '@creativo/domain/kernel';
import { describe, expect, it } from 'vitest';
import { Appointment } from './appointment';

function at(iso: string): ZonedDateTime {
  const result = ZonedDateTime.fromISO(iso, 'UTC');
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

function validScheduleProps() {
  return {
    id: 'appt_1',
    tenantId: 'creativo',
    clientUid: 'client_1',
    staffId: 'staff_1',
    serviceId: 'service_1',
    startIso: '2026-08-01T09:00:00.000Z',
    endIso: '2026-08-01T09:30:00.000Z',
    zone: 'UTC',
  };
}

const now = at('2026-01-01T00:00:00.000Z');

describe('Appointment.schedule', () => {
  it('creates a pending_deposit appointment for valid future props', () => {
    const result = Appointment.schedule(validScheduleProps(), now);
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.status).toEqual({ kind: 'pending_deposit' });
      expect(result.value.depositPaymentIntentId).toBeNull();
    }
  });

  it('rejects a start that is not in the future', () => {
    const past = at('2027-01-01T00:00:00.000Z'); // "now" that is after the appointment start
    const result = Appointment.schedule(validScheduleProps(), past);
    expect(result.isFailure()).toBe(true);
  });

  it('rejects end <= start', () => {
    const result = Appointment.schedule(
      { ...validScheduleProps(), endIso: '2026-08-01T09:00:00.000Z' },
      now,
    );
    expect(result.isFailure()).toBe(true);
  });

  it('collects an empty id error alongside other field errors', () => {
    const result = Appointment.schedule(
      { ...validScheduleProps(), id: '', staffId: '' },
      now,
    );
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('Appointment.reconstitute', () => {
  it('allows a past appointment (skips the future-dated creation invariant)', () => {
    const result = Appointment.reconstitute({
      ...validScheduleProps(),
      startIso: '2020-01-01T09:00:00.000Z',
      endIso: '2020-01-01T09:30:00.000Z',
      status: { kind: 'completed' },
      depositPaymentIntentId: 'pi_123',
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.status).toEqual({ kind: 'completed' });
      expect(result.value.depositPaymentIntentId).toBe('pi_123');
    }
  });

  it('still rejects end <= start on reconstitution', () => {
    const result = Appointment.reconstitute({
      ...validScheduleProps(),
      startIso: '2020-01-01T09:00:00.000Z',
      endIso: '2020-01-01T09:00:00.000Z',
      status: { kind: 'pending_deposit' },
      depositPaymentIntentId: null,
    });
    expect(result.isFailure()).toBe(true);
  });
});

describe('Appointment status transitions', () => {
  function scheduled(): Appointment {
    const result = Appointment.schedule(validScheduleProps(), now);
    if (result.isFailure())
      throw new Error('unexpected failure in test fixture');
    return result.value;
  }

  it('confirm() succeeds from pending_deposit and returns a new instance', () => {
    const original = scheduled();
    const result = original.confirm();
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.status).toEqual({ kind: 'confirmed' });
      expect(result.value).not.toBe(original);
      expect(original.status).toEqual({ kind: 'pending_deposit' }); // original is untouched
    }
  });

  it('confirm() fails from any other status', () => {
    const confirmed = scheduled().confirm();
    if (confirmed.isFailure())
      throw new Error('unexpected failure in test fixture');
    expect(confirmed.value.confirm().isFailure()).toBe(true);
  });

  it('cancel() succeeds from pending_deposit or confirmed, carries the reason', () => {
    const result = scheduled().cancel('client requested');
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.status).toEqual({
        kind: 'cancelled',
        reason: 'client requested',
      });
    }
  });

  it('cancel() fails once completed', () => {
    const confirmed = scheduled().confirm();
    if (confirmed.isFailure())
      throw new Error('unexpected failure in test fixture');
    const completed = confirmed.value.complete();
    if (completed.isFailure())
      throw new Error('unexpected failure in test fixture');
    expect(completed.value.cancel('too late').isFailure()).toBe(true);
  });

  it('complete() only succeeds from confirmed', () => {
    expect(scheduled().complete().isFailure()).toBe(true); // still pending_deposit
    const confirmed = scheduled().confirm();
    if (confirmed.isFailure())
      throw new Error('unexpected failure in test fixture');
    expect(confirmed.value.complete().isSuccess()).toBe(true);
  });

  it('markNoShow() only succeeds from confirmed', () => {
    expect(scheduled().markNoShow().isFailure()).toBe(true);
    const confirmed = scheduled().confirm();
    if (confirmed.isFailure())
      throw new Error('unexpected failure in test fixture');
    const result = confirmed.value.markNoShow();
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.status).toEqual({ kind: 'no_show' });
    }
  });
});
