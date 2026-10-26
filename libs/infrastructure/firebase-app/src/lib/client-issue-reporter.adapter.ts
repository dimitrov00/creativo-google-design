import type { ClientIssue } from '@core/components';
import {
  Callables,
  type ClientIssuePorts,
  type GatewayPorts,
} from '@core/ports';
import { ClientIssueSystem } from '@core/systems';

/**
 * The page's issue reporter: the `ClientIssuePorts` it implements, and the
 * one control a composition root needs — {@link ClientIssueReporter.connect},
 * which puts it on the line once the app is up. Until then it buffers, so a
 * CSP violation the boot itself raises (OR-30) still goes out.
 */
export type ClientIssueReporter = ClientIssuePorts & {
  /**
   * Hands the reporter the web's one callable client, as a getter read on
   * the first send — never at boot, so a Functions instance that fails to
   * come up never takes the error handler down with it. Buffered issues go
   * out on the next batch.
   */
  readonly connect: (gateway: () => GatewayPorts) => void;
};

/** The most distinct issues one page session sends (OR-34). */
const MAX_PER_SESSION = 20;
/** How long the first issue of a batch waits for company before it goes (OR-34). */
const BATCH_WINDOW_MS = 3_000;

/** A reporter with no page under it: nothing to pace, nothing to send. */
const NO_PAGE: ClientIssueReporter = {
  reportClientIssues: () => undefined,
  connect: () => undefined,
};

/**
 * THE CLIENT ISSUE REPORTER (OR-34) — `ClientIssuePorts` over a page
 * session and the `reportClientIssues` callable, fire-and-forget like a log:
 *
 * - **Dedupe by fingerprint** (`ClientIssueSystem.fingerprint`): a repeat
 *   still waiting in the buffer adds its count to the one there
 *   (`occurrences`); a repeat of an issue already sent this session is
 *   dropped.
 * - **At most {@link MAX_PER_SESSION} distinct issues per page session** —
 *   an error loop costs one line, never a storm.
 * - **Batches** packed by `ClientIssueSystem.pack` (at most 10 issues and
 *   4 KB each, exactly what the callable admits): sent as soon as 10 wait,
 *   else {@link BATCH_WINDOW_MS} after the first one arrived, and at once
 *   when the page hides (`visibilitychange` → `hidden`: the last moment a
 *   tab that is closing still runs).
 * - **Never reports itself**: a send that throws or rejects is dropped
 *   here, never handed to the `ErrorHandler` whose reports it carries.
 *
 * Until {@link ClientIssueReporter.connect} gives it a line, it only
 * buffers (the cap and the dedupe hold all the same).
 */
export function clientIssueReporter(view: Window | null): ClientIssueReporter {
  if (view === null) return NO_PAGE;

  /** The issues waiting to go, by fingerprint, in arrival order. */
  const pending = new Map<string, ClientIssue>();
  /** The fingerprints already sent this session. */
  const sent = new Set<string>();
  let taken = 0;
  let line: (() => GatewayPorts) | null = null;
  let timer: number | null = null;

  /**
   * One batch to the `reportClientIssues` callable — through the callable
   * client, which answers every failure as a `Result` it never rejects
   * with; its answer is never read (a sink answers nothing the device acts
   * on).
   */
  const dispatch = (
    gateway: () => GatewayPorts,
    batch: readonly ClientIssue[],
  ) => {
    try {
      gateway()
        .callableClient(Callables.ReportClientIssues)(batch)
        .catch(() => undefined);
    } catch {
      // A reporter never reports itself: a send that fails ends here.
    }
  };

  const flush = (): void => {
    if (timer !== null) {
      view.clearTimeout(timer);
      timer = null;
    }
    if (line === null || pending.size === 0) return;
    const issues = [...pending.values()];
    for (const key of pending.keys()) sent.add(key);
    pending.clear();
    for (const batch of ClientIssueSystem.pack(issues)) dispatch(line, batch);
  };

  const arm = (): void => {
    if (timer === null && line !== null && pending.size > 0) {
      timer = view.setTimeout(flush, BATCH_WINDOW_MS);
    }
  };

  view.document.addEventListener('visibilitychange', () => {
    if (view.document.visibilityState === 'hidden') flush();
  });

  return {
    reportClientIssues: (issues) => {
      for (const issue of issues) {
        const key = ClientIssueSystem.fingerprint(issue);
        if (sent.has(key)) continue;
        const held = pending.get(key);
        if (held !== undefined) {
          pending.set(key, {
            ...held,
            occurrences: held.occurrences + issue.occurrences,
          });
        } else if (taken < MAX_PER_SESSION) {
          taken++;
          pending.set(key, issue);
        }
      }
      if (pending.size >= ClientIssueSystem.MAX_ISSUES) flush();
      else arm();
    },
    connect: (gateway) => {
      line = gateway;
      arm();
    },
  };
}
