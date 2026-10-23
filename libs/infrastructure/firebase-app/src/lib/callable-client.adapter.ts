import {
  type Functions,
  FunctionsError,
  httpsCallable,
} from 'firebase/functions';
import { Result } from '@core/primitives';
import { PipelineError, PipelineErrorCode } from '@core/errors';
import { CALLABLE_ANSWER_DECODERS, type GatewayPorts } from '@core/ports';

/**
 * THE WEB'S ONE CALLABLE CLIENT (Phase 4a 4A-4, 4A-5; blueprint §4.2) — the
 * successor of the four duck-typed gateways (booking, waitlist, OTP, streak
 * publish). Logic-free: it dials the server export the `Callables` name
 * spells, then
 *
 * - an answer goes through ITS call component's decoder, looked up in
 *   `CALLABLE_ANSWER_DECODERS` — the only way an answer becomes branded
 *   data (Law 7.4); a decode that fails is `PIPELINE_UNKNOWN`, today's "a
 *   200 with nothing usable in it" (reporting a write that may not have
 *   happened is the one failure worse than reporting none);
 * - a refusal (`FunctionsError`) is `PipelineError.fromWire(code, details)`,
 *   the ONE classification of a failed call;
 * - anything else thrown is `PIPELINE_UNKNOWN`.
 *
 * The request goes on the wire as the call component it is — never a cast,
 * never a field renamed here.
 */
export const callableClientPorts = (functions: Functions): GatewayPorts => ({
  callableClient: (name) => async (input) => {
    try {
      const answer = await httpsCallable(functions, name)(input);
      // eslint-disable-next-line security/detect-object-injection -- `name` is a closed `CallableName` literal and `CALLABLE_ANSWER_DECODERS` is total over it.
      return CALLABLE_ANSWER_DECODERS[name](answer.data);
    } catch (error) {
      return Result.err(
        error instanceof FunctionsError
          ? PipelineError.fromWire(error.code, error.details)
          : PipelineError.bare(PipelineErrorCode.Unknown),
      );
    }
  },
});
