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
