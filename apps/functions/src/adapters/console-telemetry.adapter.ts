import { logger } from 'firebase-functions';
import type { Log, TelemetryPorts } from '@creativo/ecs-core';

/**
 * The telemetry ports (`telemetry.port.ts`) over `firebase-functions/logger`
 * — §9 D11(a): Pino and Sentry are not installed, so logging and error
 * tracking are structured Cloud Logging entries. A Pino or Sentry adapter
 * replaces this file at the composition root with the same two ports; no
 * pipeline changes.
 *
 * Structured: `fields` / `context` ride as the entry's `jsonPayload` (the
 * logger takes a trailing PLAIN object as the payload, so they are copied
 * into one), the message stays the bare `msg`. An `Error` is logged as
 * itself, so its stack reaches the entry and Error Reporting groups it.
 */

/** The slice of `firebase-functions/logger` this adapter writes through. */
export type LogSink = {
  readonly info: (...args: unknown[]) => void;
  readonly warn: (...args: unknown[]) => void;
  readonly error: (...args: unknown[]) => void;
};

/** A thrown value that is not an `Error`, rendered for the log line. */
function describe(thrown: unknown): string {
  if (typeof thrown === 'string') return thrown;
  try {
    return JSON.stringify(thrown) ?? String(thrown);
  } catch {
    return String(thrown);
  }
}

/** The sink's writer for a `Log` level — `info`, `warn` or `error`, one to one. */
function writerFor(
  sink: LogSink,
  level: Parameters<Log>[0],
): (...args: unknown[]) => void {
  switch (level) {
    case 'info':
      return sink.info;
    case 'warn':
      return sink.warn;
    case 'error':
      return sink.error;
  }
}

export const consoleTelemetry = (sink: LogSink = logger): TelemetryPorts => ({
  log: (level, msg, fields) => {
    const write = writerFor(sink, level);
    if (fields === undefined) write(msg);
    else write(msg, { ...fields });
  },
  trackError: (error, context) => {
    if (error instanceof Error) sink.error(error, { ...context });
    else
      sink.error('non-error thrown', { ...context, thrown: describe(error) });
  },
});
