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
 *   `errors.IDENTITY_CALL_FAILED` — with no parameters (the wire's
 *   `serverParams` never reach these lines, as before; unlike
 *   `wordPipelineError`, no reason one level down is tried);
 * - every other refusal words as itself, `errors.<errorCode>` with its own
 *   fields as the parameters ({@link translateCodedError}).
 */
export function wordFlowFailure(
  transloco: TranslocoService,
  failure: OnboardingFailure,
): string {
  if (PipelineError.isPipelineError(failure)) {
    return translateCodedError(transloco, {
      errorCode: failure.serverErrorCode ?? IdentityErrorCode.CallFailed,
    });
  }
  return translateCodedError(transloco, failure);
}
