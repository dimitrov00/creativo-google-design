import { createHash } from 'node:crypto';
import type { Hash, NextId } from '@creativo/ecs-core';
import { NodeOtpCrypto } from './node-otp-crypto';
import {
  cryptoPorts,
  hexEqualInConstantTime,
  randomHex,
  randomIntBelow,
  randomUuid,
  scryptHex,
  sha256Hex,
} from './crypto.adapter';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('crypto adapter', () => {
  describe('sha256Hex — the `hash` port', () => {
    it('is sha256, lower-case hex (the FIPS 180-2 vectors)', () => {
      expect(sha256Hex('')).toBe(
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      );
      expect(sha256Hex('abc')).toBe(
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      );
    });

    it('is deterministic: the same basis always hashes to the same id', () => {
      const basis = 'booking.committed|appt-1|u-1|attempt:a-1';
      expect(sha256Hex(basis)).toBe(sha256Hex(basis));
      expect(sha256Hex(basis)).not.toBe(sha256Hex(`${basis} `));
    });

    it('hashes the UTF-8 bytes, as the legacy `createHash(…).update(basis)` digests do', () => {
      for (const basis of ['Иван|2026-10-07', 'émile', '🙂', 'wl_basis']) {
        expect(sha256Hex(basis)).toBe(
          createHash('sha256').update(basis).digest('hex'),
        );
      }
    });

    it('answers 64 hex characters for any input', () => {
      expect(sha256Hex('x'.repeat(10_000))).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('randomUuid — the `nextId` port', () => {
    it('draws a fresh v4 uuid on every call', () => {
      const ids = new Set(Array.from({ length: 50 }, () => randomUuid()));
      expect(ids.size).toBe(50);
      for (const id of ids) expect(id).toMatch(UUID_V4);
    });
  });

  describe('the OTP primitives', () => {
    it('randomIntBelow stays in [0, max)', () => {
      for (let i = 0; i < 200; i++) {
        const n = randomIntBelow(10);
        expect(Number.isInteger(n)).toBe(true);
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThan(10);
      }
    });

    it('randomHex draws byteLength bytes as twice as many hex characters', () => {
      expect(randomHex(16)).toMatch(/^[0-9a-f]{32}$/);
      expect(randomHex(16)).not.toBe(randomHex(16));
    });

    it('scryptHex is the legacy NodeOtpCrypto hash, byte for byte', () => {
      const legacy = new NodeOtpCrypto();
      expect(scryptHex('123456', 'salt-1', 64)).toBe(
        legacy.hash('123456', 'salt-1'),
      );
      expect(scryptHex('123456', 'salt-1', 64)).toMatch(/^[0-9a-f]{128}$/);
    });

    it('hexEqualInConstantTime compares digests, unequal when lengths differ', () => {
      const digest = sha256Hex('a');
      expect(hexEqualInConstantTime(digest, sha256Hex('a'))).toBe(true);
      expect(hexEqualInConstantTime(digest, sha256Hex('b'))).toBe(false);
      expect(hexEqualInConstantTime(digest, digest.slice(0, 32))).toBe(false);
      expect(hexEqualInConstantTime('', '')).toBe(true);
    });
  });

  it('cryptoPorts hands the root the two primitives', () => {
    const ports = cryptoPorts();
    const hash: Hash = ports.hash;
    const nextId: NextId = ports.nextId;
    expect(hash).toBe(sha256Hex);
    expect(nextId).toBe(randomUuid);
  });
});
