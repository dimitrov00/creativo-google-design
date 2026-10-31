#!/usr/bin/env node
/**
 * The App Check journey (security hardening §2.A.7, S-L-9, S-DEP-14): raw
 * callable posts to the Functions emulator — no auth, the `verify-p0.mjs`
 * request shape — with no App Check header, with the emulator token and
 * with the INVALID token, each answer checked against the mode the
 * emulator runs:
 *
 *   pnpm run verify:appcheck          # builds, writes the env, runs ENFORCE then MONITOR
 *   node tools/verify/app-check/verify-app-check.mjs --expect ENFORCE|MONITOR
 *   node tools/verify/app-check/verify-app-check.mjs --probe ENFORCE|MONITOR
 *
 * Each `--expect` run's FIRST post is the mode probe: a headerless
 * `cancelAppointment` — under ENFORCE refused `FAILED_PRECONDITION` /
 * `APP_CHECK_REQUIRED`, under MONITOR answered by the callable itself (its
 * own unauthenticated refusal). Anything else stops the run at once: an
 * emulator that silently runs another mode (the override missed
 * `.env.local`, S-L-2) proves nothing. `--probe` posts the probe alone —
 * the opening of the ENFORCE runs of `verify:p0`, `e2e:web` and
 * `verify:csp` (plan §6.1 addition 2).
 *
 * The emulator token and the INVALID token come from `emulator-token.mjs`,
 * built at run time. The emulator never reports a replay
 * (`alreadyConsumed` is always false there), so REPLAYED stays unit-proved
 * (`edge.spec.ts`); the consuming `eraseClient` answering under ENFORCE
 * with the token proves the consuming path runs.
 *
 * Emulator-only: refuses to run unless the Functions emulator is on this
 * machine. Prints `pass` / `FAIL` per post; the exit code is 1 when a post
 * failed, 2 on unreadable arguments. The case table and the answer reader
 * are pure and exported for verify-app-check.spec.mjs.
 */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { CallableAnswer, readCallableAnswer } from '../p0/callable-answer.mjs';
import {
  APP_CHECK_HEADER,
  JOURNEY_APP_ID,
  emulatorAppCheckToken,
  invalidAppCheckToken,
} from './emulator-token.mjs';

/** The emulators' project and the callables' region (`verify-p0.mjs`'s). */
const PROJECT_ID = 'demo-creativo-test';
const REGION = 'us-central1';

/** How long one post waits for its answer — every case is answered before any work. */
const POST_TIMEOUT_MS = 60_000;

/** The modes a run can expect — the two the edge distinguishes on a refusal (OFF answers as MONITOR does, untagged). */
export const ExpectedMode = { Enforce: 'ENFORCE', Monitor: 'MONITOR' };

/** Which App Check header a post carries. */
export const TokenSent = {
  None: 'NONE',
  Emulator: 'EMULATOR',
  Invalid: 'INVALID',
};

/** What a post must come back as. */
export const Expected = {
  /** The edge's ENFORCE refusal: `FAILED_PRECONDITION`, `details.errorCode` `APP_CHECK_REQUIRED`. */
  AppCheckRequired: 'APP_CHECK_REQUIRED',
  /** The callable's own refusal of a caller with no auth: `UNAUTHENTICATED`, a code that is not `APP_CHECK_*`. */
  OwnRefusal: 'OWN_REFUSAL',
  /** The callable's result. */
  Answered: 'ANSWERED',
};

/**
 * One issue `reportClientIssues` admits as it is (`ClientIssueSystem.admitBatch`):
 * all twelve keys, a condition kind (logged at `warn`), nothing personal.
 */
export const JOURNEY_ISSUE = {
  clientIssueKind: 'CHUNK_LOAD_FAILED',
  errorName: 'AppCheckJourney',
  documentPath: null,
  fieldName: null,
  routePattern: '/',
  topFrame: null,
  scrubbedMessage: null,
  release: 'verify-app-check',
  occurrences: 1,
  operationId: null,
  callableName: null,
  callableErrorCode: null,
};

/** The payload each called callable gets — no auth rides any post, so the callables refuse before they read it. */
const PAYLOADS = {
  cancelAppointment: {},
  eraseClient: {},
  reportClientIssues: [JOURNEY_ISSUE],
};

/**
 * The case table of plan §2.A.7, per mode, the probe first. `callable` is
 * the export; `tokenSent` the header; `expected` the answer.
 */
export const JOURNEY_CASES = {
  [ExpectedMode.Enforce]: [
    {
      label: 'probe: cancelAppointment (traced, standard), no header',
      callable: 'cancelAppointment',
      tokenSent: TokenSent.None,
      expected: Expected.AppCheckRequired,
    },
    {
      label: 'cancelAppointment, the emulator token',
      callable: 'cancelAppointment',
      tokenSent: TokenSent.Emulator,
      expected: Expected.OwnRefusal,
    },
    {
      label: 'eraseClient (traced, limited-use), no header',
      callable: 'eraseClient',
      tokenSent: TokenSent.None,
      expected: Expected.AppCheckRequired,
    },
    {
      label: 'eraseClient, the emulator token — the consuming path answers',
      callable: 'eraseClient',
      tokenSent: TokenSent.Emulator,
      expected: Expected.OwnRefusal,
    },
    {
      label: 'reportClientIssues (untraced), no header',
      callable: 'reportClientIssues',
      tokenSent: TokenSent.None,
      expected: Expected.AppCheckRequired,
    },
    {
      label: 'reportClientIssues, the emulator token — one valid issue',
      callable: 'reportClientIssues',
      tokenSent: TokenSent.Emulator,
      expected: Expected.Answered,
    },
    {
      label: 'cancelAppointment, the INVALID token',
      callable: 'cancelAppointment',
      tokenSent: TokenSent.Invalid,
      expected: Expected.AppCheckRequired,
    },
  ],
  [ExpectedMode.Monitor]: [
    {
      label: 'probe: cancelAppointment, no header — answered',
      callable: 'cancelAppointment',
      tokenSent: TokenSent.None,
      expected: Expected.OwnRefusal,
    },
    {
      label: 'cancelAppointment, the INVALID token — answered, not refused',
      callable: 'cancelAppointment',
      tokenSent: TokenSent.Invalid,
      expected: Expected.OwnRefusal,
    },
    {
      label: 'reportClientIssues, no header',
      callable: 'reportClientIssues',
      tokenSent: TokenSent.None,
      expected: Expected.Answered,
    },
  ],
};

/** The request headers of a post carrying `tokenSent`. */
export function headersOf(tokenSent) {
  switch (tokenSent) {
    case TokenSent.None:
      return { 'content-type': 'application/json' };
    case TokenSent.Emulator:
      return {
        'content-type': 'application/json',
        [APP_CHECK_HEADER]: emulatorAppCheckToken(JOURNEY_APP_ID),
      };
    case TokenSent.Invalid:
      return {
        'content-type': 'application/json',
        [APP_CHECK_HEADER]: invalidAppCheckToken(),
      };
    default:
      throw new Error(`unknown header choice "${tokenSent}"`);
  }
}

/** The body of a post to `callable` — the callable protocol's `{ data }`. */
export function bodyOf(callable) {
  if (!Object.hasOwn(PAYLOADS, callable)) {
    throw new Error(`no payload for "${callable}"`);
  }
  return JSON.stringify({ data: PAYLOADS[callable] });
}

/** A refusal's canonical status (`FAILED_PRECONDITION`, `UNAUTHENTICATED`, …), or `null`. */
function wireStatusOf(error) {
  const wireStatus = error?.status;
  return typeof wireStatus === 'string' ? wireStatus : null;
}

/** A refusal's `details.errorCode`, or `null`. */
function errorCodeOf(error) {
  const code = error?.details?.errorCode;
  return typeof code === 'string' ? code : null;
}

/** A refusal named the way the run prints it: `STATUS / errorCode`. */
function refusalText(error) {
  return `${wireStatusOf(error) ?? '(no status)'} / ${errorCodeOf(error) ?? '(no errorCode)'}`;
}

/**
 * Whether one answer (as `readCallableAnswer` reads it) is what `expected`
 * asks: `{ passed, detail }`, `detail` naming what came back.
 */
export function judgeAnswer(expected, answer) {
  if (answer.callableAnswer === CallableAnswer.Lost) {
    return { passed: false, detail: `no answer: ${answer.why}` };
  }
  if (answer.callableAnswer === CallableAnswer.Result) {
    return {
      passed: expected === Expected.Answered,
      detail: 'answered with a result',
    };
  }
  const code = errorCodeOf(answer.error);
  const wireStatus = wireStatusOf(answer.error);
  const detail = `refused ${refusalText(answer.error)}`;
  switch (expected) {
    case Expected.AppCheckRequired:
      return {
        passed:
          wireStatus === 'FAILED_PRECONDITION' && code === 'APP_CHECK_REQUIRED',
        detail,
      };
    case Expected.OwnRefusal:
      return {
        passed:
          wireStatus === 'UNAUTHENTICATED' &&
          code !== null &&
          !code.startsWith('APP_CHECK_'),
        detail,
      };
    case Expected.Answered:
      return { passed: false, detail };
    default:
      throw new Error(`unknown expectation "${expected}"`);
  }
}

/**
 * The run the command line asks for: `{ run: 'expect' | 'probe', mode }`.
 * Throws on anything else (exactly one of `--expect` / `--probe`, a mode
 * of {@link ExpectedMode}).
 */
export function optionsOf(args) {
  const { values } = parseArgs({
    args,
    options: {
      expect: { type: 'string' },
      probe: { type: 'string' },
    },
    strict: true,
  });
  const given = ['expect', 'probe'].filter(
    (name) => values[name] !== undefined,
  );
  if (given.length !== 1) {
    throw new Error('pass exactly one of --expect <MODE> and --probe <MODE>');
  }
  const run = given[0];
  const mode = values[run];
  if (!Object.values(ExpectedMode).includes(mode)) {
    throw new Error(
      `--${run} must be one of ${Object.values(ExpectedMode).join(', ')} (got "${mode}")`,
    );
  }
  return { run, mode };
}

/** The posts of one run: the whole table, or its probe alone. */
export function casesOf({ run, mode }) {
  const cases = JOURNEY_CASES[mode];
  return run === 'probe' ? cases.slice(0, 1) : cases;
}

const USAGE =
  'usage: node tools/verify/app-check/verify-app-check.mjs --expect ENFORCE|MONITOR | --probe ENFORCE|MONITOR';

/** One raw post to the Functions emulator, read as `readCallableAnswer` reads it — never rejects. */
async function post(functionsHost, entry) {
  try {
    const response = await fetch(
      `http://${functionsHost}/${PROJECT_ID}/${REGION}/${entry.callable}`,
      {
        method: 'POST',
        headers: headersOf(entry.tokenSent),
        body: bodyOf(entry.callable),
        signal: AbortSignal.timeout(POST_TIMEOUT_MS),
      },
    );
    return readCallableAnswer({
      statusCode: response.status,
      complete: true,
      text: await response.text(),
    });
  } catch (error) {
    return { callableAnswer: CallableAnswer.Lost, why: error.message };
  }
}

async function main() {
  let options;
  try {
    options = optionsOf(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}\n${USAGE}`);
    return 2;
  }
  // `emulators:exec` may hand over the 0.0.0.0 bind address; connect locally.
  const functionsHost = (
    process.env.FUNCTIONS_EMULATOR_HOST ?? '127.0.0.1:5001'
  ).replace('0.0.0.0', '127.0.0.1');
  if (!functionsHost.includes('127.0.0.1')) {
    console.error('Refusing to run outside the local emulators.');
    return 1;
  }
  console.log(
    `App Check journey — ${options.run === 'probe' ? 'probe' : 'expect'} ${options.mode}, ${functionsHost}`,
  );
  let failed = 0;
  for (const [index, entry] of casesOf(options).entries()) {
    const { passed, detail } = judgeAnswer(
      entry.expected,
      await post(functionsHost, entry),
    );
    console.log(`${passed ? 'pass' : 'FAIL'}  ${entry.label}\n      ${detail}`);
    if (passed) continue;
    failed += 1;
    if (index === 0) {
      console.error(
        `FAIL  the emulator does not run ${options.mode} — the probe decides the run; nothing else was posted`,
      );
      return 1;
    }
  }
  return failed === 0 ? 0 : 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  process.exitCode = await main();
}
