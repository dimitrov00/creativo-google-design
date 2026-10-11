import { OTP_CODE_DIGITS, OtpCode } from '@core/components';
import { type OtpCrypto } from '@core/ports';
import { FixedCodeOtpCrypto } from './fixed-code-otp-crypto';
import { NodeOtpCrypto } from './node-otp-crypto';
import {
  OTP_FIXED_CODE,
  fixedCodeOtpCrypto,
  nodeOtpCrypto,
} from './otp-crypto.adapter';

describe('otp-crypto adapter', () => {
  it('both variants satisfy the OtpCrypto port', () => {
    const node: OtpCrypto = nodeOtpCrypto();
    const fixed: OtpCrypto = fixedCodeOtpCrypto();
    expect(typeof node.nextCode).toBe('function');
    expect(typeof fixed.hashCode).toBe('function');
  });

  describe('node (production)', () => {
    const crypto = nodeOtpCrypto();

    it('draws six-digit, zero-padded codes', () => {
      for (let i = 0; i < 500; i++) {
        expect(crypto.nextCode()).toMatch(/^\d{6}$/);
      }
    });

    it('draws codes of the OtpCode component’s length — every one parses at the edge', () => {
      expect(OTP_CODE_DIGITS).toBe(6);
      for (let i = 0; i < 200; i++) {
        const code = crypto.nextCode();
        expect(code).toHaveLength(OTP_CODE_DIGITS);
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

    it('hashes exactly as the legacy NodeOtpCrypto does — a stored challenge verifies either way', () => {
      const legacy = new NodeOtpCrypto();
      const salt = legacy.generateSalt();
      const hash = crypto.hashCode('042917', salt);
      expect(hash).toBe(legacy.hash('042917', salt));
      expect(hash).toMatch(/^[0-9a-f]{128}$/);
      expect(crypto.hashCode('042917', salt)).toBe(hash);
      // A challenge the legacy handler issued verifies under the adapter…
      expect(
        crypto.codeMatches('042917', salt, legacy.hash('042917', salt)),
      ).toBe(true);
      // …and one the adapter issues verifies under the legacy handler.
      expect(legacy.verify('042917', salt, hash)).toBe(true);
    });

    it('codeMatches is the legacy constant-time verify', () => {
      const legacy = new NodeOtpCrypto();
      const salt = crypto.nextSalt();
      const stored = crypto.hashCode('111111', salt);
      for (const [typed, hash] of [
        ['111111', stored],
        ['111112', stored],
        ['111111', stored.slice(0, 64)],
        ['111111', ''],
      ] as const) {
        expect(crypto.codeMatches(typed, salt, hash)).toBe(
          legacy.verify(typed, salt, hash),
        );
      }
      expect(crypto.codeMatches('111111', salt, stored)).toBe(true);
      expect(crypto.codeMatches('111112', salt, stored)).toBe(false);
    });
  });

  describe('fixed code (the emulator)', () => {
    const crypto = fixedCodeOtpCrypto();

    it('pins every code to the legacy FIXED_CODE', () => {
      expect(OTP_FIXED_CODE).toBe(FixedCodeOtpCrypto.FIXED_CODE);
      expect(crypto.nextCode()).toBe('123456');
      expect(crypto.nextCode()).toBe(new FixedCodeOtpCrypto().generateCode());
    });

    it('keeps the real salt and scrypt, so request → hash → verify is production', () => {
      const salt = crypto.nextSalt();
      expect(salt).toMatch(/^[0-9a-f]{32}$/);
      const hash = crypto.hashCode(OTP_FIXED_CODE, salt);
      expect(hash).toBe(nodeOtpCrypto().hashCode(OTP_FIXED_CODE, salt));
      expect(hash).toBe(new FixedCodeOtpCrypto().hash(OTP_FIXED_CODE, salt));
      expect(crypto.codeMatches(OTP_FIXED_CODE, salt, hash)).toBe(true);
    });
  });
});
