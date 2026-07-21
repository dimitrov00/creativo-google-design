// TODO(goal-03): superseded by @creativo/application/booking's
// AppointmentRepositoryPort (blueprint §0.3 moves ports to
// libs/application/*/ports). Kept here, temporarily duplicated, only so
// apps/functions keeps compiling without a circular
// domain/models <-> application/* project reference. Delete this file once
// goal-03 ports every consumer over to importing from
// @creativo/application/booking.
import { Result } from '@creativo/domain/kernel';
import { Appointment } from '../appointment';
import { AppointmentId, StaffId, TenantId } from '../ids';
import { RepositoryError } from './repository.errors';

/** Interface only — no Firestore adapter yet, deferred until a real consumer (the booking-flow pass) needs it. */
export interface AppointmentRepositoryPort {
  save(appointment: Appointment): Promise<Result<void, RepositoryError>>;
  findById(
    id: AppointmentId,
  ): Promise<Result<Appointment | null, RepositoryError>>;
  findByTenantAndDateRange(
    tenantId: TenantId,
    startIso: string,
    endIso: string,
  ): Promise<Result<Appointment[], RepositoryError>>;
  findByStaffAndDateRange(
    staffId: StaffId,
    startIso: string,
    endIso: string,
  ): Promise<Result<Appointment[], RepositoryError>>;
}
