import { TenantId } from '@core/primitives';
import type { TenantPorts } from '@core/ports';
import { singleTenantPorts } from './tenant.adapter';

describe('singleTenantPorts — the single deployment’s tenant', () => {
  it('is the TenantPorts bundle, answering exactly the tenant the root handed it', async () => {
    const tenant = TenantId.of('creativo');
    const ports: TenantPorts = singleTenantPorts(tenant);
    expect(await ports.loadTenant()).toEqual({ ok: true, value: 'creativo' });
    expect(await ports.loadTenant()).toEqual({ ok: true, value: tenant });
  });

  it('holds no literal of its own — another tenant is another root argument', async () => {
    const other = TenantId.of('elsewhere');
    expect(await singleTenantPorts(other).loadTenant()).toEqual({
      ok: true,
      value: 'elsewhere',
    });
  });
});
