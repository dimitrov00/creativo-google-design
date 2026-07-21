import { Result } from '@creativo/domain/kernel';
import { Tenant, TenantId } from '@creativo/domain/models';
import { RepositoryError } from '@creativo/application/shared';

/** Interface only — no Firestore adapter yet, deferred until a real consumer (the dashboard/tenant-settings pass) needs it. */
export interface TenantRepositoryPort {
  save(tenant: Tenant): Promise<Result<void, RepositoryError>>;
  findById(id: TenantId): Promise<Result<Tenant | null, RepositoryError>>;
}
