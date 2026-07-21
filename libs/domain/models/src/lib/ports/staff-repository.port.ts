// TODO(goal-03): superseded by @creativo/application/catalog's
// StaffRepositoryPort (blueprint §0.3 moves ports to
// libs/application/*/ports). Kept here, temporarily duplicated, only so
// apps/functions keeps compiling without a circular
// domain/models <-> application/* project reference. Delete this file once
// goal-03 ports every consumer over to importing from
// @creativo/application/catalog.
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
