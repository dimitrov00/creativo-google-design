import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';
import { Result } from '@creativo/domain/kernel';
import { Appointment, AppointmentId } from '@creativo/domain/scheduling';
import { UserId } from '@creativo/domain/accounts';
import { RepositoryError } from '@creativo/application/shared';

export interface AppointmentRepository {
  findById(
    id: AppointmentId,
  ): Promise<Result<Appointment | null, RepositoryError>>;
  save(appointment: Appointment): Promise<Result<void, RepositoryError>>;
  /** Live upcoming appointments for a user across every seat they appear in (as `self`, `companion`, or booking `client`s see their own bookings only via `self`). */
  observeUpcomingFor(
    userId: UserId,
  ): Observable<Result<readonly Appointment[], RepositoryError>>;
}

export const APPOINTMENT_REPOSITORY = new InjectionToken<AppointmentRepository>(
  'AppointmentRepository',
);
