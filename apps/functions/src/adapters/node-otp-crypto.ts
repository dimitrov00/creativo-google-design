import {
  randomBytes,
  randomInt,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { OtpCodeGenerator, OtpCodeHasher } from '@creativo/domain/models';

/**
 * `node:crypto`-backed implementation of the OTP crypto ports declared in
 * `domain-models` — genuinely Node-only (`scryptSync`/`timingSafeEqual`
 * have no true browser equivalent), which is exactly why `Otp`'s own
 * methods only depend on the port interfaces, never this class directly.
 */
export class NodeOtpCrypto implements OtpCodeGenerator, OtpCodeHasher {
  generateCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  generateSalt(): string {
    return randomBytes(16).toString('hex');
  }

  hash(code: string, salt: string): string {
    return scryptSync(code, salt, 64).toString('hex');
  }

  /** Constant-time (`timingSafeEqual`, not `===`) so a mismatch can't leak how many leading bytes were correct. */
  verify(code: string, salt: string, expectedHash: string): boolean {
    const expected = Buffer.from(expectedHash, 'hex');
    const actual = Buffer.from(this.hash(code, salt), 'hex');
    if (expected.length !== actual.length) {
      return false;
    }
    return timingSafeEqual(expected, actual);
  }
}
