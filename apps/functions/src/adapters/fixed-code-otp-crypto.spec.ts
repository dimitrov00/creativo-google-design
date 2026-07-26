import { describe, expect, it } from 'vitest';
import { FixedCodeOtpCrypto } from './fixed-code-otp-crypto';

describe('FixedCodeOtpCrypto', () => {
  it('always generates the fixed 123456 code', () => {
    const crypto = new FixedCodeOtpCrypto();
    expect(crypto.generateCode()).toBe('123456');
    expect(crypto.generateCode()).toBe('123456');
  });

  it('keeps the REAL hashing pipeline — the fixed code round-trips through scrypt verify', () => {
    const crypto = new FixedCodeOtpCrypto();
    const salt = crypto.generateSalt();
    const hash = crypto.hash(crypto.generateCode(), salt);
    expect(crypto.verify('123456', salt, hash)).toBe(true);
    expect(crypto.verify('654321', salt, hash)).toBe(false);
  });
});
