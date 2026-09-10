import { describe, expect, it, vi } from 'vitest';
import { ok, fail } from '@creativo/domain/kernel';
import { AppointmentId } from '@creativo/domain/scheduling';
import {
  BookingGateway,
  BookingGatewayError,
} from '../ports/booking-gateway.port';
import { CancelAppointmentUseCase } from './cancel-appointment.use-case';

function appointmentId(): AppointmentId {
  const result = AppointmentId.create('appt_1');
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

/**
 * The use case is a thin adapter over the gateway ON PURPOSE — the previous
 * shape (findById → domain cancel → save) could never run, because the
 * browser repository refuses save() by design. What is left to assert is the
 * seam itself: the request reaches the callable with the right shape, and
 * failures come back untranslated.
 */
describe('CancelAppointmentUseCase', () => {
  it('hands the id and reason to the gateway', async () => {
    const cancel = vi.fn().mockResolvedValue(ok(undefined));
    const gateway: BookingGateway = {
      commit: vi.fn(),
      cancel,
      reschedule: vi.fn(),
      transition: vi.fn(),
      markArrived: vi.fn(),
      clearArrival: vi.fn(),
      staffEdit: vi.fn(),
    };

    const result = await new CancelAppointmentUseCase(gateway).execute({
      appointmentId: appointmentId(),
      reason: 'running late',
    });

    expect(result.isSuccess()).toBe(true);
    expect(cancel).toHaveBeenCalledWith({
      appointmentId: 'appt_1',
      reason: 'running late',
    });
  });

  it('passes the gateway failure through unchanged', async () => {
    const error = new BookingGatewayError('invalid_request', 'not cancellable');
    const gateway: BookingGateway = {
      commit: vi.fn(),
      cancel: vi.fn().mockResolvedValue(fail(error)),
      reschedule: vi.fn(),
      transition: vi.fn(),
      markArrived: vi.fn(),
      clearArrival: vi.fn(),
      staffEdit: vi.fn(),
    };

    const result = await new CancelAppointmentUseCase(gateway).execute({
      appointmentId: appointmentId(),
      reason: '',
    });

    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) expect(result.error).toBe(error);
  });
});
