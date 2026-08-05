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

  /**
   * Live PAST visits, newest first — everything the upcoming query filters
   * out: a start that has already been and gone, and anything terminal
   * (cancelled, completed, no-show) whatever its start.
   *
   * BOUNDED by `limit`, and deliberately so: "my history" grows without end
   * and a screen that reads all of it pays for every visit a loyal client
   * ever made, on every mount. The newest N is what a person scrolls.
   */
  observeHistoryFor(
    userId: UserId,
    limit: number,
  ): Observable<Result<readonly Appointment[], RepositoryError>>;
}

export const APPOINTMENT_REPOSITORY = new InjectionToken<AppointmentRepository>(
  'AppointmentRepository',
);
