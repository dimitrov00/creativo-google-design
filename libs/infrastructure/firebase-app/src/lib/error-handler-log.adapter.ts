import type { ErrorHandler } from '@angular/core';
import type { LogPorts } from '@core/ports';

/** The `name` of the error a data-layer log line is reported under — the console line's word. */
export const DATA_LOG_ERROR = 'DataLog';

/**
 * The web data layer's `LogPorts` over Angular's `ErrorHandler` (edge
 * hardening D-4) — the one reporting channel the data layer already uses
 * (`lazy-port.ts` reports a failed chunk load the same way). Each
 * `log(level, msg, fields)` becomes ONE `handler.handleError(error)` of a
 * plain `Error` (never a subclass, Law 7.5) named {@link DATA_LOG_ERROR},
 * its message `msg` and its `cause` a copy of `fields` (`{ path, field }`
 * for a refused or dropped stored document).
 *
 * What it reaches: the web's `ReportingErrorHandler` prints it with
 * `console.error`, as Angular's default did, and forwards it to the
 * first-party `reportClientIssues` sink as a `DATA_DOCUMENT_DROPPED` /
 * `DATA_DOCUMENT_REFUSED` issue — scrubbed, never the document (OR-34). No
 * read rule relies on the report to make a hidden document visible (the
 * staff day counts what it drops itself, OR-2). The level is not carried —
 * every line this port reports today is an `'error'`.
 *
 * A logger must never break the read it reports on: a handler that throws
 * is swallowed here.
 */
export function errorHandlerLogPorts(handler: ErrorHandler): LogPorts {
  return {
    log: (_level, msg, fields) => {
      const error = new Error(msg, { cause: { ...fields } });
      error.name = DATA_LOG_ERROR;
      try {
        handler.handleError(error);
      } catch {
        // The report is best-effort; the data path goes on.
      }
    },
  };
}
