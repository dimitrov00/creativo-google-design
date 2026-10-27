import {
  type Functions,
  FunctionsError,
  httpsCallable,
} from 'firebase/functions';
import { ClientOperationId, Result } from '@core/primitives';
import { PipelineError, PipelineErrorCode } from '@core/errors';
import {
  CALLABLE_ANSWER_DECODERS,
  type CallableName,
  type CallableWire,
  type GatewayPorts,
  type IdPorts,
  OPERATION_ID_FIELD,
} from '@core/ports';

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
 * Every failure — a refusal, an answer its decoder refuses, anything thrown
 * — carries the operation id the call went out with (WS-4.5,
 * `PipelineError.withOperation`): the value of its `OPERATION_ID_FIELD`
 * field in the input as sent (`null` for the issue sink and for a call that
 * sent none), the reference the surface prints.
 *
 * The request goes on the wire as the call component it is — never a cast,
 * never a field renamed here. One addition (WS-4.1): a callable whose
 * operation id rides in `operationId` (`OPERATION_ID_FIELD`) and whose input
 * names none gets a TRANSPORT id minted here from the id source, so every
 * call the server reads one from can be traced (an act a store names — the
 * booking verbs — carries its own, re-sent on a retry, and goes untouched;
 * `attemptId` / `requestId` calls and the issue sink are never touched). A
 * mint that fails the key's shape sends none: the callables that read a
 * transport id read it optionally.
 */
export const callableClientPorts = (
  functions: Functions,
  ids: IdPorts,
): GatewayPorts => ({
  callableClient: (name) => async (input) => {
    const sent = withTransportId(name, input, ids);
    try {
      const answer = await httpsCallable(functions, name)(sent);
      // eslint-disable-next-line security/detect-object-injection -- `name` is a closed `CallableName` literal and `CALLABLE_ANSWER_DECODERS` is total over it.
      const decoded = CALLABLE_ANSWER_DECODERS[name](answer.data);
      return decoded.ok
        ? decoded
        : Result.err(
            PipelineError.withOperation(
              decoded.error,
              operationIdOf(name, sent),
            ),
          );
    } catch (error) {
      return Result.err(
        PipelineError.withOperation(
          error instanceof FunctionsError
            ? PipelineError.fromWire(error.code, error.details)
            : PipelineError.bare(PipelineErrorCode.Unknown),
          operationIdOf(name, sent),
        ),
      );
    }
  },
});

/**
 * The operation id a call went out with — its `OPERATION_ID_FIELD` field of
 * the input as sent, when that holds a well-formed key; `null` for a
 * callable that carries none (the issue sink) or a call that sent none.
 */
function operationIdOf<N extends CallableName>(
  name: N,
  sent: CallableWire[N]['input'],
): ClientOperationId | null {
  // eslint-disable-next-line security/detect-object-injection -- `name` is a closed `CallableName` literal and `OPERATION_ID_FIELD` is total over it.
  const field = OPERATION_ID_FIELD[name];
  return field === null ? null : ClientOperationId.inPayload(sent, field);
}

/**
 * The input as it goes on the wire: itself, or — for an `operationId`
 * callable whose input names none — a copy carrying a freshly minted
 * transport `operationId` (a failed mint: itself).
 */
function withTransportId<N extends CallableName>(
  name: N,
  input: CallableWire[N]['input'],
  ids: IdPorts,
): CallableWire[N]['input'] {
  // eslint-disable-next-line security/detect-object-injection -- `name` is a closed `CallableName` literal and `OPERATION_ID_FIELD` is total over it.
  if (OPERATION_ID_FIELD[name] !== 'operationId') return input;
  if (ClientOperationId.inPayload(input, 'operationId') !== null) return input;
  const minted = ClientOperationId.parse(ids.nextId());
  return minted.ok ? { ...input, operationId: minted.value } : input;
}
