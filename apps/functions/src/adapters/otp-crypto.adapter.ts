import { OTP_CODE_DIGITS, type OtpCrypto } from '@creativo/ecs-core';
import {
  hexEqualInConstantTime,
  randomHex,
  randomIntBelow,
  scryptHex,
} from './crypto.adapter';

/**
 * The `OtpCrypto` port of `identity.port.ts` (functions Q3) — the code and
 * salt a challenge is issued with, and the hash it is stored and verified
 * by. Byte-for-byte today's `NodeOtpCrypto` (`node-otp-crypto.ts`) and
 * `FixedCodeOtpCrypto` (`fixed-code-otp-crypto.ts`), which stay until the
 * identity flip deletes the `lib/otp/*` handlers that construct them: a
 * challenge hashed by either verifies under the other.
 *
 * `codeMatches` is the port's constant-time comparison (`timingSafeEqual`,
 * as `NodeOtpCrypto.verify` does today): the typed code hashed with the
 * stored salt against the stored hash.
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
 * The emulator's fixed code (`FixedCodeOtpCrypto.FIXED_CODE`): manual QA
 * never fishes codes out of logs. Salting and hashing stay the real scrypt,
 * so the request → hash → verify path is the production one.
 */
export const OTP_FIXED_CODE = '123456';

const hashCode = (code: string, salt: string): string =>
  scryptHex(code, salt, HASH_BYTES);

/** Production: a CSPRNG code, a random salt, scrypt. */
export const nodeOtpCrypto = (): OtpCrypto => ({
  nextCode: () =>
    String(randomIntBelow(CODE_SPACE)).padStart(OTP_CODE_DIGITS, '0'),
  nextSalt: () => randomHex(SALT_BYTES),
  hashCode,
  codeMatches: (code, salt, expectedHash) =>
    hexEqualInConstantTime(expectedHash, hashCode(code, salt)),
});

/**
 * The emulator variant: every code is {@link OTP_FIXED_CODE}; everything
 * else is {@link nodeOtpCrypto}. Chosen only by the composition root behind
 * the `FUNCTIONS_EMULATOR` gate, the same gate that scopes `devCode`, so a
 * deployed environment can never construct it.
 */
export const fixedCodeOtpCrypto = (): OtpCrypto => ({
  ...nodeOtpCrypto(),
  nextCode: () => OTP_FIXED_CODE,
});
