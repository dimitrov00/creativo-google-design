import { Brand } from '@creativo/domain/kernel';

/** A raw OTP code as produced by `Otp.issue()` — branded so it can't be confused with an arbitrary string at a port boundary. */
export type OtpCode = Brand<string, 'OtpCode'>;

export function toOtpCode(raw: string): OtpCode {
  return raw as OtpCode;
}
