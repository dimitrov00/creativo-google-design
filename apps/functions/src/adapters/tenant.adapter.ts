import { Result, type TenantId } from '@core/primitives';
import type { TenantPorts } from '@core/ports';

/**
 * The tenant a new challenge and its tokens belong to (identity flip (2),
 * blueprint §4.1) — the single deployment's tenant, handed in by the
 * composition root (`main.ts`'s `DEFAULT_TENANT`, parsed there once). No
 * literal and no cast here: a real multi-tenant deployment resolves the
 * tenant from the request's origin, and replaces this factory, not the
 * pipelines.
 */
export const singleTenantPorts = (tenantId: TenantId): TenantPorts => ({
  loadTenant: async () => Result.ok(tenantId),
});
