import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import type { Hash, HashPorts, IdPorts, NextId } from '@core/ports';

/**
 * The server's randomness and digests — the ONE `node:crypto` import of the
 * new adapters (blueprint §4.3, §6 Phase 3a). Every other adapter that needs
 * a random draw, a digest or a key derivation composes these primitives
 * (`otp-crypto.adapter.ts`), so the composition root hands the pipelines
 * `hash`/`nextId` from here and a system never meets `crypto` (Law 3).
 *
 * Plain functions over the SDK, no decisions: what a hash is FOR (an audit
 * row id, a waitlist id basis) is the system's, never this file's.
 */

/** The `hash` port: sha256 of the UTF-8 input, lower-case hex (64 characters). */
export const sha256Hex: Hash = (input) =>
  createHash('sha256').update(input, 'utf8').digest('hex');

/** The `nextId` port: a v4 UUID from Node's CSPRNG — the id exists before the write. */
export const randomUuid: NextId = () => randomUUID();

/** A uniform whole number in `[0, maxExclusive)` from the CSPRNG. */
export const randomIntBelow = (maxExclusive: number): number =>
  randomInt(0, maxExclusive);

/** `byteLength` random bytes, lower-case hex (twice as many characters). */
export const randomHex = (byteLength: number): string =>
  randomBytes(byteLength).toString('hex');

/** scrypt of `secret` under `salt`, `keyLength` bytes, lower-case hex. */
export const scryptHex = (
  secret: string,
  salt: string,
  keyLength: number,
): string => scryptSync(secret, salt, keyLength).toString('hex');

/**
 * Two hex digests compared in constant time (`timingSafeEqual`, never
 * `===`), so a mismatch cannot leak how many leading bytes were right.
 * Digests of different lengths are simply unequal.
 */
export const hexEqualInConstantTime = (a: string, b: string): boolean => {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
};

/**
 * The two primitives every pipeline receives (`TxPorts`), as the root builds
 * them — the intersection of the two bundles this factory serves (Law 9).
 */
export const cryptoPorts = (): HashPorts & IdPorts => ({
  hash: sha256Hex,
  nextId: randomUuid,
});
