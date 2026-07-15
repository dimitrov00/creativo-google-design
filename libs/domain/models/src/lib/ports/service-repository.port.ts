import { Result } from '@creativo/domain/kernel';
import { ServiceId, TenantId } from '../ids';
import { Service } from '../service';
import { RepositoryError } from './repository.errors';

/** Interface only — no Firestore adapter yet, deferred until a real consumer (the booking-flow pass) needs it. */
export interface ServiceRepositoryPort {
  save(service: Service): Promise<Result<void, RepositoryError>>;
  findById(id: ServiceId): Promise<Result<Service | null, RepositoryError>>;
  findByTenant(tenantId: TenantId): Promise<Result<Service[], RepositoryError>>;
}
