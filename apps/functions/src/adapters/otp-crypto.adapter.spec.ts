import { OtpCode } from '@core/components';
import type { OtpCryptoPorts } from '@core/ports';
import {
  OTP_FIXED_CODE,
  fixedCodeOtpCryptoPorts,
  nodeOtpCryptoPorts,
} from './otp-crypto.adapter';

/*
 * The OTP crypto bundle (identity flip (2), F2-18). The parity cases that
 * used the pre-flip node crypto classes as live oracles state their outputs
 * as LITERAL vectors, recorded from those classes before the flip deleted
 * them (delta 5): a challenge hashed before the flip verifies after it.
 */

/** A 16-byte hex salt, as `nextSalt` draws them. */
const SALT = '9f86d081884c7d659a2feaa0c55ad015';

/** The recorded vectors: the pre-flip `hash(code, SALT)` of each code. */
const RECORDED = {
  '042917':
    '5d10dce937ab8b69b1382d1e1a88f4bd4009958f62cdb428a997b867340dfbf1' +
    '85ea4b80feef5177e27032f07a67fcf9c0e80ba271c8ec0c7c2fbdd0318cf7a1',
  '111111':
    '0508e8bee2261cf4d59a650f2ecf0da38f141d661607c4f82ea14592963af005' +
    'f876bc2c91c1a7a7637784970b5edb78470ef8c0bec704c3dc4cd333b152918e',
  '123456':
    'a845aee234cd3662e786c9628aeb3f30865cea14077edf212f8973578d0bd8ce' +
    '6d3b4642131cc8730d68f29d1e3e808184239d69183b4f8ffd20da3971d6043a',
} as const;

describe('otp-crypto adapter', () => {
  it('both variants are the OtpCryptoPorts bundle', () => {
    const node: OtpCryptoPorts = nodeOtpCryptoPorts();
    const fixed: OtpCryptoPorts = fixedCodeOtpCryptoPorts();
    expect(Object.keys(node)).toEqual(['otpCrypto']);
    expect(Object.keys(fixed)).toEqual(['otpCrypto']);
    expect(typeof node.otpCrypto.nextCode).toBe('function');
    expect(typeof fixed.otpCrypto.hashCode).toBe('function');
  });

  describe('node (production)', () => {
    const crypto = nodeOtpCryptoPorts().otpCrypto;

    it('draws six-digit, zero-padded codes', () => {
      for (let i = 0; i < 500; i++) {
        expect(crypto.nextCode()).toMatch(/^\d{6}$/);
      }
    });

    it('draws codes of the OtpCode component’s length — every one parses at the edge', () => {
      expect(OtpCode.DIGITS).toBe(6);
      for (let i = 0; i < 200; i++) {
        const code = crypto.nextCode();
        expect(code).toHaveLength(OtpCode.DIGITS);
        expect(OtpCode.parse(code).ok).toBe(true);
      }
      expect(OtpCode.parse(OTP_FIXED_CODE).ok).toBe(true);
    });

    it('draws a fresh 16-byte hex salt per challenge', () => {
      const salts = new Set(
        Array.from({ length: 20 }, () => crypto.nextSalt()),
      );
      expect(salts.size).toBe(20);
      for (const salt of salts) expect(salt).toMatch(/^[0-9a-f]{32}$/);
    });

    it('hashes exactly as the pre-flip node crypto did — a stored challenge verifies either way', () => {
      const hash = crypto.hashCode('042917', SALT);
      expect(hash).toBe(RECORDED['042917']);
      expect(hash).toMatch(/^[0-9a-f]{128}$/);
      expect(crypto.hashCode('042917', SALT)).toBe(hash);
      // A challenge the pre-flip handler issued verifies under the adapter.
      expect(crypto.codeMatches('042917', SALT, RECORDED['042917'])).toBe(true);
    });

    it('codeMatches is the pre-flip constant-time verify — its recorded verdicts', () => {
      const stored = crypto.hashCode('111111', SALT);
      expect(stored).toBe(RECORDED['111111']);
      // Recorded: true for the right code, false for a wrong one, a
      // truncated hash and an empty one.
      for (const [typed, hash, verdict] of [
        ['111111', stored, true],
        ['111112', stored, false],
        ['111111', stored.slice(0, 64), false],
        ['111111', '', false],
      ] as const) {
        expect(crypto.codeMatches(typed, SALT, hash)).toBe(verdict);
      }
    });

    it('verifies a code hashed with the same salt, and rejects a wrong code or another salt', () => {
      const salt = crypto.nextSalt();
      const hash = crypto.hashCode('123456', salt);
      expect(crypto.codeMatches('123456', salt, hash)).toBe(true);
      expect(crypto.codeMatches('999999', salt, hash)).toBe(false);
      expect(crypto.codeMatches('123456', crypto.nextSalt(), hash)).toBe(false);
    });

    it('never stores the raw code as the hash itself', () => {
      expect(crypto.hashCode('123456', crypto.nextSalt())).not.toBe('123456');
    });
  });

  describe('fixed code (the emulator)', () => {
    const crypto = fixedCodeOtpCryptoPorts().otpCrypto;

    it('pins every code to the pre-flip fixed code', () => {
      // Recorded: the pre-flip fixed-code class's `FIXED_CODE` and its
      // `generateCode()` — both '123456'.
      expect(OTP_FIXED_CODE).toBe('123456');
      expect(crypto.nextCode()).toBe('123456');
      expect(crypto.nextCode()).toBe('123456');
    });

    it('keeps the real salt and scrypt, so request → hash → verify is production', () => {
      const salt = crypto.nextSalt();
      expect(salt).toMatch(/^[0-9a-f]{32}$/);
      const hash = crypto.hashCode(OTP_FIXED_CODE, salt);
      expect(hash).toBe(
        nodeOtpCryptoPorts().otpCrypto.hashCode(OTP_FIXED_CODE, salt),
      );
      expect(crypto.hashCode(OTP_FIXED_CODE, SALT)).toBe(RECORDED['123456']);
      expect(crypto.codeMatches(OTP_FIXED_CODE, salt, hash)).toBe(true);
      expect(crypto.codeMatches('654321', salt, hash)).toBe(false);
    });
  });
});
