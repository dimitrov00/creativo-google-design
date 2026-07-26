import { NodeOtpCrypto } from './node-otp-crypto';

/**
 * Emulator-only stand-in for `NodeOtpCrypto` that pins every generated
 * code to `123456` so manual QA never has to fish codes out of logs.
 * Salting/hashing/verification stay the REAL scrypt implementation — only
 * generation is faked, so the request→hash→verify pipeline exercises the
 * same code paths as production.
 *
 * Wired exclusively behind the `FUNCTIONS_EMULATOR` gate in
 * `lib/otp/request-otp.ts` (the same gate that scopes `devCode`), so a
 * deployed environment can never construct it. When a real SMTP relay is
 * chosen, only the `OtpSender` adapter changes — this class is orthogonal
 * to delivery and simply stops mattering once codes arrive by email.
 */
export class FixedCodeOtpCrypto extends NodeOtpCrypto {
  static readonly FIXED_CODE = '123456';

  override generateCode(): string {
    return FixedCodeOtpCrypto.FIXED_CODE;
  }
}
