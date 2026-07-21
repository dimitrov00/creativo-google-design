import { Result } from '@creativo/domain/kernel';
import {
  Appointment,
  AppointmentId,
  StaffId,
  TenantId,
} from '@creativo/domain/models';
import { RepositoryError } from '@creativo/application/shared';

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
