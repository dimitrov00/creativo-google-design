import { LogEvent, Result } from '@core/primitives';
import type { Callables, CallableWire, Log } from '@core/ports';
import type {
  ReportClientIssuesAnswer,
  ReportClientIssuesCommand,
} from '@core/pipelines';
import { ClientIssueSystem } from '@core/systems';
import type { EdgeError, ThrottleRate } from '../edge';
import { callerKnownRoles, callerUserId } from '../lib/booking/caller-roles';
import type { WireRequest } from './wire-read';

/**
 * THE `reportClientIssues` CALLABLE'S WIRE (OR-34) — the web's first-party
 * issue sink. The request is the batch itself, an array of `ClientIssue`
 * structs (`CallableWire`), admitted whole by `ClientIssueSystem.admitBatch`
 * — at most 10 issues and 4 KB, every text within its cap and in its
 * scrubbed form — or refused whole (`CLIENT_ISSUE_BATCH_REFUSED`). The
 * answer is the count of lines written.
 *
 * Who reported it is read off the VERIFIED token, never the payload, and
 * never as the uid (privacy by shape): the token's known roles and whether
 * the call carried one at all. A refused batch is logged here, once, with
 * why and where — the wire carries its code alone, and the reporter drops
 * it — so a tampering device, or a reporter that drifted from the shape,
 * shows in Cloud Logging.
 */

/** The definition's `timeoutSeconds` — and the work budget's share of it, so the two can never disagree. */
export const REPORT_CLIENT_ISSUES_TIMEOUT_SECONDS = 10;

/** Twenty calls a second per instance, a burst of twenty (OR-34): two instances bound the whole. */
export const CLIENT_ISSUE_RATE: ThrottleRate = {
  capacity: 20,
  callsPerSecond: 20,
};

/** The batch admitted into the pipeline's command beside its reporter — or refused, and logged where it is refused. */
export function decodeReportClientIssues(
  request: WireRequest,
  log: Log,
): Result<ReportClientIssuesCommand, EdgeError> {
  const reporterRoles = callerKnownRoles(request);
  const reporterAuthed = callerUserId(request) !== null;
  const batch = ClientIssueSystem.admitBatch(request.data);
  if (!batch.ok) {
    log('warn', LogEvent.ClientIssueBatchRefused, {
      ...batch.error,
      reporterRoles,
      reporterAuthed,
    });
    return batch;
  }
  return Result.ok({ reporterRoles, reporterAuthed, issues: batch.value });
}

export function encodeReportClientIssuesAnswer(
  answer: ReportClientIssuesAnswer,
): CallableWire[typeof Callables.ReportClientIssues]['answer'] {
  return { loggedCount: answer.loggedCount };
}

/**
 * The sink's refusal after admission — there is none: the pipeline writes
 * its lines and answers their count, so nothing reaches here.
 */
export function reportClientIssuesRefusal(error: never): EdgeError {
  return error;
}
