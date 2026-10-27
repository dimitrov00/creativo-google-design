import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { type ClientIssue, ClientIssueKind } from '@core/components';
import { Callables, type GatewayPorts } from '@core/ports';
import { ClientOperationId, Result } from '@core/primitives';
import { ClientIssueSystem } from '@core/systems';
import { unwrapOk } from '@core/testing';
import { clientIssueReporter } from './client-issue-reporter.adapter';
import { CLIENT_ISSUE_REPORTER } from './reporting-error-handler';

/** A distinct, composed issue — `n` makes its fingerprint its own. */
function issue(n: number, message = `boom ${n}`): ClientIssue {
  return ClientIssueSystem.compose({
    clientIssueKind: ClientIssueKind.UncaughtError,
    errorName: 'TypeError',
    documentPath: null,
    fieldName: null,
    routePattern: '/staff/schedule',
    topFrame: null,
    message,
    release: null,
  });
}

/**
 * The web's callable client as the reporter dials it: every batch recorded
 * under the callable's name, answered by `answer` (a logged count unless
 * the spec says otherwise).
 */
function recordingGateway(
  answer: () => Promise<Result<{ loggedCount: number }, never>> = async () =>
    Result.ok({ loggedCount: 0 }),
) {
  const batches: (readonly ClientIssue[])[] = [];
  const names: string[] = [];
  const gateway = {
    callableClient: (name: string) => {
      names.push(name);
      return async (batch: readonly ClientIssue[]) => {
        batches.push(batch);
        return answer();
      };
    },
  } as unknown as GatewayPorts;
  return { gateway, batches, names };
}

/** Pretends the page went to the background (or came back), as a closing tab does. */
function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('clientIssueReporter — the page session’s issue sink (OR-34)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    setVisibility('visible');
  });

  it('buffers until it is connected, then sends after the batch window, through the reportClientIssues callable', async () => {
    const reporter = clientIssueReporter(window);
    const { gateway, batches, names } = recordingGateway();
    const getter = vi.fn(() => gateway);

    reporter.reportClientIssues([issue(1), issue(2)]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(batches).toEqual([]);

    reporter.connect(getter);
    // The line is read on the first send, never on connect.
    expect(getter).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_999);
    expect(batches).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);

    expect(batches).toEqual([[issue(1), issue(2)]]);
    expect(names).toEqual([Callables.ReportClientIssues]);
    expect(getter).toHaveBeenCalledTimes(1);
  });

  it('sends at once when ten issues wait — a batch never waits for the window once it is full', async () => {
    const reporter = clientIssueReporter(window);
    const { gateway, batches } = recordingGateway();
    reporter.connect(() => gateway);

    const ten = Array.from({ length: 10 }, (_, n) => issue(n));
    reporter.reportClientIssues(ten);

    expect(batches).toEqual([ten]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(batches).toHaveLength(1);
  });

  it('counts a repeat still in the buffer, and drops a repeat of one already sent', async () => {
    const reporter = clientIssueReporter(window);
    const { gateway, batches } = recordingGateway();
    reporter.connect(() => gateway);

    reporter.reportClientIssues([issue(1)]);
    reporter.reportClientIssues([issue(1), issue(1)]);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(batches).toEqual([[{ ...issue(1), occurrences: 3 }]]);

    reporter.reportClientIssues([issue(1)]);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(batches).toHaveLength(1);
  });

  // WS-5 (RU-30): the operation id is no identity — a callable failing on
  // every retry is one issue counted, never one per attempt.
  it('counts transport failures of one callable as one issue, whatever their operation ids', async () => {
    const reporter = clientIssueReporter(window);
    const { gateway, batches } = recordingGateway();
    reporter.connect(() => gateway);
    const failure = (operationId: string): ClientIssue =>
      ClientIssueSystem.composeTransport({
        callableName: 'commitBooking',
        errorName: 'TypeError',
        callableErrorCode: null,
        operationId: unwrapOk(ClientOperationId.parse(operationId)),
        release: null,
      });

    reporter.reportClientIssues([failure('attempt-0000000000000001')]);
    reporter.reportClientIssues([failure('attempt-0000000000000002')]);
    await vi.advanceTimersByTimeAsync(3_000);

    expect(batches).toEqual([
      [{ ...failure('attempt-0000000000000001'), occurrences: 2 }],
    ]);
  });

  it('sends at most twenty distinct issues in a page session', async () => {
    const reporter = clientIssueReporter(window);
    const { gateway, batches } = recordingGateway();
    reporter.connect(() => gateway);

    reporter.reportClientIssues(Array.from({ length: 25 }, (_, n) => issue(n)));
    reporter.reportClientIssues([issue(100), issue(101)]);
    await vi.advanceTimersByTimeAsync(10_000);

    const sent = batches.flat();
    expect(sent).toHaveLength(20);
    expect(sent).toEqual(Array.from({ length: 20 }, (_, n) => issue(n)));
    // Every batch is one the callable admits.
    for (const batch of batches) {
      expect(ClientIssueSystem.admitBatch(batch).ok).toBe(true);
    }
  });

  it('packs by weight as the callable admits — no batch past 4 KB', async () => {
    const reporter = clientIssueReporter(window);
    const { gateway, batches } = recordingGateway();
    reporter.connect(() => gateway);

    const heavy = Array.from({ length: 10 }, (_, n) =>
      issue(n, `${'долъг текст '.repeat(12)}${n}`),
    );
    reporter.reportClientIssues(heavy);

    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flat()).toEqual(heavy);
    for (const batch of batches) {
      expect(ClientIssueSystem.admitBatch(batch).ok).toBe(true);
    }
  });

  it('flushes the moment the page hides, without waiting for the window', async () => {
    const reporter = clientIssueReporter(window);
    const { gateway, batches } = recordingGateway();
    reporter.connect(() => gateway);

    reporter.reportClientIssues([issue(7)]);
    setVisibility('hidden');

    expect(batches).toEqual([[issue(7)]]);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(batches).toHaveLength(1);
  });

  it('keeps the buffer when the page hides before it is connected', async () => {
    const reporter = clientIssueReporter(window);
    const { gateway, batches } = recordingGateway();

    reporter.reportClientIssues([issue(3)]);
    setVisibility('hidden');
    setVisibility('visible');
    reporter.connect(() => gateway);
    await vi.advanceTimersByTimeAsync(3_000);

    expect(batches).toEqual([[issue(3)]]);
  });

  it('never reports itself — a send that rejects, or a line that throws, ends in the reporter', async () => {
    const rejecting = clientIssueReporter(window);
    rejecting.connect(
      () =>
        ({
          callableClient: () => async () => {
            throw new Error('network down');
          },
        }) as unknown as GatewayPorts,
    );
    const throwing = clientIssueReporter(window);
    throwing.connect(() => {
      throw new Error('no functions instance');
    });

    expect(() => {
      rejecting.reportClientIssues(
        Array.from({ length: 10 }, (_, n) => issue(n)),
      );
      throwing.reportClientIssues(
        Array.from({ length: 10 }, (_, n) => issue(n)),
      );
    }).not.toThrow();
    // Anything left to settle settles here; an unhandled rejection would
    // fail the run.
    await vi.runAllTimersAsync();
  });

  it('is silent with no page under it', () => {
    const reporter = clientIssueReporter(null);
    const { gateway, batches } = recordingGateway();

    expect(() => {
      reporter.connect(() => gateway);
      reporter.reportClientIssues(
        Array.from({ length: 10 }, (_, n) => issue(n)),
      );
    }).not.toThrow();
    expect(batches).toEqual([]);
  });
});

describe('CLIENT_ISSUE_REPORTER', () => {
  it('defaults to one reporter per root, over the document’s window', () => {
    TestBed.resetTestingModule();
    const reporter = TestBed.inject(CLIENT_ISSUE_REPORTER);

    expect(typeof reporter.reportClientIssues).toBe('function');
    expect(typeof reporter.connect).toBe('function');
    expect(TestBed.inject(CLIENT_ISSUE_REPORTER)).toBe(reporter);
  });
});
