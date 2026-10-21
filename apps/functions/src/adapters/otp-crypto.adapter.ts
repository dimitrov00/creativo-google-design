import { OTP_CODE_DIGITS } from '@core/components';
import type { OtpCrypto, OtpCryptoPorts } from '@core/ports';
import {
  hexEqualInConstantTime,
  randomHex,
  randomIntBelow,
  scryptHex,
} from './crypto.adapter';

/**
 * The `OtpCryptoPorts` bundle of `identity.port.ts` (functions Q3) — the
 * code and salt a challenge is issued with, and the hash it is stored and
 * verified by: scrypt over Node's CSPRNG, byte for byte the pre-flip node
 * crypto classes (their outputs are pinned in the spec as literal vectors),
 * so a challenge issued before the identity flip verifies after it.
 *
 * `codeMatches` is the port's constant-time comparison (`timingSafeEqual`):
 * the typed code hashed with the stored salt against the stored hash.
 */

/**
 * The code's length is the `OtpCode` component's policy, never restated
 * here: `randomInt(0, 10 ** OTP_CODE_DIGITS)` zero-padded to that width —
 * today's `randomInt(0, 1_000_000)` for six digits.
 */
const CODE_SPACE = 10 ** OTP_CODE_DIGITS;
/** 16 random bytes → 32 hex characters of salt. */
const SALT_BYTES = 16;
/** scrypt key length in bytes → 128 hex characters of hash. */
const HASH_BYTES = 64;

/**
 * The emulator's fixed code: manual QA never fishes codes out of logs.
 * Salting and hashing stay the real scrypt, so the request → hash → verify
 * path is the production one.
 */
export const OTP_FIXED_CODE = '123456';

const hashCode = (code: string, salt: string): string =>
  scryptHex(code, salt, HASH_BYTES);

/** The production crypto — the one value both factories hand out. */
const NODE_OTP_CRYPTO: OtpCrypto = {
  nextCode: () =>
    String(randomIntBelow(CODE_SPACE)).padStart(OTP_CODE_DIGITS, '0'),
  nextSalt: () => randomHex(SALT_BYTES),
  hashCode,
  codeMatches: (code, salt, expectedHash) =>
    hexEqualInConstantTime(expectedHash, hashCode(code, salt)),
};

/** Production: a CSPRNG code, a random salt, scrypt. */
export const nodeOtpCryptoPorts = (): OtpCryptoPorts => ({
  otpCrypto: NODE_OTP_CRYPTO,
});

/**
 * The emulator variant: every code is {@link OTP_FIXED_CODE}; the salt,
 * the hash and the comparison are production's. Chosen only by the composition root
 * behind the `FUNCTIONS_EMULATOR` gate, the same gate that scopes
 * `devCode`, so a deployed environment can never construct it.
 */
export const fixedCodeOtpCryptoPorts = (): OtpCryptoPorts => ({
  otpCrypto: { ...NODE_OTP_CRYPTO, nextCode: () => OTP_FIXED_CODE },
});
