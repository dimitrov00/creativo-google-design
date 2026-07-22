import { describe, expect, it } from 'vitest';
import { FeatureFlags } from './feature-flags';
import { TenantConfig, TenantConfigProps } from './tenant-config';

function validProps(
  overrides: Partial<TenantConfigProps> = {},
): TenantConfigProps {
  return {
    name: 'Creativo Barbershop',
    timezone: 'Europe/Sofia',
    locale: 'bg',
    currencyCode: 'EUR',
    featureFlags: FeatureFlags.defaults(),
    ...overrides,
  };
}

describe('TenantConfig.create', () => {
  it('accepts a fully valid config', () => {
    const result = TenantConfig.create(validProps());
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.name).toBe('Creativo Barbershop');
      expect(result.value.currencyCode.value).toBe('EUR');
      expect(result.value.locale).toBe('bg');
    }
  });

  it('rejects an empty name', () => {
    const result = TenantConfig.create(validProps({ name: '   ' }));
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(
        result.error.some(
          (e) => e.code === 'governance.tenant_config.empty_name',
        ),
      ).toBe(true);
    }
  });

  it('rejects an invalid IANA timezone', () => {
    const result = TenantConfig.create(validProps({ timezone: 'Not/AZone' }));
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(
        result.error.some(
          (e) => e.code === 'governance.tenant_config.invalid_timezone',
        ),
      ).toBe(true);
    }
  });

  it('rejects an unsupported locale', () => {
    const result = TenantConfig.create(validProps({ locale: 'fr' }));
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(
        result.error.some((e) => e.code === 'governance.locale.invalid'),
      ).toBe(true);
    }
  });

  it('rejects an unknown currency code', () => {
    const result = TenantConfig.create(validProps({ currencyCode: 'XYZ' }));
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(
        result.error.some((e) => e.code === 'governance.currency_code.unknown'),
      ).toBe(true);
    }
  });

  it('collects every invalid field at once', () => {
    const result = TenantConfig.create(
      validProps({
        name: '',
        timezone: 'bad',
        locale: 'fr',
        currencyCode: 'XYZ',
      }),
    );
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toHaveLength(4);
    }
  });
});

describe('TenantConfig.reconstitute', () => {
  it('validates identically to create', () => {
    const result = TenantConfig.reconstitute(validProps());
    expect(result.isSuccess()).toBe(true);
  });

  it('still rejects malformed persisted data', () => {
    const result = TenantConfig.reconstitute(validProps({ timezone: 'nope' }));
    expect(result.isFailure()).toBe(true);
  });
});

describe('TenantConfig.withFeatureFlags', () => {
  it('returns a new instance and never mutates the original', () => {
    const result = TenantConfig.create(validProps());
    if (result.isFailure())
      throw new Error('unexpected failure in test fixture');
    const original = result.value;
    const updated = original.withFeatureFlags(
      FeatureFlags.defaults().withFlag('rewards.points', true),
    );

    expect(original.featureFlags.isEnabled('rewards.points')).toBe(false);
    expect(updated.featureFlags.isEnabled('rewards.points')).toBe(true);
    expect(updated).not.toBe(original);
  });
});
