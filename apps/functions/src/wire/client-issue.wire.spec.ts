import { type ClientIssue, ClientIssueKind } from '@core/components';
import {
  ClientIssueBatchRefusedReason,
  ClientIssueError,
  ClientIssueErrorCode,
} from '@core/errors';
import { ClientOperationId, type Result } from '@core/primitives';
import { ClientIssueSystem } from '@core/systems';
import { recordingTelemetry, unwrapOk } from '@core/testing';
import { type EdgeError, toHttpsError } from '../edge';
import {
  CLIENT_ISSUE_RATE,
  decodeReportClientIssues,
  REPORT_CLIENT_ISSUES_TIMEOUT_SECONDS,
} from './client-issue.wire';
import type { WireRequest } from './wire-read';

/*
 * The `reportClientIssues` callable's wire (OR-34): the payload IS the
 * batch, admitted whole by `ClientIssueSystem.admitBatch` or refused whole;
 * the reporter is read off the VERIFIED token — its known roles and whether
 * it carried one — never off the payload and never as the uid; a refused
 * batch is logged once, where it is refused, and leaves as its code alone.
 */

const request = (
  data: unknown,
  auth: { readonly uid: string; readonly roles: readonly unknown[] } | null,
): WireRequest => ({
  data,
  ...(auth === null
    ? {}
    : { auth: { uid: auth.uid, token: { roles: auth.roles } } }),
});

const STAFF = { uid: 'u-staff', roles: ['barber'] } as const;
/** A signed-in client — or the anonymous session `/book` runs on — holds no role. */
const CLIENT = { uid: 'u-client', roles: [] } as const;

/** An issue as the device composes it — always one the callable admits. */
function issue(
  clientIssueKind: ClientIssueKind,
  message: string | null,
): ClientIssue {
  return ClientIssueSystem.compose({
    clientIssueKind,
    errorName: 'TypeError',
    documentPath: null,
    fieldName: null,
    routePattern: '/staff/schedule',
    topFrame: null,
    message,
    release: '2026.10.26',
  });
}

const BATCH: readonly ClientIssue[] = [
  issue(ClientIssueKind.UncaughtError, 'Cannot read properties of null'),
  issue(ClientIssueKind.ChunkLoadFailed, null),
];

function wire(result: Result<unknown, EdgeError>) {
  if (result.ok) throw new Error('expected a refusal');
  const thrown = toHttpsError(result.error);
  return { code: thrown.code, details: thrown.details };
}

describe('reportClientIssues — the wire', () => {
  it('admits the batch as it came — the same array, zero mapping — beside the reporter the token names', () => {
    const { log, lines } = recordingTelemetry();
    const decoded = decodeReportClientIssues(request(BATCH, STAFF), log);
    expect(decoded).toEqual({
      ok: true,
      value: { reporterRoles: ['barber'], reporterAuthed: true, issues: BATCH },
    });
    if (decoded.ok) expect(decoded.value.issues).toBe(BATCH);
    expect(lines).toEqual([]);
  });

  // WS-5 (RU-30): the three new keys are optional on the wire, so a batch
  // from a web shell opened before the deploy (nine keys an issue) still
  // lands — each absent key read as null — and a transport failure's
  // callable, code and operation id come through as sent.
  it('admits an old web’s nine-key batch, each absent WS-5 key null, and a transport failure as sent', () => {
    const { log, lines } = recordingTelemetry();
    const ws5 = new Set(['operationId', 'callableName', 'callableErrorCode']);
    const oldShell = BATCH.map((one) =>
      Object.fromEntries(Object.entries(one).filter(([key]) => !ws5.has(key))),
    );
    const decoded = decodeReportClientIssues(request(oldShell, CLIENT), log);
    expect(decoded).toEqual({
      ok: true,
      value: { reporterRoles: [], reporterAuthed: true, issues: BATCH },
    });

    const transport = [
      ClientIssueSystem.composeTransport({
        callableName: 'commitBooking',
        errorName: 'TypeError',
        callableErrorCode: 'functions/internal',
        operationId: unwrapOk(
          ClientOperationId.parse('attempt-0123456789abcdef'),
        ),
        release: '2026.10.26',
      }),
    ];
    const admitted = decodeReportClientIssues(request(transport, STAFF), log);
    if (!admitted.ok) throw new Error('expected an admitted batch');
    expect(admitted.value.issues).toBe(transport);
    expect(admitted.value.issues[0]).toMatchObject({
      clientIssueKind: ClientIssueKind.CallableTransportFailed,
      operationId: 'attempt-0123456789abcdef',
      callableName: 'commitBooking',
      callableErrorCode: 'functions/internal',
    });
    expect(lines).toEqual([]);
  });

  it('reads the reporter by role and session alone — never the uid, a role nobody mints dropped', () => {
    const { log } = recordingTelemetry();
    const reporterOf = (auth: Parameters<typeof request>[1]) => {
      const decoded = decodeReportClientIssues(request(BATCH, auth), log);
      if (!decoded.ok) throw new Error('expected an admitted batch');
      return decoded.value;
    };
    expect(reporterOf(null)).toMatchObject({
      reporterRoles: [],
      reporterAuthed: false,
    });
    expect(reporterOf(CLIENT)).toMatchObject({
      reporterRoles: [],
      reporterAuthed: true,
    });
    expect(
      reporterOf({ uid: 'u-x', roles: ['admin', 'root', ['barber']] }),
    ).toMatchObject({ reporterRoles: ['admin'], reporterAuthed: true });
    expect(JSON.stringify(reporterOf(STAFF))).not.toContain('u-staff');
  });

  it('refuses a payload that is no admitted batch — its code alone on the wire, its reason, issue and field in ONE warn line beside the reporter', () => {
    const tooMany = Array.from(
      { length: ClientIssueSystem.MAX_ISSUES + 1 },
      () => issue(ClientIssueKind.UncaughtError, null),
    );
    const unscrubbed = [
      BATCH[0],
      {
        ...issue(ClientIssueKind.UncaughtError, null),
        scrubbedMessage: 'mail ana@example.com',
      },
    ];
    // The reporter is the token's to name: a payload that tries is refused.
    const forged = [{ ...BATCH[0], reporterRoles: ['admin'] }];
    const cases = [
      [{ issues: BATCH }, ClientIssueBatchRefusedReason.Shape, null, null],
      [[], ClientIssueBatchRefusedReason.Shape, null, null],
      [null, ClientIssueBatchRefusedReason.Shape, null, null],
      [tooMany, ClientIssueBatchRefusedReason.TooMany, null, null],
      [unscrubbed, ClientIssueBatchRefusedReason.Shape, 1, 'scrubbedMessage'],
      [forged, ClientIssueBatchRefusedReason.Shape, 0, null],
    ] as const;
    for (const [data, reason, issueIndex, issueField] of cases) {
      const { log, lines } = recordingTelemetry();
      const decoded = decodeReportClientIssues(request(data, STAFF), log);
      expect(wire(decoded)).toEqual({
        code: 'invalid-argument',
        details: { errorCode: ClientIssueErrorCode.BatchRefused },
      });
      expect(lines).toEqual([
        {
          level: 'warn',
          msg: 'client issue batch refused',
          fields: {
            ...ClientIssueError.batchRefused(reason, issueIndex, issueField),
            reporterRoles: ['barber'],
            reporterAuthed: true,
          },
        },
      ]);
      expect(JSON.stringify(lines)).not.toContain('u-staff');
    }
  });

  it('pins the definition: a 10 s timeout, twenty calls a second per instance with a burst of twenty', () => {
    expect(REPORT_CLIENT_ISSUES_TIMEOUT_SECONDS).toBe(10);
    expect(CLIENT_ISSUE_RATE).toEqual({ capacity: 20, callsPerSecond: 20 });
  });
});
