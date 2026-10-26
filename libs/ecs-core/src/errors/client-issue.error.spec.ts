import { describe, expect, it } from 'vitest';
import {
  ClientIssueBatchRefusedReason,
  ClientIssueError,
  ClientIssueErrorCode,
} from './client-issue.error';

describe('ClientIssueError', () => {
  it('uses the one SCREAMING code and the three reasons of the ruling (OR-34)', () => {
    expect(Object.values(ClientIssueErrorCode)).toEqual([
      'CLIENT_ISSUE_BATCH_REFUSED',
    ]);
    expect(Object.values(ClientIssueBatchRefusedReason)).toEqual([
      'TOO_MANY',
      'TOO_LARGE',
      'SHAPE',
    ]);
  });

  it('builds a flat refusal naming why and where', () => {
    expect(
      ClientIssueError.batchRefused(
        ClientIssueBatchRefusedReason.Shape,
        3,
        'documentPath',
      ),
    ).toEqual({
      errorCode: 'CLIENT_ISSUE_BATCH_REFUSED',
      clientIssueBatchRefusedReason: 'SHAPE',
      issueIndex: 3,
      issueField: 'documentPath',
    });
    // The batch's own refusal names no issue and no field.
    expect(
      ClientIssueError.batchRefused(
        ClientIssueBatchRefusedReason.TooMany,
        null,
        null,
      ),
    ).toEqual({
      errorCode: 'CLIENT_ISSUE_BATCH_REFUSED',
      clientIssueBatchRefusedReason: 'TOO_MANY',
      issueIndex: null,
      issueField: null,
    });
  });

  it('is serialisable and prototype-free (Law 7.5)', () => {
    const error = ClientIssueError.batchRefused(
      ClientIssueBatchRefusedReason.TooLarge,
      0,
      'topFrame',
    );
    expect(Object.getPrototypeOf(error)).toBe(Object.prototype);
    expect(JSON.parse(JSON.stringify(error))).toEqual(error);
  });
});
