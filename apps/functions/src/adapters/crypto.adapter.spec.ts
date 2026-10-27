import { createHash } from 'node:crypto';
import type {
  HashPorts,
  IdPorts,
  LogDigestPorts,
  WalkInKeyPorts,
} from '@core/ports';
import { LogDigestSystem } from '@core/systems';
import {
  cryptoPorts,
  hexEqualInConstantTime,
  hmacSha256Hex,
  logDigestPorts,
  randomHex,
  randomIntBelow,
  randomUuid,
  scryptHex,
  sha256Hex,
  walkInKeyPorts,
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

    it('scryptHex is the pre-flip node OTP hash, byte for byte — the vector recorded from it', () => {
      // Recorded from the deleted node OTP crypto class (`hash('123456',
      // 'salt-1')`) before the identity flip removed it.
      expect(scryptHex('123456', 'salt-1', 64)).toBe(
        'd2e8edcbea8ce981fb58140a58cbdc3b51a984b499b411299b1446a3373a53fb' +
          '44d50d0a518d67bc25407fade0fe494088d40545b1bf7973c182ec91e905f88d',
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

  it('cryptoPorts hands the root the two primitives — the HashPorts & IdPorts bundles', () => {
    const ports: HashPorts & IdPorts = cryptoPorts();
    expect(ports.hash).toBe(sha256Hex);
    expect(ports.nextId).toBe(randomUuid);
    expect(Object.keys(ports).sort()).toEqual(['hash', 'nextId']);
  });

  describe('walkInKeyPorts — the keyed walk-in digest (OR-26)', () => {
    it('is HMAC-SHA-256, lower-case hex (the RFC 4231 test case 2 vector)', () => {
      expect(hmacSha256Hex('Jefe', 'what do ya want for nothing?')).toBe(
        '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
      );
    });

    it('keys the digest: two keys, two digests of one contact — and neither is its plain sha256', () => {
      const basis = 'walkin/v1:+359888123456';
      const one = walkInKeyPorts(() => 'key-one').walkInHash(basis);
      const two = walkInKeyPorts(() => 'key-two').walkInHash(basis);
      expect(one).toMatch(/^[0-9a-f]{64}$/);
      expect(one).not.toBe(two);
      expect(one).not.toBe(sha256Hex(basis));
      // One key, one digest — the record id still dedupes.
      expect(walkInKeyPorts(() => 'key-one').walkInHash(basis)).toBe(one);
    });

    it('reads the key at each call, never once at build — a secret is a runtime value', () => {
      let key = 'before';
      const ports: WalkInKeyPorts = walkInKeyPorts(() => key);
      const before = ports.walkInHash('walkin/v1:x');
      key = 'after';
      expect(ports.walkInHash('walkin/v1:x')).not.toBe(before);
      expect(ports.walkInHash('walkin/v1:x')).toBe(
        hmacSha256Hex('after', 'walkin/v1:x'),
      );
      expect(Object.keys(ports)).toEqual(['walkInHash']);
    });
  });

  describe('logDigestPorts — the outcome line’s keyed input digest (WS-4.2, RU-23)', () => {
    it('is HMAC-SHA-256 under the key, read at each call', () => {
      let key = 'Jefe';
      const ports: LogDigestPorts = logDigestPorts(() => key);
      expect(Object.keys(ports)).toEqual(['logDigest']);
      expect(ports.logDigest('what do ya want for nothing?')).toBe(
        '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
      );
      key = 'other';
      expect(ports.logDigest('what do ya want for nothing?')).toBe(
        hmacSha256Hex('other', 'what do ya want for nothing?'),
      );
    });

    it('answers `` with no key — and the outcome line then prints no digest', () => {
      const ports = logDigestPorts(() => '');
      expect(ports.logDigest('{"appointmentId":"a-1"}')).toBe('');
      expect(
        LogDigestSystem.digestOf({ appointmentId: 'a-1' }, ports.logDigest),
      ).toBeNull();
    });

    it('digests the allowlisted basis only — a contact value changes nothing', () => {
      const { logDigest } = logDigestPorts(() => 'spec-log-key');
      const one = LogDigestSystem.digestOf(
        { appointmentId: 'a-1', contact: { phone: '+359888123456' } },
        logDigest,
      );
      const two = LogDigestSystem.digestOf(
        { appointmentId: 'a-1', contact: { phone: '+359888999999' } },
        logDigest,
      );
      expect(one).toMatch(/^[0-9a-f]{16}$/);
      expect(two).toBe(one);
      expect(
        LogDigestSystem.digestOf({ appointmentId: 'a-2' }, logDigest),
      ).not.toBe(one);
    });
  });
});
