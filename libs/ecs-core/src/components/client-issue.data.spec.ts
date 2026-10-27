import { describe, expect, it } from 'vitest';
import type { AllTrue, NoNested } from '@core/testing';
import type { ClientOperationId } from '@core/primitives';
import { ClientIssue, ClientIssueKind } from './client-issue.data';

/*
 * The client issue struct (OR-34): the six kinds of the ruling and the
 * transport failure WS-5 added (RU-30), the closed
 * key set admission holds a payload to, flat at its root, and the two error
 * kinds Error Reporting groups.
 */

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

const issue = (clientIssueKind: ClientIssueKind): ClientIssue => ({
  clientIssueKind,
  errorName: null,
  documentPath: null,
  fieldName: null,
  routePattern: null,
  topFrame: null,
  scrubbedMessage: null,
  release: null,
  occurrences: 1,
  operationId: null,
  callableName: null,
  callableErrorCode: null,
});

describe('ClientIssueKind', () => {
  it('holds the six kinds of the ruling and the transport failure, SCREAMING', () => {
    expect(Object.values(ClientIssueKind)).toEqual([
      'DATA_DOCUMENT_DROPPED',
      'DATA_DOCUMENT_REFUSED',
      'CHUNK_LOAD_FAILED',
      'UNCAUGHT_ERROR',
      'UNHANDLED_REJECTION',
      'CSP_VIOLATION',
      'CALLABLE_TRANSPORT_FAILED',
    ]);
  });
});

describe('ClientIssue', () => {
  it('lists every field once, in declaration order — the closed key set', () => {
    const everyKey: Equal<
      (typeof ClientIssue.FIELDS)[number],
      keyof ClientIssue
    > = true;
    expect(everyKey).toBe(true);
    expect(ClientIssue.FIELDS).toEqual(
      Object.keys(issue(ClientIssueKind.CspViolation)),
    );
    expect(new Set(ClientIssue.FIELDS).size).toBe(ClientIssue.FIELDS.length);
  });

  it('appends the three WS-5 fields after the nine OR-34 ones, each `null` when absent (RU-30)', () => {
    expect(ClientIssue.FIELDS).toEqual([
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
    const operationId: Equal<
      ClientIssue['operationId'],
      ClientOperationId | null
    > = true;
    const callableName: Equal<ClientIssue['callableName'], string | null> =
      true;
    const callableErrorCode: Equal<
      ClientIssue['callableErrorCode'],
      string | null
    > = true;
    expect([operationId, callableName, callableErrorCode]).toEqual([
      true,
      true,
      true,
    ]);
  });

  it('is flat: no nested 1-to-1 struct, a field named after its dictionary', () => {
    const flat: AllTrue<NoNested<ClientIssue>> = true;
    const kindField: Equal<ClientIssue['clientIssueKind'], ClientIssueKind> =
      true;
    expect([flat, kindField]).toEqual([true, true]);
  });

  it('calls the uncaught error and the unhandled rejection its error kinds — nothing else', () => {
    const errors = Object.values(ClientIssueKind).filter((kind) =>
      ClientIssue.isError(issue(kind)),
    );
    // A transport failure is a condition (`warn`), never an error group.
    expect(errors).toEqual(['UNCAUGHT_ERROR', 'UNHANDLED_REJECTION']);
  });
});
