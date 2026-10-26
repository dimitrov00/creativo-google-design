import { describe, expect, it } from 'vitest';
import type { AllTrue, NoNested } from '@core/testing';
import { ClientIssue, ClientIssueKind } from './client-issue.data';

/*
 * The client issue struct (OR-34): the six kinds of the ruling, the closed
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
});

describe('ClientIssueKind', () => {
  it('holds the six kinds of the ruling, SCREAMING', () => {
    expect(Object.values(ClientIssueKind)).toEqual([
      'DATA_DOCUMENT_DROPPED',
      'DATA_DOCUMENT_REFUSED',
      'CHUNK_LOAD_FAILED',
      'UNCAUGHT_ERROR',
      'UNHANDLED_REJECTION',
      'CSP_VIOLATION',
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
    expect(errors).toEqual(['UNCAUGHT_ERROR', 'UNHANDLED_REJECTION']);
  });
});
