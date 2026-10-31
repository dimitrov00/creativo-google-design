import type { ClientIssue } from '@core/components';
import type { CallableWire, Callables, LogPorts } from '@core/ports';
import { ClientIssueSystem, type ClientIssueReporter } from '@core/systems';

/**
 * `reportClientIssues` — the first-party client issue sink (OR-34): the
 * callable's admitted batch written to Cloud Logging, ONE line per issue,
 * in order (`ClientIssueSystem.logLine`): the conditions at `warn`, the
 * error kinds at `error` typed as Error Reporting's `ReportedErrorEvent`.
 * Nothing is read and nothing is stored — the log IS the record (30-day
 * retention), counted by the `client_issue_count` metric.
 *
 * The edge owns the two inputs: it admits the payload
 * (`ClientIssueSystem.admitBatch`, refused whole as
 * `CLIENT_ISSUE_BATCH_REFUSED`) and reads the reporter off the call's auth
 * context — its known roles and whether it was signed in, never its uid —
 * so this pipeline only ever sees a closed, scrubbed batch.
 */

export type ReportClientIssuesCommand = ClientIssueReporter & {
  /** The admitted batch — at most `ClientIssueSystem.MAX_ISSUES` issues. */
  readonly issues: readonly ClientIssue[];
};

export const reportClientIssues =
  (ports: LogPorts) =>
  async (
    cmd: ReportClientIssuesCommand,
  ): Promise<CallableWire[typeof Callables.ReportClientIssues]['answer']> => {
    for (const issue of cmd.issues) {
      // The command carries the reporter's fields itself — handed on as is.
      const line = ClientIssueSystem.logLine(issue, cmd);
      ports.log(line.level, line.msg, line.fields);
    }
    return { loggedCount: cmd.issues.length };
  };
