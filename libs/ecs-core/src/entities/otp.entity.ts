import type {
  Identifier,
  OtpDestinationType,
  OtpPurpose,
} from '@core/components';
import type { OtpId, TenantId, UtcEpochMs } from '@core/primitives';

/**
 * An in-flight (or resolved) one-time-code challenge — `otps/{id}`, flat
 * (Law 6; flatten-spec §3.7). The document body is this type minus `id`;
 * until the identity flip the stored bytes are today's (ISO stamps,
 * lowercase tags), the shims converting.
 *
 * `destination` is the raw identifier value (the E.164 or the e-mail) as a
 * scalar — index #10 (`destination, consumedAt…, createdAt…`) and the
 * open-window probe query it — and `otpDestinationType` says which channel.
 * The code itself is never stored: only `codeHash` and its `salt`, computed
 * by the `OtpCrypto` port. Every instant is a lifecycle stamp (`*UtcMs`): an
 * OTP has no location, so no shop clock (flatten-spec F-5). `purgeAt`
 * (= `expiresAtUtcMs` + 24 h, a TTL Timestamp) is adapter-stamped at the
 * document root and is not an entity field.
 */
export type Otp = {
  readonly id: OtpId;
  readonly tenantId: TenantId;
  readonly destination: Identifier;
  readonly otpDestinationType: OtpDestinationType;
  readonly otpPurpose: OtpPurpose;
  readonly codeHash: string;
  readonly salt: string;
  readonly expiresAtUtcMs: UtcEpochMs;
  /** Wrong codes recorded so far (`OtpSystem.recordAttempt`). */
  readonly attemptCount: number;
  /** The lock-out threshold, stored per challenge. */
  readonly maxAttempts: number;
  /** When the challenge was used; `null` while open. */
  readonly consumedAtUtcMs: UtcEpochMs | null;
  readonly createdAtUtcMs: UtcEpochMs;
};
