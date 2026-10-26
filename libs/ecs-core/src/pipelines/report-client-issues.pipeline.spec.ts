import { describe, expect, it } from 'vitest';
import { type ClientIssue, ClientIssueKind, Role } from '@core/components';
import { ClientIssueSystem } from '@core/systems';
import { deepFreeze, recordingTelemetry } from '@core/testing';
import {
  type ReportClientIssuesCommand,
  reportClientIssues,
} from './report-client-issues.pipeline';

/*
 * `reportClientIssues` (OR-34): the admitted batch, ONE Cloud Logging line
 * per issue, in order — the conditions at `warn`, the error kinds at
 * `error` typed `ReportedErrorEvent` — beside who reported it (roles and an
 * authed flag, never a uid). Nothing read, nothing stored.
 */

const issue = (
  clientIssueKind: ClientIssueKind,
  fields: Partial<ClientIssue> = {},
): ClientIssue => ({
  clientIssueKind,
  errorName: null,
  documentPath: null,
  fieldName: null,
  routePattern: '/staff/schedule',
  topFrame: null,
  scrubbedMessage: null,
  release: '2026.10.26+1322b78',
  occurrences: 1,
  ...fields,
});

const BATCH: readonly ClientIssue[] = [
  issue(ClientIssueKind.DataDocumentDropped, {
    errorName: 'REPOSITORY_MALFORMED',
    documentPath: 'appointments/appt-1',
    fieldName: 'seats[1].startMinutes',
    occurrences: 4,
  }),
  issue(ClientIssueKind.UncaughtError, {
    errorName: 'TypeError',
    topFrame: 'StaffDay.render (https://creativo.app/main-5XKQ3RZB.js:1:23456)',
    scrubbedMessage: "Cannot read properties of null (reading 'seats')",
  }),
  issue(ClientIssueKind.CspViolation, {
    errorName: 'script-src-elem',
    scrubbedMessage: 'https://evil.example',
  }),
  issue(ClientIssueKind.UnhandledRejection),
];

function rig() {
  const telemetry = recordingTelemetry();
  const run = reportClientIssues({ log: telemetry.log });
  return { telemetry, run };
}

const command = (
  issues: readonly ClientIssue[],
): ReportClientIssuesCommand => ({
  issues,
  reporterRoles: [Role.Barber],
  reporterAuthed: true,
});

describe('reportClientIssues', () => {
  it('writes one line per issue, in order — each the system’s line for it', async () => {
    const { telemetry, run } = rig();
    const cmd = command(BATCH);
    expect(await run(cmd)).toEqual({ loggedCount: 4 });
    expect(telemetry.lines).toEqual(
      BATCH.map((one) => {
        const line = ClientIssueSystem.logLine(one, cmd);
        return { level: line.level, msg: line.msg, fields: line.fields };
      }),
    );
    expect(telemetry.lines.map((line) => line.level)).toEqual([
      'warn',
      'error',
      'warn',
      'error',
    ]);
  });

  it('names the reporter by its roles and authed flag, never a uid', async () => {
    const { telemetry, run } = rig();
    await run({
      issues: [BATCH[0] as ClientIssue],
      reporterRoles: [],
      reporterAuthed: false,
    });
    const fields = telemetry.lines[0]?.fields ?? {};
    expect(fields['reporterRoles']).toEqual([]);
    expect(fields['reporterAuthed']).toBe(false);
    expect(Object.keys(fields).some((key) => /uid|userId/i.test(key))).toBe(
      false,
    );
  });

  it('types the error kinds for Error Reporting, under the web service and the build', async () => {
    const { telemetry, run } = rig();
    await run(command(BATCH));
    const uncaught = telemetry.lines[1]?.fields ?? {};
    expect(uncaught['@type']).toBe(ClientIssueSystem.REPORTED_ERROR_EVENT);
    expect(uncaught['serviceContext']).toEqual({
      service: 'web',
      version: '2026.10.26+1322b78',
    });
    expect(telemetry.lines[1]?.msg).toBe(
      "TypeError: Cannot read properties of null (reading 'seats')\n    at StaffDay.render (https://creativo.app/main-5XKQ3RZB.js:1:23456)",
    );
    expect(telemetry.lines[0]?.fields).not.toHaveProperty('@type');
  });

  it('writes nothing for an empty batch', async () => {
    const { telemetry, run } = rig();
    expect(await run(command([]))).toEqual({ loggedCount: 0 });
    expect(telemetry.lines).toEqual([]);
  });

  it('leaves the command untouched', async () => {
    const { run } = rig();
    const cmd = deepFreeze(command(BATCH.map((one) => ({ ...one }))));
    await expect(run(cmd)).resolves.toEqual({ loggedCount: 4 });
  });
});
