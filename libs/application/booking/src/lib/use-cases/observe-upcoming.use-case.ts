import { Observable } from 'rxjs';
import { Result } from '@creativo/domain/kernel';
import { Appointment } from '@creativo/domain/scheduling';
import { UserId } from '@creativo/domain/accounts';
import { RepositoryError } from '@creativo/application/shared';
import { AppointmentRepository } from '../ports/appointment-repository.port';

/** Thin wrapper over the live `AppointmentRepository` read — kept as its own use-case (rather than a direct port call from a feature store) so a future revision can layer sorting/grouping without touching the port contract. */
export class ObserveUpcomingUseCase {
  constructor(private readonly appointments: AppointmentRepository) {}

  execute(
    userId: UserId,
  ): Observable<Result<readonly Appointment[], RepositoryError>> {
    return this.appointments.observeUpcomingFor(userId);
  }
}
