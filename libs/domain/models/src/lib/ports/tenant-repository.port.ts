// TODO(goal-03): superseded by @creativo/application/governance's
// TenantRepositoryPort (blueprint §0.3 moves ports to
// libs/application/*/ports). Kept here, temporarily duplicated, only so
// apps/functions keeps compiling without a circular
// domain/models <-> application/* project reference. Delete this file once
// goal-03 ports every consumer over to importing from
// @creativo/application/governance.
import { Result } from '@creativo/domain/kernel';
import { TenantId } from '../ids';
import { Tenant } from '../tenant';
import { RepositoryError } from './repository.errors';

/** Interface only — no Firestore adapter yet, deferred until a real consumer (the dashboard/tenant-settings pass) needs it. */
export interface TenantRepositoryPort {
  save(tenant: Tenant): Promise<Result<void, RepositoryError>>;
  findById(id: TenantId): Promise<Result<Tenant | null, RepositoryError>>;
}
