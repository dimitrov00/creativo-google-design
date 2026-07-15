import { describe, expect, it } from 'vitest';
import { NodeOtpCrypto } from './node-otp-crypto';

describe('NodeOtpCrypto.generateCode', () => {
  it('always produces a 6-digit, zero-padded string', () => {
    const crypto = new NodeOtpCrypto();
    for (let i = 0; i < 200; i++) {
      expect(crypto.generateCode()).toMatch(/^\d{6}$/);
    }
  });
});

describe('NodeOtpCrypto.hash / verify', () => {
  it('verifies a code hashed with the same salt', () => {
    const crypto = new NodeOtpCrypto();
    const salt = crypto.generateSalt();
    const hash = crypto.hash('123456', salt);
    expect(crypto.verify('123456', salt, hash)).toBe(true);
  });

  it('rejects a wrong code', () => {
    const crypto = new NodeOtpCrypto();
    const salt = crypto.generateSalt();
    const hash = crypto.hash('123456', salt);
    expect(crypto.verify('999999', salt, hash)).toBe(false);
  });

  it('rejects the right code hashed with a different salt', () => {
    const crypto = new NodeOtpCrypto();
    const hash = crypto.hash('123456', crypto.generateSalt());
    expect(crypto.verify('123456', crypto.generateSalt(), hash)).toBe(false);
  });

  it('never stores/compares the raw code as the hash itself', () => {
    const crypto = new NodeOtpCrypto();
    const salt = crypto.generateSalt();
    expect(crypto.hash('123456', salt)).not.toBe('123456');
  });
});
