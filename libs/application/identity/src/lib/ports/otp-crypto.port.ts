/**
 * OTP code generation and hashing genuinely need `node:crypto`
 * (`randomInt`, `scryptSync`, `timingSafeEqual`) — but `application/identity`
 * is `scope:shared` and gets consumed by browser apps too, so it can never
 * import a Node builtin directly. These ports are the seam: `Otp`'s own
 * methods depend only on these interfaces; the concrete Node-crypto-backed
 * implementation lives in `apps/functions/src/adapters` (`scope:backend`,
 * Node-only).
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
