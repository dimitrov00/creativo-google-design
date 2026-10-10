import { describe, expect, it } from 'vitest';
import { TenantId } from './tenant-id.data';

// The models ids.spec.ts TenantId cases, on the brand.
describe('TenantId', () => {
  it('parse accepts a non-blank id and keeps it exactly as given', () => {
    expect(TenantId.parse('creativo')).toBe('creativo');
    expect(TenantId.parse(' creativo ')).toBe(' creativo ');
  });

  it('parse rejects an empty or whitespace-only id', () => {
    expect(TenantId.parse('')).toBeNull();
    expect(TenantId.parse('   ')).toBeNull();
  });

  it('of() is a zero-cost cast and equals compares the string', () => {
    expect(TenantId.of('creativo')).toBe('creativo');
    expect(TenantId.equals(TenantId.of('a'), TenantId.of('a'))).toBe(true);
    expect(TenantId.equals(TenantId.of('a'), TenantId.of('b'))).toBe(false);
  });

  it('is nominal: a raw string is not a TenantId', () => {
    // @ts-expect-error — only TenantId.of / parse make one
    const raw: TenantId = 'creativo';
    expect(raw).toBe('creativo');
  });
});
