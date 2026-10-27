import { Result } from '@core/primitives';
import { IdentityError } from '@core/errors';
import type { OtpDeliveryPorts } from '@core/ports';

/**
 * The `OtpDeliveryPorts` bundle of `identity.port.ts` — the deployed
 * project's login-OTP sender until a transactional provider lands
 * (audit-hardening WS-0). It delivers nothing and refuses every delivery,
 * on either channel, with `IDENTITY_OTP_SEND_UNAVAILABLE`
 * (`failed-precondition` at the edge): a retry can never succeed, so the
 * web words it without offering one. It takes no `Log` and writes nothing
 * — neither the destination nor the code ever reaches a log line.
 *
 * The composition root binds it in the deployed branch of
 * `onEmulator() ? consoleOtpSender(…) : refusingOtpSender()`; the emulator
 * keeps the console sender.
 *
 * @launchBlocker While any use of it remains in the functions source, the
 * production preflight's P8 refuses the functions deploy: a deployed project
 * would refuse every sign-in. Replace it with the real sender
 * (docs/production-deploy.md §1, "Sign-in: the OTP sender").
 */
export const refusingOtpSender = (): OtpDeliveryPorts => ({
  sendOtp: async () => Result.err(IdentityError.otpSendUnavailable()),
});
