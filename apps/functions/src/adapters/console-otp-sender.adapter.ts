import {
  type Log,
  ParsedIdentifier,
  type PipelineError,
  Result,
  type SendOtp,
} from '@creativo/ecs-core';

/**
 * The `SendOtp` port of `identity.port.ts` — the LOGIN-OTP sender identity.
 * It delivers sign-in codes and nothing else: a campaign or marketing sender
 * is a different identity on a different adapter, never this one (product
 * decision; swap this file for a transactional provider such as Postmark or
 * Twilio sending from a dedicated `auth.*` identity).
 *
 * Today's `ConsoleLogOtpSender` (`console-otp-sender.ts`), written through
 * the `Log` port: the same line, word for word —
 * `[otp] would send <sms|email> OTP to <destination>: <code>` — at `info`,
 * and the send always succeeds. The channel word is the stored
 * `destinationType` tag of the parsed destination's `kind`.
 */
export const consoleOtpSender =
  (log: Log): SendOtp =>
  async (
    destination: ParsedIdentifier,
    code: string,
  ): Promise<Result<void, PipelineError>> => {
    const channel = ParsedIdentifier.destinationTypeOf(destination);
    log(
      'info',
      `[otp] would send ${channel} OTP to ${destination.value}: ${code}`,
    );
    return Result.ok(undefined);
  };
