import {
  type DurationMinutes,
  IdentifierChannel,
  LogEvent,
  Result,
} from '@core/primitives';
import {
  IdentityError,
  IdentityErrorCode,
  PipelineError,
  PipelineErrorCode,
} from '@core/errors';
import type { ParsedIdentifier } from '@core/components';
import type { Log, OtpDeliveryPorts } from '@core/ports';
import { otpEmailOf } from './otp-email.words';

/**
 * The `OtpDeliveryPorts` bundle of `identity.port.ts` over Postmark's Email
 * API (2026-11-17, `docs/architecture/decisions/2026-11-17-sign-in-email-sender.md`)
 * — the deployed project's LOGIN-OTP sender identity, and nothing else's:
 * its own Postmark server, its own server token (`OTP_POSTMARK_TOKEN`), its
 * own `auth.*` from-address (`OTP_EMAIL_FROM`), on the server's
 * transactional stream. A campaign or reminder sender is another server,
 * another token, another address and another adapter (owner rule).
 *
 * One `POST https://api.postmarkapp.com/email` per code: the code in the
 * subject and the bodies (`otp-email.words.ts`), opens and links
 * untracked. Postmark answers `ErrorCode: 0` on a send (a 2xx whose body
 * cannot be read counts as sent too); every other answer is a refusal,
 * classified by what fixes it:
 *
 * - nobody but the operator — no token or address configured, a token
 *   Postmark refuses (401, `ErrorCode` 10), an account not yet approved
 *   (412: while pending, every recipient must share the from-address's
 *   domain; 413), a missing stream (1235) or a refused `From` (403) →
 *   `IDENTITY_OTP_SEND_UNAVAILABLE`, logged at `error`: a retry can never
 *   succeed, so the sign-in screen offers none;
 * - the person, with another address — an address Postmark refuses (300)
 *   or has marked inactive after a hard bounce or a spam complaint (406)
 *   → `PIPELINE_INVALID_REQUEST`;
 * - time — a rate limit (429), Postmark's own fault (5xx), no answer
 *   within {@link SEND_TIMEOUT_MS} or no network → `PIPELINE_UNAVAILABLE`.
 *
 * Each refusal writes ONE line (`otp.provider_refused`) holding the reason,
 * the HTTP status and Postmark's `ErrorCode` — never the address, the code
 * or the token. An SMS destination is refused as unavailable: this sender
 * carries e-mail only, as the deployment does (`AuthDeployment.DEFAULT`
 * challenges e-mail; the owner ruled out SMS).
 *
 * The token and the address are read at each send — a secret is a runtime
 * value, and only the callable that sends binds them.
 */

/** Postmark's single-message endpoint. */
const POSTMARK_EMAIL_URL = 'https://api.postmarkapp.com/email';

/** The server's default transactional stream — never a broadcast stream. */
const MESSAGE_STREAM = 'outbound';

/** Postmark's tag for these messages, so its activity view can filter them. */
const MESSAGE_TAG = 'sign-in-code';

/**
 * How long a send may take before it is answered as unavailable — well
 * inside the callable's own deadline, so the person hears back instead of
 * waiting on a hung connection.
 */
export const SEND_TIMEOUT_MS = 8_000;

/** Postmark's `ErrorCode` for a message it accepted. */
const POSTMARK_OK = 0;

/** Postmark `ErrorCode`s an operator alone can fix (`ErrorCode` table, API overview). */
const OPERATOR_ERROR_CODES: ReadonlySet<number> = new Set([
  10, // no valid server token
  403, // invalid request field — a `From` with no confirmed signature
  412, // account pending approval: recipients must share the From domain
  413, // account not approved to send
  1235, // the stream does not exist on this server
]);

/** Postmark `ErrorCode`s that refuse the address itself. */
const RECIPIENT_ERROR_CODES: ReadonlySet<number> = new Set([
  300, // send validation — an invalid address
  406, // inactive recipient — a hard bounce, a spam complaint, a suppression
]);

/** Why a send was refused, as the log line names it. */
const RefusalReason = {
  NotConfigured: 'NOT_CONFIGURED',
  Transport: 'TRANSPORT',
  Provider: 'PROVIDER',
} as const;

/** What the sender needs from the composition root. */
export type PostmarkOtpSenderConfig = {
  /** The OTP server's token, read at each send (`OTP_POSTMARK_TOKEN`). */
  readonly serverToken: () => string;
  /** The `auth.*` sending address, «Creativo <codes@auth.…>» (`OTP_EMAIL_FROM`). */
  readonly fromAddress: () => string;
  /** How long a code lasts — the deployment's own OTP policy, so the words never disagree with the check. */
  readonly ttlMinutes: DurationMinutes;
  /** The HTTP client — the runtime's `fetch`; a spec hands its own. */
  readonly post: typeof fetch;
  readonly log: Log;
};

type SendRefusal = PipelineError | IdentityError.OtpSendUnavailable;

/** The `ErrorCode` of Postmark's JSON answer, or `null` when it sent none. */
async function providerErrorCodeOf(response: Response): Promise<number | null> {
  try {
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null) return null;
    const code = (body as { readonly ErrorCode?: unknown }).ErrorCode;
    return typeof code === 'number' ? code : null;
  } catch {
    return null;
  }
}

/** What a refused answer means for the person — the classification above. */
function refusalOf(
  httpStatus: number,
  providerErrorCode: number | null,
): SendRefusal {
  if (
    httpStatus === 401 ||
    (providerErrorCode !== null && OPERATOR_ERROR_CODES.has(providerErrorCode))
  ) {
    return IdentityError.otpSendUnavailable();
  }
  if (
    providerErrorCode !== null &&
    RECIPIENT_ERROR_CODES.has(providerErrorCode)
  ) {
    return PipelineError.bare(PipelineErrorCode.InvalidRequest);
  }
  return PipelineError.bare(PipelineErrorCode.Unavailable);
}

/**
 * The deployed login-OTP sender: one Postmark message per code, from the
 * OTP identity only.
 */
export const postmarkOtpSender = (
  config: PostmarkOtpSenderConfig,
): OtpDeliveryPorts => ({
  sendOtp: async (
    destination: ParsedIdentifier,
    code: string,
  ): Promise<Result<void, SendRefusal>> => {
    if (destination.identifierChannel !== IdentifierChannel.Email) {
      return Result.err(IdentityError.otpSendUnavailable());
    }
    const token = config.serverToken().trim();
    const from = config.fromAddress().trim();
    if (token === '' || from === '') {
      config.log('error', LogEvent.OtpProviderRefused, {
        reason: RefusalReason.NotConfigured,
        httpStatus: null,
        providerErrorCode: null,
      });
      return Result.err(IdentityError.otpSendUnavailable());
    }

    const email = otpEmailOf(code, config.ttlMinutes);
    let response: Response;
    try {
      response = await config.post(POSTMARK_EMAIL_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Postmark-Server-Token': token,
        },
        body: JSON.stringify({
          From: from,
          To: destination.identifier,
          Subject: email.subject,
          TextBody: email.textBody,
          HtmlBody: email.htmlBody,
          Tag: MESSAGE_TAG,
          MessageStream: MESSAGE_STREAM,
          TrackOpens: false,
          TrackLinks: 'None',
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
    } catch {
      config.log('warn', LogEvent.OtpProviderRefused, {
        reason: RefusalReason.Transport,
        httpStatus: null,
        providerErrorCode: null,
      });
      return Result.err(PipelineError.bare(PipelineErrorCode.Unavailable));
    }

    const providerErrorCode = await providerErrorCodeOf(response);
    // A 2xx whose body cannot be read is taken as sent: Postmark accepted
    // the message, and a refusal here would send the person for a second
    // code while the first is on its way (the resend window guards that).
    if (
      response.ok &&
      (providerErrorCode === POSTMARK_OK || providerErrorCode === null)
    ) {
      return Result.ok(undefined);
    }
    const refusal = refusalOf(response.status, providerErrorCode);
    config.log(
      refusal.errorCode === IdentityErrorCode.OtpSendUnavailable
        ? 'error'
        : 'warn',
      LogEvent.OtpProviderRefused,
      {
        reason: RefusalReason.Provider,
        httpStatus: response.status,
        providerErrorCode,
      },
    );
    return Result.err(refusal);
  },
});
