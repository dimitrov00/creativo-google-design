import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Component, ErrorHandler } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { type ClientIssue, ClientIssueKind } from '@core/components';
import { ClientIssueSystem } from '@core/systems';
import type { ClientIssueReporter } from './client-issue-reporter.adapter';
import { errorHandlerLogPorts } from './error-handler-log.adapter';
import { lazyPortLoadError } from './lazy-port';
import {
  CLIENT_ISSUE_REPORTER,
  type CspViolationReport,
  ReportingErrorHandler,
  cspViolationIssue,
  errorIssue,
  routePatternOf,
} from './reporting-error-handler';

/** The `DataLog` error the data layer hands its `ErrorHandler` for `msg` and `fields`. */
function dataLogError(msg: string, fields: Record<string, unknown>): unknown {
  let reported: unknown;
  errorHandlerLogPorts({
    handleError: (error: unknown) => {
      reported = error;
    },
  } as ErrorHandler).log('error', msg, fields);
  return reported;
}

/** An error with the stack a browser would give it. */
function errorWithStack(message: string, stack: string): Error {
  const error = new TypeError(message);
  error.stack = stack;
  return error;
}

describe('errorIssue — the one classification of what reached the ErrorHandler', () => {
  it('reads a dropped row of the data layer as DATA_DOCUMENT_DROPPED, with its document and field', () => {
    const issue = errorIssue(
      dataLogError('malformed document dropped', {
        path: 'appointments/appt-1',
        field: 'seats[0].startMinutes',
      }),
      false,
      '/staff/schedule',
    );

    expect(issue).toEqual({
      clientIssueKind: ClientIssueKind.DataDocumentDropped,
      errorName: 'DataLog',
      documentPath: 'appointments/appt-1',
      fieldName: 'seats[0].startMinutes',
      routePattern: '/staff/schedule',
      topFrame: null,
      scrubbedMessage: 'malformed document dropped',
      release: null,
      occurrences: 1,
      operationId: null,
      callableName: null,
      callableErrorCode: null,
    });
  });

  it('reads every other data-layer line as DATA_DOCUMENT_REFUSED', () => {
    const issue = errorIssue(
      dataLogError('malformed document refused', {
        path: 'customers/c1',
        field: 'userId',
      }),
      false,
      '/account',
    );

    expect(issue.clientIssueKind).toBe(ClientIssueKind.DataDocumentRefused);
    expect(issue.documentPath).toBe('customers/c1');
    expect(issue.fieldName).toBe('userId');
  });

  it('keeps a document path only in its collection/id shape', () => {
    const issue = errorIssue(
      dataLogError('malformed document refused', {
        path: 'https://example.com/appointments/appt-1',
        field: 'not a field path',
      }),
      false,
      null,
    );

    expect(issue.documentPath).toBeNull();
    expect(issue.fieldName).toBeNull();
  });

  it('reads a lazy chunk that did not arrive as CHUNK_LOAD_FAILED — thrown as is', () => {
    const issue = errorIssue(
      errorWithStack(
        'Failed to fetch dynamically imported module: https://app.example/chunk-AB12CD34.js',
        'TypeError: Failed to fetch\n    at x (https://app.example/main-1.js:1:2)',
      ),
      true,
      '/book',
    );

    expect(issue.clientIssueKind).toBe(ClientIssueKind.ChunkLoadFailed);
    expect(issue.errorName).toBe('TypeError');
    expect(issue.routePattern).toBe('/book');
    expect(issue.topFrame).toBeNull();
  });

  it('reads the cause of a LazyPortLoadError — a chunk failure is CHUNK_LOAD_FAILED, any other an UNCAUGHT_ERROR', () => {
    const chunk = errorIssue(
      lazyPortLoadError(
        'firebase-data',
        new TypeError('Importing a module script failed.'),
      ),
      false,
      null,
    );
    expect(chunk.clientIssueKind).toBe(ClientIssueKind.ChunkLoadFailed);
    expect(chunk.scrubbedMessage).toBe('Importing a module script failed.');

    const sdk = errorIssue(
      lazyPortLoadError('firebase-data', new Error('failed-precondition')),
      false,
      null,
    );
    expect(sdk.clientIssueKind).toBe(ClientIssueKind.UncaughtError);
    expect(sdk.errorName).toBe('LazyPortLoadError');
  });

  it('reads anything else as an UNCAUGHT_ERROR with its first frame, the query cut, the message scrubbed', () => {
    const issue = errorIssue(
      errorWithStack(
        'no seat for ana@example.com',
        'TypeError: no seat for ana@example.com\n' +
          '    at pick (https://app.example/main-AB12CD34.js?v=3:10:20)\n' +
          '    at run (https://app.example/main-AB12CD34.js:1:1)',
      ),
      false,
      '/staff/schedule',
    );

    expect(issue).toEqual({
      clientIssueKind: ClientIssueKind.UncaughtError,
      errorName: 'TypeError',
      documentPath: null,
      fieldName: null,
      routePattern: '/staff/schedule',
      topFrame: 'pick (https://app.example/main-AB12CD34.js:10:20)',
      scrubbedMessage: 'no seat for [email]',
      release: null,
      occurrences: 1,
      operationId: null,
      callableName: null,
      callableErrorCode: null,
    });
  });

  it('reads a Firefox or Safari frame line too', () => {
    const issue = errorIssue(
      errorWithStack(
        'x is undefined',
        'pick@https://app.example/main-AB12CD34.js:10:20\nrun@https://app.example/main-AB12CD34.js:1:1',
      ),
      false,
      null,
    );

    expect(issue.topFrame).toBe(
      'pick@https://app.example/main-AB12CD34.js:10:20',
    );
  });

  it('reads the reason of a rejection being handed over as an UNHANDLED_REJECTION — a thrown string is its own message', () => {
    const issue = errorIssue('quota exceeded', true, null);

    expect(issue.clientIssueKind).toBe(ClientIssueKind.UnhandledRejection);
    expect(issue.errorName).toBeNull();
    expect(issue.scrubbedMessage).toBe('quota exceeded');
    expect(issue.topFrame).toBeNull();
  });

  it('builds an issue for any value at all — null, an object with no message', () => {
    expect(errorIssue(null, false, null).scrubbedMessage).toBeNull();
    expect(errorIssue({ code: 42 }, true, null).clientIssueKind).toBe(
      ClientIssueKind.UnhandledRejection,
    );
  });

  it('builds only issues the callable admits', () => {
    const issues = [
      errorIssue(new Error('x'.repeat(5_000)), false, '/'),
      errorIssue(dataLogError('malformed document dropped', {}), false, null),
      errorIssue('+359 88 123 4567', true, '/account'),
    ];
    expect(ClientIssueSystem.admitBatch(issues).ok).toBe(true);
  });
});

/** A violation report with the fields a browser sets. */
function violation(overrides: Partial<CspViolationReport>): CspViolationReport {
  return {
    blockedURI: 'https://evil.example/x.js?token=abc',
    columnNumber: 7,
    disposition: 'enforce',
    effectiveDirective: 'script-src-elem',
    lineNumber: 3,
    sample: '',
    sourceFile: 'https://app.example/main-AB12CD34.js',
    ...overrides,
  };
}

/** The three samples of the measured MapLibre baseline, as Chromium writes them. */
const MAPLIBRE_SAMPLES = [
  'Worker constructor|/maplibre-gl-worker.mjs?v=6.16.0',
  'DOMParser parseFromString|<a href="https://openfreemap.org"',
  'Element innerHTML|<a href="https://www.openstreetmap.org/copyright"',
] as const;

/** A report-only Trusted Types sink violation with `sample`. */
function trustedTypesSink(
  sample: string,
  disposition: CspViolationReport['disposition'] = 'report',
): CspViolationReport {
  return violation({
    blockedURI: 'trusted-types-sink',
    disposition,
    effectiveDirective: 'require-trusted-types-for',
    sample,
    sourceFile: 'https://app.example/chunk-QX7RT2LM.js',
  });
}

describe('cspViolationIssue — a CSP report as a CSP_VIOLATION issue (OR-30)', () => {
  it('names the directive, the disposition and the blocked ORIGIN, and the script that tripped it', () => {
    expect(cspViolationIssue(violation({}), '/book')).toEqual({
      clientIssueKind: ClientIssueKind.CspViolation,
      errorName: 'script-src-elem',
      documentPath: null,
      fieldName: null,
      routePattern: '/book',
      topFrame: 'https://app.example/main-AB12CD34.js:3:7',
      scrubbedMessage: 'enforce https://evil.example',
      release: null,
      occurrences: 1,
      operationId: null,
      callableName: null,
      callableErrorCode: null,
    });
  });

  it('keeps a keyword as it is, and a data: or blob: URL as its scheme', () => {
    expect(
      cspViolationIssue(
        violation({
          blockedURI: 'trusted-types-sink',
          disposition: 'report',
          effectiveDirective: 'require-trusted-types-for',
        }),
        null,
      )?.scrubbedMessage,
    ).toBe('report trusted-types-sink');
    expect(
      cspViolationIssue(violation({ blockedURI: 'data:text/html,hi' }), null)
        ?.scrubbedMessage,
    ).toBe('enforce data:');
    expect(
      cspViolationIssue(violation({ blockedURI: '' }), null)?.scrubbedMessage,
    ).toBe('enforce unknown');
  });

  it('has no frame when the browser names no script', () => {
    expect(
      cspViolationIssue(violation({ sourceFile: '' }), null)?.topFrame,
    ).toBeNull();
  });

  it('drops the measured MapLibre baseline — report-only, a Trusted Types sink, one of its three samples', () => {
    for (const sample of MAPLIBRE_SAMPLES) {
      expect(cspViolationIssue(trustedTypesSink(sample), '/book')).toBeNull();
    }
  });

  it('keeps the same sample when the policy ENFORCED it — the baseline is report-only', () => {
    for (const sample of MAPLIBRE_SAMPLES) {
      expect(
        cspViolationIssue(trustedTypesSink(sample, 'enforce'), '/book')
          ?.scrubbedMessage,
      ).toBe('enforce trusted-types-sink');
    }
  });

  it('keeps every other report-only Trusted Types sink', () => {
    for (const sample of [
      'Function|return this',
      'HTMLScriptElement src|https://evil.example/x.js',
      'Element outerHTML|<b>hi</b>',
    ]) {
      expect(
        cspViolationIssue(trustedTypesSink(sample), '/book')?.scrubbedMessage,
      ).toBe('report trusted-types-sink');
    }
  });

  it('keeps a baseline sample under any other directive', () => {
    expect(
      cspViolationIssue(
        violation({
          disposition: 'report',
          effectiveDirective: 'worker-src',
          blockedURI: 'http://127.0.0.1:5050/maplibre-gl-worker.mjs?v=6.16.0',
          sample: MAPLIBRE_SAMPLES[0],
        }),
        null,
      )?.errorName,
    ).toBe('worker-src');
  });

  it('drops what a browser extension raised in the page', () => {
    for (const scheme of [
      'chrome-extension:',
      'moz-extension:',
      'safari-web-extension:',
    ]) {
      expect(
        cspViolationIssue(
          violation({ sourceFile: `${scheme}//abc/content.js` }),
          null,
        ),
      ).toBeNull();
      expect(
        cspViolationIssue(
          violation({ blockedURI: `${scheme}//abc/inject.js` }),
          null,
        ),
      ).toBeNull();
    }
  });
});

@Component({ selector: 'lib-blank', template: '' })
class Blank {}

const ROUTES = [
  { path: 'staff/schedule', component: Blank },
  { path: 'visit', children: [{ path: ':visitId', component: Blank }] },
  { path: '', component: Blank },
];

describe('routePatternOf — the route as its pattern, never its URL', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter(ROUTES)] });
  });

  it('is null before the first navigation lands', () => {
    expect(routePatternOf(TestBed.inject(Router))).toBeNull();
  });

  it('joins the route configs’ paths — a parameter stays a parameter, the query goes', async () => {
    const router = TestBed.inject(Router);

    await router.navigateByUrl('/staff/schedule?day=2026-10-26&barber=ivan');
    expect(routePatternOf(router)).toBe('/staff/schedule');

    await router.navigateByUrl('/visit/appt-ana-42');
    expect(routePatternOf(router)).toBe('/visit/:visitId');

    await router.navigateByUrl('/');
    expect(routePatternOf(router)).toBe('/');
  });
});

/** A reporter that records every issue it is handed, or does what `onReport` says. */
function recordingReporter(
  onReport?: (issues: readonly ClientIssue[]) => void,
) {
  const reported: ClientIssue[] = [];
  const reporter: ClientIssueReporter = {
    reportClientIssues: (issues) => {
      reported.push(...issues);
      onReport?.(issues);
    },
    connect: () => undefined,
  };
  return { reporter, reported };
}

/** The handler under its real wiring: the reporter double, and a router. */
function handlerWith(reporter: ClientIssueReporter): ErrorHandler {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter(ROUTES),
      { provide: ErrorHandler, useClass: ReportingErrorHandler },
      { provide: CLIENT_ISSUE_REPORTER, useValue: reporter },
    ],
  });
  return TestBed.inject(ErrorHandler);
}

/** A window `unhandledrejection` event carrying `reason`, as a browser fires it. */
function rejectionEvent(reason: unknown): Event {
  const event = new Event('unhandledrejection');
  Object.defineProperty(event, 'reason', { value: reason });
  return event;
}

describe('ReportingErrorHandler — prints as ever, then reports (OR-34)', () => {
  let printed: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    printed = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    printed.mockRestore();
    TestBed.resetTestingModule();
  });

  it('prints exactly what Angular’s default prints, and reports one issue on the route’s pattern', async () => {
    const { reporter, reported } = recordingReporter();
    const handler = handlerWith(reporter);
    await TestBed.inject(Router).navigateByUrl('/staff/schedule?day=x');
    const error = new TypeError('boom');

    handler.handleError(error);

    expect(printed).toHaveBeenCalledWith('ERROR', error);
    expect(reported).toHaveLength(1);
    expect(reported[0]).toMatchObject({
      clientIssueKind: ClientIssueKind.UncaughtError,
      errorName: 'TypeError',
      scrubbedMessage: 'boom',
      routePattern: '/staff/schedule',
    });
  });

  it('reports the data layer’s lines through the same handler', () => {
    const { reporter, reported } = recordingReporter();
    const handler = handlerWith(reporter);

    errorHandlerLogPorts(handler).log('error', 'malformed document dropped', {
      path: 'appointments/a1',
      field: 'localDate',
    });

    expect(reported.map((issue) => issue.clientIssueKind)).toEqual([
      ClientIssueKind.DataDocumentDropped,
    ]);
    expect(reported[0]?.documentPath).toBe('appointments/a1');
  });

  it('tells an unhandled rejection from an uncaught error by the reason handed over', () => {
    const { reporter, reported } = recordingReporter();
    const handler = handlerWith(reporter);
    const reason = new Error('rejected');

    window.dispatchEvent(rejectionEvent(reason));
    handler.handleError(reason);
    // The note is spent: the next error is an uncaught one.
    handler.handleError(reason);

    expect(reported.map((issue) => issue.clientIssueKind)).toEqual([
      ClientIssueKind.UnhandledRejection,
      ClientIssueKind.UncaughtError,
    ]);
  });

  it('never reports itself — a reporter that throws, or an error raised while reporting, ends here', () => {
    const throwing = handlerWith({
      reportClientIssues: () => {
        throw new Error('reporter down');
      },
      connect: () => undefined,
    });
    expect(() => throwing.handleError(new Error('boom'))).not.toThrow();

    let handler: ErrorHandler | null = null;
    const { reporter, reported } = recordingReporter(() =>
      handler?.handleError(new Error('raised while reporting')),
    );
    handler = handlerWith(reporter);
    handler.handleError(new Error('first'));

    // The nested error is printed, never reported: one report, no loop.
    expect(reported.map((issue) => issue.scrubbedMessage)).toEqual(['first']);
    expect(printed).toHaveBeenCalledTimes(3);
  });
});
