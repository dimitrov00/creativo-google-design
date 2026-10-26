/**
 * The client issue sink's one refusal (OR-34) — `ClientIssueSystem.admitBatch`
 * at the `reportClientIssues` callable's edge refuses a payload whole when it
 * is not a closed, capped batch of issue structs. A flat struct discriminated
 * by `errorCode` (Law 7.5), SCREAMING_SNAKE with the `CLIENT_ISSUE_` prefix.
 *
 * No screen words it: the web's reporter never reports itself, so a refused
 * send is dropped, never shown — the code carries no `errors.<errorCode>`
 * catalogue key. The edge logs it, so a tampering client or a reporter that
 * drifted from the shape is visible in Cloud Logging.
 */
export const ClientIssueErrorCode = {
  BatchRefused: 'CLIENT_ISSUE_BATCH_REFUSED',
} as const;
export type ClientIssueErrorCode =
  (typeof ClientIssueErrorCode)[keyof typeof ClientIssueErrorCode];

/** Why a batch was refused — the field `clientIssueBatchRefusedReason`. */
export const ClientIssueBatchRefusedReason = {
  /** More issues than one call takes (`ClientIssueSystem.MAX_ISSUES`). */
  TooMany: 'TOO_MANY',
  /** A text over its field's cap, or the batch over its byte budget (`ClientIssueSystem.MAX_BYTES`). */
  TooLarge: 'TOO_LARGE',
  /** Not a non-empty array of closed issue structs: an unknown or missing key, a value of the wrong type or shape, an unscrubbed message. */
  Shape: 'SHAPE',
} as const;
export type ClientIssueBatchRefusedReason =
  (typeof ClientIssueBatchRefusedReason)[keyof typeof ClientIssueBatchRefusedReason];

export type ClientIssueError = ClientIssueError.BatchRefused;

export const ClientIssueError = {
  /**
   * The batch refused whole — why, and where: the issue's index in the
   * batch and the field at fault, each `null` when the refusal is the
   * batch's own (too many issues, too many bytes, not an array).
   */
  batchRefused(
    clientIssueBatchRefusedReason: ClientIssueBatchRefusedReason,
    issueIndex: number | null,
    issueField: string | null,
  ): ClientIssueError.BatchRefused {
    return {
      errorCode: ClientIssueErrorCode.BatchRefused,
      clientIssueBatchRefusedReason,
      issueIndex,
      issueField,
    };
  },
} as const;

export namespace ClientIssueError {
  export type BatchRefused = {
    readonly errorCode: typeof ClientIssueErrorCode.BatchRefused;
    readonly clientIssueBatchRefusedReason: ClientIssueBatchRefusedReason;
    /** The refused issue's index in the batch — `null` for the batch's own refusal. */
    readonly issueIndex: number | null;
    /** The refused issue's field at fault — `null` when no one field is (not a record, the batch's own refusal). */
    readonly issueField: string | null;
  };
}
