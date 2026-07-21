// TODO(goal-03): superseded by @creativo/application/identity's
// OtpCodeGenerator/OtpCodeHasher (blueprint §0.3 moves ports to
// libs/application/*/ports). Kept here, temporarily duplicated, only so
// apps/functions keeps compiling without a circular
// domain/models <-> application/* project reference. Delete this file once
// goal-03 ports every consumer over to importing from
// @creativo/application/identity.
/**
 * OTP code generation and hashing genuinely need `node:crypto`
 * (`randomInt`, `scryptSync`, `timingSafeEqual`) — but `domain-models` is
 * `scope:shared` and gets consumed by browser apps too (transitively, via
 * the `*-data-access` libs), so it can never import a Node builtin
 * directly. These ports are the seam: `Otp`'s own methods depend only on
 * these interfaces; the concrete Node-crypto-backed implementation lives
 * in `apps/functions/src/adapters` (`scope:backend`, Node-only).
 */
export interface OtpCodeGenerator {
  generateCode(): string;
  generateSalt(): string;
}

export interface OtpCodeHasher {
  hash(code: string, salt: string): string;
  /** Must be constant-time — never `hash(...) === expectedHash`. */
  verify(code: string, salt: string, expectedHash: string): boolean;
}
