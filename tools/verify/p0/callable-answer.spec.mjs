// node --test tools/verify/p0/callable-answer.spec.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CallableAnswer, readCallableAnswer } from './callable-answer.mjs';

const answer = (statusCode, text, complete = true) =>
  readCallableAnswer({ statusCode, text, complete });

describe('readCallableAnswer — a refusal is only ever a well-formed {error}', () => {
  it('reads a 2xx object without an error as the result', () => {
    assert.deepEqual(answer(200, '{"result":{"done":true}}'), {
      callableAnswer: CallableAnswer.Result,
      result: { done: true },
    });
    assert.deepEqual(answer(200, '{"result":null}'), {
      callableAnswer: CallableAnswer.Result,
      result: null,
    });
  });

  it('reads a well-formed {error} as a refusal, on any status', () => {
    // The flipped wire (Phase 4a 4A-4): the message is the errorCode, the
    // details the ecs-core struct projected to its code's allowlist.
    const error = {
      status: 'PERMISSION_DENIED',
      message: 'OPS_BACKFILL_FORBIDDEN',
      details: { errorCode: 'OPS_BACKFILL_FORBIDDEN' },
    };
    for (const status of [400, 403, 500, 200]) {
      assert.deepEqual(answer(status, JSON.stringify({ error })), {
        callableAnswer: CallableAnswer.Refusal,
        error,
      });
    }
  });

  // The round-3 defect: these threw a plain error out of the response
  // handler and failed the whole run instead of resuming it.
  it('reads a cut-off, empty or unparseable body as a LOST answer', () => {
    assert.equal(
      answer(200, '{"result":{"do', false).callableAnswer,
      CallableAnswer.Lost,
    );
    assert.equal(
      answer(200, '{"result":{"do').callableAnswer,
      CallableAnswer.Lost,
    );
    assert.equal(answer(200, '').callableAnswer, CallableAnswer.Lost);
    assert.equal(
      answer(502, '<html>Bad Gateway</html>').callableAnswer,
      CallableAnswer.Lost,
    );
    assert.equal(answer(200, 'null').callableAnswer, CallableAnswer.Lost);
    assert.equal(answer(200, '[1,2]').callableAnswer, CallableAnswer.Lost);
  });

  it('reads a 5xx, or any non-2xx, without an error object as lost', () => {
    assert.equal(answer(500, '{}').callableAnswer, CallableAnswer.Lost);
    assert.equal(
      answer(503, '{"error":"overloaded"}').callableAnswer,
      CallableAnswer.Lost,
    );
    assert.equal(
      answer(404, '{"result":1}').callableAnswer,
      CallableAnswer.Lost,
    );
  });

  it('says why an answer was lost, without the body itself', () => {
    const lost = answer(502, 'upstream reset', true);
    assert.equal(lost.callableAnswer, CallableAnswer.Lost);
    assert.match(lost.why, /HTTP 502/);
    assert.doesNotMatch(lost.why, /upstream reset/);
  });
});
