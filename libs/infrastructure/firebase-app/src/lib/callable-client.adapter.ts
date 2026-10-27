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
  Callables,
  type CallableWire,
  type ClientIssuePorts,
  type GatewayPorts,
  type IdPorts,
  OPERATION_ID_FIELD,
} from '@core/ports';
import { ClientIssueSystem } from '@core/systems';

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
 * - anything else thrown is `PIPELINE_UNKNOWN`;
 * - a call the SDK failed ITSELF — it got no answer the server wrote: a
 *   fetch that failed (a network that dropped, a backend that crashed
 *   without a CORS header — status 0), a body with no JSON or no data (a
 *   platform 5xx page), its own 70 s timeout — and any throw that is no
 *   `FunctionsError` is reported ONCE to the client issue sink as
 *   `CALLABLE_TRANSPORT_FAILED` (`ClientIssueSystem.composeTransport`: the
 *   callable, the thrown value's name and `code` — `FirebaseError` /
 *   `functions/internal`, `functions/deadline-exceeded` for the SDK's own —
 *   the operation id; never its message or stack), so such a call still
 *   reaches Cloud Logging (audit-hardening WS-5; review round 2: the SDK
 *   answers all of those as a `FunctionsError`, so `isSdkTransportFailure`
 *   tells its own wording from a server refusal's). The report never changes
 *   the answer and never rejects; the sink's own call is never reported (it
 *   would report itself).
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
  issues: ClientIssuePorts,
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
      const operationId = operationIdOf(name, sent);
      if (error instanceof FunctionsError) {
        if (isSdkTransportFailure(error)) {
          reportTransportFailure(issues, name, error, operationId);
        }
        return Result.err(
          PipelineError.withOperation(
            PipelineError.fromWire(error.code, error.details),
            operationId,
          ),
        );
      }
      reportTransportFailure(issues, name, error, operationId);
      return Result.err(
        PipelineError.withOperation(
          PipelineError.bare(PipelineErrorCode.Unknown),
          operationId,
        ),
      );
    }
  },
});

/** The two texts the SDK words a body it cannot read with (`firebase/functions`, `call()`). */
const SDK_FIXED_TEXTS: ReadonlySet<string> = new Set([
  'Response is not valid JSON object.',
  'Response is missing data field.',
]);

/**
 * Whether the SDK made this `FunctionsError` itself — no answer the server
 * wrote (review round 2): a fetch that failed (status 0) or a body with no
 * error JSON (a platform 5xx page) is worded with the bare lowercase code
 * (`internal`, `unavailable`), its timeout `deadline-exceeded`, a body it
 * cannot read one of its two fixed texts — and never with details. This
 * edge's refusals always carry the SCREAMING `errorCode` and its details, or
 * the platform's uppercase `INTERNAL` / `RESOURCE_EXHAUSTED`.
 */
function isSdkTransportFailure(error: FunctionsError): boolean {
  const bare = error.code.replace(/^functions\//, '');
  return (
    error.details === undefined &&
    (error.message === bare || SDK_FIXED_TEXTS.has(error.message))
  );
}

/**
 * A call that never answered as a callable, handed to the issue sink once:
 * its name, the thrown value's `name` and string `code` (when it is an
 * object that has them), the operation id it went out with. Never the
 * sink's own call (`reportClientIssues` — a sink that reports its own
 * failure feeds itself), and never a throw out of here: a report that
 * fails is dropped, and the answer stays what it was (`fromWire`'s for the
 * SDK's own `FunctionsError`, `PIPELINE_UNKNOWN` for any other throw).
 */
function reportTransportFailure(
  issues: ClientIssuePorts,
  name: CallableName,
  error: unknown,
  operationId: ClientOperationId | null,
): void {
  if (name === Callables.ReportClientIssues) return;
  try {
    issues.reportClientIssues([
      ClientIssueSystem.composeTransport({
        callableName: name,
        errorName: stringProperty(error, 'name'),
        callableErrorCode: stringProperty(error, 'code'),
        operationId,
        release: null,
      }),
    ]);
  } catch {
    // A report never changes the answer: a sink that throws is dropped here.
  }
}

/** `value[key]` when `value` is an object holding a string there (own or inherited, as an `Error`'s `name`), else `null`. */
function stringProperty(value: unknown, key: 'name' | 'code'): string | null {
  if (typeof value !== 'object' || value === null) return null;
  // eslint-disable-next-line security/detect-object-injection -- `key` is one of two literal property names.
  const held: unknown = (value as Readonly<Record<string, unknown>>)[key];
  return typeof held === 'string' ? held : null;
}

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
