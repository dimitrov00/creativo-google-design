import { describe, expect, it } from 'vitest';
import { CryptoIdGenerator } from './crypto-id-generator.adapter';

describe('CryptoIdGenerator', () => {
  it('produces a non-empty, unique id on each call', () => {
    const generator = new CryptoIdGenerator();
    const a = generator.next();
    const b = generator.next();
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });
});
