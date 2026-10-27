import { Result } from '@core/primitives';
import { type PipelineError } from '@core/errors';
import { OtpDestinationType, ParsedIdentifier } from '@core/components';
import type { Log, OtpDeliveryPorts } from '@core/ports';

/**
 * The `OtpDeliveryPorts` bundle of `identity.port.ts` — the LOGIN-OTP
 * sender identity. It delivers sign-in codes and nothing else: a campaign or
 * marketing sender is a different identity on a different adapter, never
 * this one (product decision; swap this file for a transactional provider
 * such as Postmark or Twilio sending from a dedicated `auth.*` identity).
 *
 * Written through the `Log` port, the line the pre-flip console sender
 * printed, word for word — `[otp] would send <sms|email> OTP to
 * <destination>: <code>` — at `info`, and the send always succeeds. The
 * channel word is the stored lowercase `destinationType` text of the parsed
 * destination's channel.
 */

/**
 * The channel word of today's log line — the lowercase stored
 * `destinationType` text of each `OtpDestinationType` tag (flatten-spec
 * §8.9: one table per dictionary in the shim), so the line stays byte for
 * byte what it was while the tag is SCREAMING.
 */
const LEGACY_OTP_DESTINATION_TYPE = {
  [OtpDestinationType.Email]: 'email',
  [OtpDestinationType.Sms]: 'sms',
} as const;

/**
 * The emulator's login-OTP sender: the code goes to the log, never to the
 * person, and the send always succeeds.
 *
 * @emulatorOnly The production preflight's P7 refuses a functions deploy
 * that uses this outside the composition root's `onEmulator()`.
 */
export const consoleOtpSender = (log: Log): OtpDeliveryPorts => ({
  sendOtp: async (
    destination: ParsedIdentifier,
    code: string,
  ): Promise<Result<void, PipelineError>> => {
    const channel =
      LEGACY_OTP_DESTINATION_TYPE[
        ParsedIdentifier.destinationTypeOf(destination)
      ];
    // eslint-disable-next-line creativo/no-literal-log-message -- emulator-only QA line, WS-0 keeps it word for word
    log(
      'info',
      `[otp] would send ${channel} OTP to ${destination.identifier}: ${code}`,
    );
    return Result.ok(undefined);
  },
});
