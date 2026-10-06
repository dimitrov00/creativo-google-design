/**
 * What one callable response over the Functions wire protocol amounts to —
 * the pure half of `verify-p0.mjs`'s `callable`, so it can be proved without
 * an emulator (`node --test tools/verify/p0/callable-answer.spec.mjs`).
 *
 * Three answers, and only three:
 *
 * - `result` — a 2xx whose body is a JSON object with no `error`: the
 *   callable answered, and `result` is what it said.
 * - `refusal` — a body that is a JSON object carrying an `error` OBJECT, on
 *   any status: the callable (or the emulator's protocol layer) refused on
 *   purpose, and calling again will be refused again. The one kind of
 *   failure a run must not shrug off.
 * - `lost` — anything else: a body cut off mid-flight (the response never
 *   completed), an empty or unparseable body, a JSON body that is not an
 *   object, a 5xx with no `error` object — an answer that never properly
 *   arrived. The server may well have done the work, so a runner resumes
 *   (for `runBackfill`, from its progress document) instead of failing the
 *   whole run on it.
 *
 * `complete` is `IncomingMessage.complete` at `end`: false when the
 * connection closed before the whole message arrived.
 */
export function readCallableAnswer({ statusCode, complete, text }) {
  const status = Number(statusCode ?? 0);
  if (complete === false) {
    return { kind: 'lost', why: `a cut-off answer (HTTP ${status})` };
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return {
      kind: 'lost',
      why: `an unreadable answer (HTTP ${status}, ${text.length} bytes)`,
    };
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return {
      kind: 'lost',
      why: `an answer that is not an object (HTTP ${status})`,
    };
  }
  const refusal = body.error;
  if (refusal !== null && typeof refusal === 'object') {
    return { kind: 'refusal', error: refusal };
  }
  if (refusal === undefined && status >= 200 && status < 300) {
    return { kind: 'result', result: body.result };
  }
  return { kind: 'lost', why: `no answer in HTTP ${status}` };
}
