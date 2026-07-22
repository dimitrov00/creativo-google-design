import { Result, fail, ok } from '@creativo/domain/kernel';
import { Appointment, AppointmentId } from '@creativo/domain/scheduling';
import { AppointmentRepository } from '../ports/appointment-repository.port';
import {
  AppointmentNotFoundError,
  CancelAppointmentError,
  CancelAppointmentRepositoryFailure,
} from './cancel-appointment.errors';

export interface CancelAppointmentInput {
  readonly appointmentId: AppointmentId;
  readonly reason: string;
}

export class CancelAppointmentUseCase {
  constructor(private readonly appointments: AppointmentRepository) {}

  async execute(
    input: CancelAppointmentInput,
  ): Promise<Result<Appointment, CancelAppointmentError>> {
    const foundResult = await this.appointments.findById(input.appointmentId);
    if (foundResult.isFailure()) {
      return fail(new CancelAppointmentRepositoryFailure(foundResult.error));
    }
    const appointment = foundResult.value;
    if (!appointment) {
      return fail(new AppointmentNotFoundError());
    }

    const cancelResult = appointment.cancel(input.reason);
    if (cancelResult.isFailure()) {
      return fail(cancelResult.error);
    }
    const cancelled = cancelResult.value;

    const saveResult = await this.appointments.save(cancelled);
    if (saveResult.isFailure()) {
      return fail(new CancelAppointmentRepositoryFailure(saveResult.error));
    }

    return ok(cancelled);
  }
}
