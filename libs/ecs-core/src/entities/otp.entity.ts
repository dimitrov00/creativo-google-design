import type { Identifier } from '../components/identifier.data';
import type { OtpDestinationType } from '../components/otp-destination-type.data';
import type { OtpPurpose } from '../components/otp-purpose.data';
import type { TenantId } from '../components/tenant-id.data';

export type OtpId = string & { readonly __brand: unique symbol };

export const OtpId = {
  /** The only cast site. Validate the raw string at the edge, not here. */
  of: (raw: string): OtpId => raw as OtpId,
} as const;

/**
 * An in-flight (or resolved) one-time-code challenge — the stored body of
 * `firestore-otp-repository.ts:14-27`, **as today** (blueprint §2.6), with
 * the ISO stamps as epoch ms. The document body is this type minus `id`.
 *
 * `destination` is the raw identifier value (the E.164 or the e-mail) as a
 * scalar — index #10 (`destination, consumedAtMs, createdAtMs`) and the
 * open-window probe query it — and `destinationType` says which. The code
 * itself is never stored: only `codeHash` and its `salt`, computed by the
 * `OtpCrypto` port. `purgeAt` (= `expiresAtMs` + 24 h, a TTL Timestamp) is
 * adapter-stamped at the document root and is not an entity field.
 */
export type OtpEntity = {
  readonly id: OtpId;
  readonly tenantId: TenantId;
  readonly destination: Identifier;
  readonly destinationType: OtpDestinationType;
  readonly purpose: OtpPurpose;
  readonly codeHash: string;
  readonly salt: string;
  readonly expiresAtMs: number;
  /** Wrong codes recorded so far (`OtpSystem.recordAttempt`). */
  readonly attemptCount: number;
  /** The lock-out threshold, stored per challenge. */
  readonly maxAttempts: number;
  /** When the challenge was used; `null` while open. */
  readonly consumedAtMs: number | null;
  readonly createdAtMs: number;
};
