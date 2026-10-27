import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import type {
  Hash,
  HashPorts,
  IdPorts,
  LogDigestPorts,
  NextId,
  WalkInKeyPorts,
} from '@core/ports';

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

/** HMAC-SHA-256 of the UTF-8 input under `key`, lower-case hex (64 characters). */
export const hmacSha256Hex = (key: string, input: string): string =>
  createHmac('sha256', key).update(input, 'utf8').digest('hex');

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

/**
 * The keyed digest a walk-in's record id is derived with
 * (`WalkInKeyPorts`, OR-26): HMAC-SHA-256 under the key `key()` answers,
 * read at EACH call — the composition root hands the `WALKIN_ID_KEY`
 * secret's reader, a runtime value never read at load. A plain sha256 of a
 * phone number is brute-forced back in seconds; under the server's key the
 * id says nothing about the contact.
 */
export const walkInKeyPorts = (key: () => string): WalkInKeyPorts => ({
  walkInHash: (input) => hmacSha256Hex(key(), input),
});

/**
 * The keyed digest a callable's outcome line prints as `inputDigest`
 * (`LogDigestPorts`, audit-hardening WS-4.2, RU-23): HMAC-SHA-256 under the
 * key `key()` answers, read at EACH call — the composition root hands the
 * `LOG_DIGEST_KEY` secret's reader. `''` when the key is empty: an unkeyed
 * digest of an id set is guessable, so `LogDigestSystem.digestOf` prints
 * none (`null`) and the call still answers.
 */
export const logDigestPorts = (key: () => string): LogDigestPorts => ({
  logDigest: (input) => {
    const secret = key();
    return secret === '' ? '' : hmacSha256Hex(secret, input);
  },
});
