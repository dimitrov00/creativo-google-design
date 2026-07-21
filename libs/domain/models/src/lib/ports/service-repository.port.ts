// TODO(goal-03): superseded by @creativo/application/catalog's
// ServiceRepositoryPort (blueprint §0.3 moves ports to
// libs/application/*/ports). Kept here, temporarily duplicated, only so
// apps/functions keeps compiling without a circular
// domain/models <-> application/* project reference. Delete this file once
// goal-03 ports every consumer over to importing from
// @creativo/application/catalog.
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
