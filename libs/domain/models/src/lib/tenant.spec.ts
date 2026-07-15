import { describe, expect, it } from 'vitest';
import { Tenant } from './tenant';

function validProps() {
  return {
    id: 'tenant_1',
    name: 'Creativo Barbershop',
    slug: 'creativo',
    timezone: 'Europe/Sofia',
    contactEmail: 'hello@creativo.com',
    contactPhone: '+15551234567',
  };
}

describe('Tenant.create', () => {
  it('accepts fully valid props', () => {
    const result = Tenant.create(validProps());
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.name).toBe('Creativo Barbershop');
      expect(result.value.slug).toBe('creativo');
      expect(result.value.contact.email?.value).toBe('hello@creativo.com');
      expect(result.value.contact.phone).toBe('+15551234567');
    }
  });

  it('allows omitting optional contact fields', () => {
    const result = Tenant.create({
      id: 'tenant_1',
      name: 'Creativo Barbershop',
      slug: 'creativo',
      timezone: 'Europe/Sofia',
    });
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value.contact.email).toBeNull();
      expect(result.value.contact.phone).toBeNull();
    }
  });

  it('rejects an empty id, collecting it alongside other field errors', () => {
    const result = Tenant.create({ ...validProps(), id: '', name: '' });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toHaveLength(2);
    }
  });

  it('rejects an empty name', () => {
    expect(Tenant.create({ ...validProps(), name: '  ' }).isFailure()).toBe(
      true,
    );
  });

  it('rejects a malformed slug', () => {
    expect(
      Tenant.create({ ...validProps(), slug: 'Not A Slug!' }).isFailure(),
    ).toBe(true);
  });

  it('rejects an invalid time zone', () => {
    expect(
      Tenant.create({ ...validProps(), timezone: 'Not/AZone' }).isFailure(),
    ).toBe(true);
  });

  it('rejects a malformed contact email', () => {
    expect(
      Tenant.create({
        ...validProps(),
        contactEmail: 'not-an-email',
      }).isFailure(),
    ).toBe(true);
  });

  it('collects every invalid field at once, not just the first', () => {
    const result = Tenant.create({
      id: 'tenant_1',
      name: '',
      slug: 'BAD SLUG',
      timezone: 'Not/AZone',
      contactEmail: 'not-an-email',
    });
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toHaveLength(4);
    }
  });
});

describe('Tenant.reconstitute', () => {
  it('validates identically to create() — no creation-only invariants for Tenant', () => {
    const result = Tenant.reconstitute(validProps());
    expect(result.isSuccess()).toBe(true);
  });
});
