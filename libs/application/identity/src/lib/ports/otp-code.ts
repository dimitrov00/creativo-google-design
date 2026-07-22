import { Brand } from '@creativo/domain/kernel';

/**
 * A raw OTP code as produced by `Otp.issue()` — branded so it can't be
 * confused with an arbitrary string at a port boundary. Named distinctly
 * from `@creativo/domain/identity`'s `OtpCode` VO (the client-facing,
 * user-typed-and-validated code) — this one is the backend's own
 * generate-then-send value and the two are never interchangeable, but
 * `libs/application/identity`'s barrel re-exports both (blueprint §1.2
 * facade), so a name collision would otherwise be unavoidable.
 */
export type RawOtpCode = Brand<string, 'RawOtpCode'>;

export function toRawOtpCode(raw: string): RawOtpCode {
  return raw as RawOtpCode;
}
