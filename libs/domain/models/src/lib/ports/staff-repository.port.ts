import { Result } from '@creativo/domain/kernel';
import { StaffId, TenantId } from '../ids';
import { Staff } from '../staff';
import { RepositoryError } from './repository.errors';

/** Interface only — no Firestore adapter yet, deferred until a real consumer (the dashboard/booking-flow pass) needs it. */
export interface StaffRepositoryPort {
  save(staff: Staff): Promise<Result<void, RepositoryError>>;
  findById(id: StaffId): Promise<Result<Staff | null, RepositoryError>>;
  findByTenant(tenantId: TenantId): Promise<Result<Staff[], RepositoryError>>;
}
