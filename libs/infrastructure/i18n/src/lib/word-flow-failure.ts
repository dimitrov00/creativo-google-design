import type { TranslocoService } from '@jsverse/transloco';
import {
  IdentityErrorCode,
  type OnboardingFailure,
  PipelineError,
} from '@core/errors';
import { translateCodedError } from './translate-coded-error';

/**
 * The words of a refusal the identity flows show (pass D §2.11, E-11) — the
 * auth flow's `AuthFailure` and the onboarding flow's `OnboardingFailure`
 * (with the session's missing identifier), held as structs on the flow
 * states. ONE rule, shared by `/auth` and `/onboarding` (the rule each spelled
 * on its own before: the auth store's `messageOf`, the onboarding store's
 * registration branch):
 *
 * - a failed call (`PipelineError`) words as the server's own code, else the
 *   surfaces' own generic copy — `errors.<serverErrorCode>`, else
 *   `errors.IDENTITY_CALL_FAILED` — with no parameters but one: a throttled
 *   code request's allowlisted `retryAfterSeconds`, the seconds its copy
 *   names (OR-9); no other `serverParams` reach these lines, and unlike
 *   `wordPipelineError`, no reason one level down is tried;
 * - every other refusal words as itself, `errors.<errorCode>` with its own
 *   fields as the parameters ({@link translateCodedError}).
 */
export function wordFlowFailure(
  transloco: TranslocoService,
  failure: OnboardingFailure,
): string {
  if (PipelineError.isPipelineError(failure)) {
    const errorCode = failure.serverErrorCode ?? IdentityErrorCode.CallFailed;
    // A throttled send names the seconds left (OR-9): the copy's one
    // parameter, from the refusal's allowlisted `retryAfterSeconds`.
    return errorCode === IdentityErrorCode.OtpRateLimited
      ? translateCodedError(transloco, {
          errorCode,
          retryAfterSeconds: failure.serverParams['retryAfterSeconds'] ?? null,
        })
      : translateCodedError(transloco, { errorCode });
  }
  return translateCodedError(transloco, failure);
}
