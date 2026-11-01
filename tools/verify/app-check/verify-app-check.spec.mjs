// node --test tools/verify/app-check/verify-app-check.spec.mjs
//
// The App Check journey's pure half (security hardening §2.A.7): the case
// table of both modes, the probe that opens each run, the headers and
// bodies of the posts, and the reader that judges an answer by its status
// and `details.errorCode`. The posts themselves need the emulators and run
// as `pnpm run verify:appcheck` (the orchestrator's, never a spec's).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CallableAnswer, readCallableAnswer } from '../p0/callable-answer.mjs';
import {
  APP_CHECK_HEADER,
  JOURNEY_APP_ID,
  emulatorAppCheckToken,
  invalidAppCheckToken,
} from './emulator-token.mjs';
import {
  Expected,
  ExpectedMode,
  JOURNEY_CASES,
  JOURNEY_ISSUE,
  TokenSent,
  bodyOf,
  casesOf,
  headersOf,
  judgeAnswer,
  optionsOf,
} from './verify-app-check.mjs';

/** A table row as `[callable, tokenSent, expected]`. */
const shape = (entry) => [entry.callable, entry.tokenSent, entry.expected];

/** What the emulator answers, read through the P0 reader. */
const refusal = (statusCode, status, errorCode) =>
  readCallableAnswer({
    statusCode,
    complete: true,
    text: JSON.stringify({
      error: {
        message: errorCode ?? status,
        status,
        ...(errorCode === undefined ? {} : { details: { errorCode } }),
      },
    }),
  });
const RESULT = readCallableAnswer({
  statusCode: 200,
  complete: true,
  text: JSON.stringify({ result: null }),
});
const LOST = readCallableAnswer({
  statusCode: 500,
  complete: true,
  text: 'Internal Server Error',
});
const REQUIRED = refusal(400, 'FAILED_PRECONDITION', 'APP_CHECK_REQUIRED');
const REPLAYED = refusal(400, 'FAILED_PRECONDITION', 'APP_CHECK_REPLAYED');
const OWN = refusal(401, 'UNAUTHENTICATED', 'CANCELLATION_UNAUTHENTICATED');
/** The platform's own bare refusal (its enforcement option, never set) — no errorCode. */
const BARE = refusal(401, 'UNAUTHENTICATED');

describe('the App Check journey — the case table', () => {
  it('posts the ENFORCE rows of §2.A.7: each callable kind headerless and with the token, and the INVALID token', () => {
    assert.deepEqual(JOURNEY_CASES[ExpectedMode.Enforce].map(shape), [
      ['cancelAppointment', TokenSent.None, Expected.AppCheckRequired],
      ['cancelAppointment', TokenSent.Emulator, Expected.OwnRefusal],
      ['eraseClient', TokenSent.None, Expected.AppCheckRequired],
      ['eraseClient', TokenSent.Emulator, Expected.OwnRefusal],
      ['reportClientIssues', TokenSent.None, Expected.AppCheckRequired],
      ['reportClientIssues', TokenSent.Emulator, Expected.Answered],
      ['cancelAppointment', TokenSent.Invalid, Expected.AppCheckRequired],
    ]);
  });

  it('posts the MONITOR rows: nothing refused for its App Check, the INVALID token answered', () => {
    assert.deepEqual(JOURNEY_CASES[ExpectedMode.Monitor].map(shape), [
      ['cancelAppointment', TokenSent.None, Expected.OwnRefusal],
      ['cancelAppointment', TokenSent.Invalid, Expected.OwnRefusal],
      ['reportClientIssues', TokenSent.None, Expected.Answered],
    ]);
    for (const entry of JOURNEY_CASES[ExpectedMode.Monitor]) {
      assert.notEqual(entry.expected, Expected.AppCheckRequired, entry.label);
    }
  });

  it('opens every run with the probe — a headerless cancelAppointment — and posts it alone for --probe', () => {
    for (const mode of Object.values(ExpectedMode)) {
      const [probe] = JOURNEY_CASES[mode];
      assert.equal(probe.callable, 'cancelAppointment');
      assert.equal(probe.tokenSent, TokenSent.None);
      assert.match(probe.label, /^probe: /);
      assert.deepEqual(casesOf({ run: 'probe', mode }), [probe]);
      assert.deepEqual(casesOf({ run: 'expect', mode }), JOURNEY_CASES[mode]);
    }
    assert.equal(
      JOURNEY_CASES[ExpectedMode.Enforce][0].expected,
      Expected.AppCheckRequired,
    );
    assert.equal(
      JOURNEY_CASES[ExpectedMode.Monitor][0].expected,
      Expected.OwnRefusal,
    );
  });
});

describe('the App Check journey — the posts', () => {
  it('sends no App Check header, the emulator token or the INVALID token, as the row says', () => {
    assert.deepEqual(headersOf(TokenSent.None), {
      'content-type': 'application/json',
    });
    assert.deepEqual(headersOf(TokenSent.Emulator), {
      'content-type': 'application/json',
      [APP_CHECK_HEADER]: emulatorAppCheckToken(JOURNEY_APP_ID),
    });
    assert.deepEqual(headersOf(TokenSent.Invalid), {
      'content-type': 'application/json',
      [APP_CHECK_HEADER]: invalidAppCheckToken(),
    });
    assert.throws(() => headersOf('DEBUG'), /unknown header choice/);
  });

  it('sends no auth and the callable protocol’s { data }: one admissible issue to the sink, nothing else elsewhere', () => {
    for (const entry of Object.values(JOURNEY_CASES).flat()) {
      assert.equal(
        Object.keys(headersOf(entry.tokenSent)).some(
          (name) => name.toLowerCase() === 'authorization',
        ),
        false,
      );
    }
    assert.deepEqual(JSON.parse(bodyOf('cancelAppointment')), { data: {} });
    assert.deepEqual(JSON.parse(bodyOf('eraseClient')), { data: {} });
    assert.deepEqual(JSON.parse(bodyOf('reportClientIssues')), {
      data: [JOURNEY_ISSUE],
    });
    assert.throws(() => bodyOf('commitBooking'), /no payload/);
  });

  it('builds the sink’s issue with exactly the twelve keys of the struct, nothing personal', () => {
    assert.deepEqual(Object.keys(JOURNEY_ISSUE), [
      'clientIssueKind',
      'errorName',
      'documentPath',
      'fieldName',
      'routePattern',
      'topFrame',
      'scrubbedMessage',
      'release',
      'occurrences',
      'operationId',
      'callableName',
      'callableErrorCode',
    ]);
    assert.equal(JOURNEY_ISSUE.scrubbedMessage, null);
    assert.equal(JOURNEY_ISSUE.documentPath, null);
  });
});

describe('the App Check journey — the answer reader', () => {
  it('passes APP_CHECK_REQUIRED only on FAILED_PRECONDITION with that errorCode', () => {
    assert.equal(judgeAnswer(Expected.AppCheckRequired, REQUIRED).passed, true);
    for (const answer of [REPLAYED, OWN, BARE, RESULT, LOST]) {
      assert.equal(
        judgeAnswer(Expected.AppCheckRequired, answer).passed,
        false,
      );
    }
    assert.equal(
      judgeAnswer(
        Expected.AppCheckRequired,
        refusal(401, 'UNAUTHENTICATED', 'APP_CHECK_REQUIRED'),
      ).passed,
      false,
    );
  });

  it('passes the callable’s own refusal only on UNAUTHENTICATED with a code that is not APP_CHECK_* — never the platform’s bare refusal', () => {
    assert.equal(judgeAnswer(Expected.OwnRefusal, OWN).passed, true);
    assert.equal(
      judgeAnswer(
        Expected.OwnRefusal,
        refusal(401, 'UNAUTHENTICATED', 'PRIVACY_UNAUTHENTICATED'),
      ).passed,
      true,
    );
    for (const answer of [REQUIRED, REPLAYED, BARE, RESULT, LOST]) {
      assert.equal(judgeAnswer(Expected.OwnRefusal, answer).passed, false);
    }
  });

  it('passes an answer only on a result', () => {
    assert.equal(judgeAnswer(Expected.Answered, RESULT).passed, true);
    for (const answer of [REQUIRED, OWN, BARE, LOST]) {
      assert.equal(judgeAnswer(Expected.Answered, answer).passed, false);
    }
  });

  it('names what came back: the status and the errorCode, or why nothing did', () => {
    assert.equal(
      judgeAnswer(Expected.OwnRefusal, REQUIRED).detail,
      'refused FAILED_PRECONDITION / APP_CHECK_REQUIRED',
    );
    assert.equal(
      judgeAnswer(Expected.OwnRefusal, BARE).detail,
      'refused UNAUTHENTICATED / (no errorCode)',
    );
    assert.equal(
      judgeAnswer(Expected.AppCheckRequired, RESULT).detail,
      'answered with a result',
    );
    assert.equal(LOST.callableAnswer, CallableAnswer.Lost);
    assert.match(
      judgeAnswer(Expected.Answered, LOST).detail,
      /^no answer: no answer in HTTP 500|^no answer: an unreadable answer/,
    );
    assert.throws(() => judgeAnswer('MAYBE', OWN), /unknown expectation/);
  });
});

describe('the App Check journey — the command line', () => {
  it('reads --expect or --probe and one of the two modes', () => {
    assert.deepEqual(optionsOf(['--expect', 'ENFORCE']), {
      run: 'expect',
      mode: 'ENFORCE',
    });
    assert.deepEqual(optionsOf(['--probe', 'MONITOR']), {
      run: 'probe',
      mode: 'MONITOR',
    });
  });

  it('refuses neither, both, an unknown mode and an unknown option', () => {
    assert.throws(() => optionsOf([]), /exactly one of/);
    assert.throws(
      () => optionsOf(['--expect', 'ENFORCE', '--probe', 'ENFORCE']),
      /exactly one of/,
    );
    assert.throws(() => optionsOf(['--expect', 'OFF']), /must be one of/);
    assert.throws(() => optionsOf(['--expect', 'enforce']), /must be one of/);
    assert.throws(() => optionsOf(['--force']));
  });
});
