import {
  DOCUMENT,
  DestroyRef,
  ErrorHandler,
  Injectable,
  InjectionToken,
  Injector,
  inject,
} from '@angular/core';
import { type ActivatedRouteSnapshot, Router } from '@angular/router';
import { type ClientIssue, ClientIssueKind } from '@core/components';
import { ClientIssueSystem } from '@core/systems';
import {
  type ClientIssueReporter,
  clientIssueReporter,
} from './client-issue-reporter.adapter';
import { MAPLIBRE_REPORT_ONLY_SINKS } from './csp-baseline';
import { DATA_LOG_ERROR } from './error-handler-log.adapter';

/**
 * The page's reporter — ONE per page session. `apps/web/src/main.ts` makes
 * it before the app boots (its CSP listener reports into it from the first
 * byte) and provides it here; a root nobody provided one for gets its own.
 * The {@link ReportingErrorHandler} reports into it, and the composition root
 * connects it to the callable.
 */
export const CLIENT_ISSUE_REPORTER = new InjectionToken<ClientIssueReporter>(
  'CLIENT_ISSUE_REPORTER',
  {
    providedIn: 'root',
    factory: () => clientIssueReporter(inject(DOCUMENT).defaultView),
  },
);

/**
 * The tail of the data layer's line for a row a list DROPPED
 * (`observe.ts`: `'malformed document dropped'`); every other `DataLog` line
 * is a refusal (`'malformed document refused'`).
 */
const DROPPED_LINE_END = 'dropped';

/**
 * What a browser says when a lazy chunk does not arrive — Chromium's
 * "Failed to fetch dynamically imported module", Firefox's "error loading
 * dynamically imported module", Safari's "Importing a module script
 * failed", and a bundler's `ChunkLoadError` / "Loading chunk … failed".
 */
const CHUNK_LOAD_FAILURE =
  /dynamically imported module|importing a module script failed|chunkloaderror|loading chunk \S+ failed/i;

/** How deep a `cause` chain is read for a chunk failure — a wrapper of a wrapper at most. */
const CAUSE_DEPTH = 3;

/** How much of a stack is read for its first frame. */
const STACK_WINDOW = 4096;

/** A frame line as Firefox and Safari write it: `name@url:line:col`. */
const AT_SIGN_FRAME = /@\S*:\d+:\d+$/;

/** The schemes a browser extension's own code is served from — never this app's. */
const EXTENSION_SCHEMES = [
  'chrome-extension:',
  'moz-extension:',
  'safari-web-extension:',
] as const;

/** A CSP report's `blockedURI` keywords — kept as they are; a URL is cut to its origin. */
const BLOCKED_KEYWORDS: ReadonlySet<string> = new Set([
  'inline',
  'eval',
  'wasm-eval',
  'trusted-types-sink',
  'trusted-types-policy',
]);

/** The parts of a thrown value an issue is built from. */
type Thrown = {
  readonly name: string | null;
  readonly message: string | null;
  readonly stack: string | null;
  readonly cause: unknown;
};

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** A thrown value read as an error — its name, message, stack and cause, each when it has one. */
function thrownOf(value: unknown): Thrown {
  if (typeof value === 'object' && value !== null) {
    const record = value as Readonly<Record<string, unknown>>;
    return {
      name: textOrNull(record['name']),
      message: textOrNull(record['message']),
      stack: textOrNull(record['stack']),
      cause: record['cause'],
    };
  }
  // A thrown string, number or boolean is its own message.
  const message =
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
      ? textOrNull(String(value))
      : null;
  return { name: null, message, stack: null, cause: undefined };
}

/** The first frame of a stack — V8's `at …` line, or Firefox/Safari's `name@url:line:col`. */
function topFrameOf(stack: string | null): string | null {
  if (stack === null) return null;
  for (const line of stack.slice(0, STACK_WINDOW).split('\n')) {
    const frame = line.trim();
    if (frame.startsWith('at ') || AT_SIGN_FRAME.test(frame)) return frame;
  }
  return null;
}

/** The chunk failure a value is, or wraps (a `LazyPortLoadError`'s cause), or `null`. */
function chunkFailureOf(value: unknown): Thrown | null {
  let current: unknown = value;
  for (let depth = 0; depth < CAUSE_DEPTH && current != null; depth++) {
    const thrown = thrownOf(current);
    if (
      CHUNK_LOAD_FAILURE.test(thrown.message ?? '') ||
      CHUNK_LOAD_FAILURE.test(thrown.name ?? '')
    ) {
      return thrown;
    }
    current = thrown.cause;
  }
  return null;
}

/** A `DataLog` line's `{ path, field }` (`errorHandlerLogPorts`), or `null` for any other value. */
function dataLogOf(
  value: unknown,
): { readonly path: string | null; readonly field: string | null } | null {
  if (!(value instanceof Error) || value.name !== DATA_LOG_ERROR) return null;
  const cause = value.cause;
  if (typeof cause !== 'object' || cause === null) {
    return { path: null, field: null };
  }
  const record = cause as Readonly<Record<string, unknown>>;
  return {
    path: textOrNull(record['path']),
    field: textOrNull(record['field']),
  };
}

/**
 * THE ONE CLASSIFICATION of what reached Angular's `ErrorHandler` (OR-34),
 * shaped by `ClientIssueSystem.compose` (the message scrubbed, the frame
 * cut, every other text kept only in its shape):
 *
 * - a data-layer line (`DataLog`, `errorHandlerLogPorts`) is
 *   `DATA_DOCUMENT_DROPPED` or `DATA_DOCUMENT_REFUSED`, with the document's
 *   `collection/id` and the guard's field;
 * - a lazy chunk that did not arrive — thrown as is, or the cause of a
 *   `LazyPortLoadError` — is `CHUNK_LOAD_FAILED`;
 * - anything else is an `UNHANDLED_REJECTION` when it is the reason of the
 *   rejection being handed over (`rejected`), else an `UNCAUGHT_ERROR`,
 *   with its first stack frame.
 *
 * The route is its PATTERN (`routePatternOf`), never its URL; the build is
 * not stamped into the web bundle yet, so `release` is `null`.
 */
export function errorIssue(
  error: unknown,
  rejected: boolean,
  routePattern: string | null,
): ClientIssue {
  const data = dataLogOf(error);
  if (data !== null) {
    const message = (error as Error).message;
    return ClientIssueSystem.compose({
      clientIssueKind: message.endsWith(DROPPED_LINE_END)
        ? ClientIssueKind.DataDocumentDropped
        : ClientIssueKind.DataDocumentRefused,
      errorName: DATA_LOG_ERROR,
      documentPath: data.path,
      fieldName: data.field,
      routePattern,
      topFrame: null,
      message,
      release: null,
    });
  }
  const chunk = chunkFailureOf(error);
  if (chunk !== null) {
    return ClientIssueSystem.compose({
      clientIssueKind: ClientIssueKind.ChunkLoadFailed,
      errorName: chunk.name,
      documentPath: null,
      fieldName: null,
      routePattern,
      topFrame: null,
      message: chunk.message,
      release: null,
    });
  }
  const thrown = thrownOf(error);
  return ClientIssueSystem.compose({
    clientIssueKind: rejected
      ? ClientIssueKind.UnhandledRejection
      : ClientIssueKind.UncaughtError,
    errorName: thrown.name,
    documentPath: null,
    fieldName: null,
    routePattern,
    topFrame: topFrameOf(thrown.stack),
    message: thrown.message,
    release: null,
  });
}

/** The parts of a `securitypolicyviolation` event an issue is built from. */
export type CspViolationReport = Pick<
  SecurityPolicyViolationEvent,
  | 'blockedURI'
  | 'columnNumber'
  | 'disposition'
  | 'effectiveDirective'
  | 'lineNumber'
  | 'sample'
  | 'sourceFile'
>;

/** The disposition of a violation the report-only policy raised — never one it blocked. */
const REPORT_ONLY = 'report';

/** The directive a Trusted Types sink violation names. */
const TRUSTED_TYPES_DIRECTIVE = 'require-trusted-types-for';

function isExtension(uri: string): boolean {
  return EXTENSION_SCHEMES.some((scheme) => uri.startsWith(scheme));
}

/** What was blocked, as an issue may say it: a keyword as is, a URL's origin (a `data:` or `blob:` one, its scheme) — never its path or query. */
function blockedOf(uri: string): string {
  if (BLOCKED_KEYWORDS.has(uri)) return uri;
  try {
    const url = new URL(uri);
    return url.origin === 'null' ? url.protocol : url.origin;
  } catch {
    return 'unknown';
  }
}

/**
 * Whether `report` is one of the measured MapLibre baseline's: report-only,
 * a Trusted Types sink, and one of its three samples
 * ({@link MAPLIBRE_REPORT_ONLY_SINKS}). Never read off the script that
 * tripped it — a production chunk's name is hashed, and its content is the
 * smoke's to read, not the page's.
 */
function isMapLibreBaseline(report: CspViolationReport): boolean {
  return (
    report.disposition === REPORT_ONLY &&
    report.effectiveDirective === TRUSTED_TYPES_DIRECTIVE &&
    MAPLIBRE_REPORT_ONLY_SINKS.some((sink) => sink.test(report.sample))
  );
}

/**
 * A Content Security Policy violation as a `CSP_VIOLATION` issue (OR-30) —
 * the effective directive as its name, `<disposition> <what was blocked>`
 * as its message (`enforce https://evil.example`, `report
 * trusted-types-sink`), the script that tripped it as its frame — or `null`
 * for a violation a browser extension raised in the page (its code is not
 * this app's, and neither is the fix), and for one of the measured MapLibre
 * baseline's (every map render trips them; reported, they would spend the
 * shared issue throttle on known noise). An enforced violation, and any
 * other report-only one, is always an issue.
 */
export function cspViolationIssue(
  report: CspViolationReport,
  routePattern: string | null,
): ClientIssue | null {
  if (isExtension(report.sourceFile) || isExtension(report.blockedURI)) {
    return null;
  }
  if (isMapLibreBaseline(report)) return null;
  return ClientIssueSystem.compose({
    clientIssueKind: ClientIssueKind.CspViolation,
    errorName: textOrNull(report.effectiveDirective),
    documentPath: null,
    fieldName: null,
    routePattern,
    topFrame:
      report.sourceFile === ''
        ? null
        : `${report.sourceFile}:${report.lineNumber}:${report.columnNumber}`,
    message: `${report.disposition} ${blockedOf(report.blockedURI)}`,
    release: null,
  });
}

/**
 * The route the router stands on, as its PATTERN — the `path` of every
 * route config from the root down (`/staff/schedule`, `/account/:id`),
 * never the URL, whose ids and query are the person's. `null` before the
 * first navigation has landed.
 */
export function routePatternOf(router: Router): string | null {
  if (!router.navigated) return null;
  const parts: string[] = [];
  let route: ActivatedRouteSnapshot | null = router.routerState.snapshot.root;
  while (route !== null) {
    const path = route.routeConfig?.path;
    if (path) parts.push(path);
    route = route.firstChild;
  }
  return `/${parts.join('/')}`;
}

/**
 * The web app's `ErrorHandler` (OR-34): every error is printed exactly as
 * Angular's default prints it (`console.error('ERROR', error)`), then
 * classified ({@link errorIssue}) and handed to the page's issue reporter,
 * which batches it to the first-party `reportClientIssues` callable.
 *
 * Whether an error is an unhandled rejection is not in what Angular hands
 * over (its global listener passes the bare `reason`), so a capture
 * listener on the window — at the target, capture listeners run before
 * Angular's own — notes the reason the moment before; the next error that
 * IS that reason is the rejection.
 *
 * It never reports itself: a fault while classifying or reporting — or an
 * error raised while a report is under way — ends here.
 */
@Injectable()
export class ReportingErrorHandler extends ErrorHandler {
  private readonly issues = inject(CLIENT_ISSUE_REPORTER);
  private readonly injector = inject(Injector);
  /** The rejection being handed over right now, if one is. */
  private rejection: { readonly reason: unknown } | null = null;
  private reporting = false;

  constructor() {
    super();
    const view = inject(DOCUMENT).defaultView;
    if (view === null) return;
    const note = (event: PromiseRejectionEvent) => {
      this.rejection = { reason: event.reason };
    };
    view.addEventListener('unhandledrejection', note, { capture: true });
    inject(DestroyRef).onDestroy(() =>
      view.removeEventListener('unhandledrejection', note, { capture: true }),
    );
  }

  override handleError(error: unknown): void {
    super.handleError(error);
    const rejected =
      this.rejection !== null && Object.is(this.rejection.reason, error);
    this.rejection = null;
    if (this.reporting) return;
    this.reporting = true;
    try {
      this.issues.reportClientIssues([
        errorIssue(error, rejected, this.routePattern()),
      ]);
    } catch {
      // A reporter never reports itself: a fault here ends here.
    } finally {
      this.reporting = false;
    }
  }

  /** The route's pattern — read off the router only when one is there to read. */
  private routePattern(): string | null {
    const router = this.injector.get(Router, null);
    return router === null ? null : routePatternOf(router);
  }
}
