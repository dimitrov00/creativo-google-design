import { Result, fail, ok } from '@creativo/domain/kernel';
import { AppointmentId } from '@creativo/domain/scheduling';
import {
  BookingGateway,
  BookingGatewayError,
} from '../ports/booking-gateway.port';

export interface CancelAppointmentInput {
  readonly appointmentId: AppointmentId;
  readonly reason: string;
}

/**
 * Cancel through the GATEWAY, not the repository.
 *
 * The earlier shape — `findById`, `appointment.cancel(reason)`, `save()` —
 * read as clean hexagonal domain work and could never run: the browser
 * repository refuses `save()` by design (appointments are written only
 * server-side), so every user cancel errored at the last step. And even had
 * the write landed, a client-side status flip leaves the public `barberBusy`
 * projection untouched — the slot stays blocked for everyone, forever.
 *
 * The `cancelAppointment` callable owns the transition (ownership and the
 * domain lifecycle graph are checked server-side against fresh state), and
 * the `rebuildBusy` trigger recomputes the projection the moment the status
 * lands — which is also what lets the waitlist matcher notice the freed day.
 */
export class CancelAppointmentUseCase {
  constructor(private readonly gateway: BookingGateway) {}

  async execute(
    input: CancelAppointmentInput,
  ): Promise<Result<void, BookingGatewayError>> {
    const result = await this.gateway.cancel({
      appointmentId: input.appointmentId.value,
      reason: input.reason,
    });
    if (result.isFailure()) return fail(result.error);
    return ok(undefined);
  }
}
