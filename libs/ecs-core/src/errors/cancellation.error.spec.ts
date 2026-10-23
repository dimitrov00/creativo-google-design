import { describe, expect, it } from 'vitest';
import { utcMs } from '@core/testing';
import {
  type CancelCallRefusal,
  CancellationRefusal,
  CancellationRefusalCode,
} from './cancellation.error';
import { AppointmentId } from '@core/primitives';

/*
 * The cancellation dictionary, moved from `cancellation-policy.system.ts`
 * (Law 7.5, Phase 4a 4A-6): values unchanged, the visit's state a scalar
 * now (the errors tier imports only primitives, never a component), the cancel callable's own refusals
 * beside the policy's (the legacy `booking.cancel.*` successors).
 */
describe('CancellationRefusal', () => {
  it('keeps the policy codes unchanged and adds the call’s own, SCREAMING under BOOKING_CANCEL_', () => {
    expect(CancellationRefusalCode).toEqual({
      PolicyUnavailable: 'BOOKING_CANCEL_POLICY_UNAVAILABLE',
      NotCancellable: 'BOOKING_CANCEL_NOT_CANCELLABLE',
      WindowClosed: 'BOOKING_CANCEL_WINDOW_CLOSED',
      Unauthenticated: 'BOOKING_CANCEL_UNAUTHENTICATED',
      InvalidInput: 'BOOKING_CANCEL_INVALID_INPUT',
      NotFound: 'BOOKING_CANCEL_NOT_FOUND',
    });
  });

  it('has one factory per code, each a flat struct of scalars', () => {
    const deadline = utcMs('2026-10-06T09:00:00.000+03:00');
    const refusals: readonly CancelCallRefusal[] = [
      CancellationRefusal.policyUnavailable(),
      CancellationRefusal.notCancellable('COMPLETED'),
      CancellationRefusal.windowClosed(24, deadline),
      CancellationRefusal.unauthenticated(),
      CancellationRefusal.invalidInput('appointmentId'),
      CancellationRefusal.notFound(AppointmentId.of('apt-1')),
    ];
    expect(refusals.map((refusal) => refusal.errorCode).sort()).toEqual(
      Object.values(CancellationRefusalCode).sort(),
    );
    expect(CancellationRefusal.notCancellable('NO_SHOW')).toEqual({
      errorCode: 'BOOKING_CANCEL_NOT_CANCELLABLE',
      bookingStatus: 'NO_SHOW',
    });
    expect(CancellationRefusal.windowClosed(24, deadline)).toEqual({
      errorCode: 'BOOKING_CANCEL_WINDOW_CLOSED',
      windowHours: 24,
      deadlineUtcMs: deadline,
    });
    expect(CancellationRefusal.notFound(AppointmentId.of('apt-1'))).toEqual({
      errorCode: 'BOOKING_CANCEL_NOT_FOUND',
      appointmentId: 'apt-1',
    });
  });

  it('is() narrows by errorCode', () => {
    const refusal: CancelCallRefusal = CancellationRefusal.windowClosed(
      2,
      utcMs('2026-10-06T09:00:00.000+03:00'),
    );
    expect(
      CancellationRefusal.is(refusal, CancellationRefusalCode.WindowClosed),
    ).toBe(true);
    expect(
      CancellationRefusal.is(refusal, CancellationRefusalCode.NotFound),
    ).toBe(false);
  });
});
