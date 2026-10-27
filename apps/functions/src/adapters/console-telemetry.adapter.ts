import { AsyncLocalStorage } from 'node:async_hooks';
import { logger } from 'firebase-functions';
import type {
  Log,
  LogContext,
  LogContextPorts,
  TelemetryPorts,
} from '@core/ports';
import { ClientIssueSystem } from '@core/systems';

/**
 * The telemetry ports (`telemetry.port.ts`) over `firebase-functions/logger`
 * — §9 D11(a): Pino and Sentry are not installed, so logging and error
 * tracking are structured Cloud Logging entries. A Pino or Sentry adapter
 * replaces this file at the composition root with the same bundles
 * (`TelemetryPorts`, `LogContextPorts`); no pipeline changes.
 *
 * Structured: `fields` / `context` ride as the entry's `jsonPayload` (the
 * logger takes a trailing PLAIN object as the payload, so they are copied
 * into one), the message stays the bare `msg`. An `Error` is logged as
 * itself, so its stack reaches the entry and Error Reporting groups it.
 *
 * A web client's error line (OR-34 — the fields typed as Error Reporting's
 * `ReportedErrorEvent`, `ClientIssueSystem.REPORTED_ERROR_EVENT`) is written
 * as a whole entry: the logger's `error` would replace an ERROR message
 * that carries no `Error` with the SERVER's own stack, and every client
 * error would collapse into one group. Its message is already the client's
 * one-frame stack. It never gets the invocation's scope: the sink is
 * untraced (RU-24 — OR-34's privacy by shape, no uid).
 *
 * **The invocation's scope (audit-hardening WS-4.2, RU-26).**
 * {@link consoleLogContext} binds the correlation fields of ONE invocation
 * (`callable`, `operationId`, `uid`, `roles`, later `inputDigest`) in a
 * module `AsyncLocalStorage` (`node:async_hooks`, a Node built-in — no
 * dependency, and nothing of it reaches the core); every `log` and
 * `trackError` written inside the scope carries them UNDER its own fields
 * (the call's fields win a name both hold). Two interleaved invocations
 * never see each other's scope.
 *
 * **An `Error` in the fields (WS-4.6, RU-38).** The logger would serialise
 * an `Error` value as `{}`; each top-level `Error` value of `fields` /
 * `context` is written as `{ name, code, message, stack }` instead — its
 * message through `ClientIssueSystem.scrub` and its stack rebuilt as
 * `<name>: <scrubbed message>` plus each frame line through
 * `ClientIssueSystem.frame` (the existing pure masks, reused): a provider's
 * message can embed a phone number or an e-mail, which never enters a log
 * line (R36 / T5).
 */

/** The slice of `firebase-functions/logger` this adapter writes through. */
export type LogSink = {
  readonly info: (...args: unknown[]) => void;
  readonly warn: (...args: unknown[]) => void;
  readonly error: (...args: unknown[]) => void;
  /** One whole structured ERROR entry, written as given (`logger.write`). */
  readonly write: (entry: {
    readonly severity: 'ERROR';
    readonly message: string;
    readonly [key: string]: unknown;
  }) => void;
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

/**
 * The ONE scope store of this process — module state, like the logger
 * itself: {@link consoleLogContext} binds into it, {@link consoleTelemetry}
 * reads it. A store is a fresh object per bind, so an `add` changes only
 * its own invocation's scope.
 */
const scopes = new AsyncLocalStorage<Record<string, unknown>>();

/** A stack's frame line: optional indentation, then `at `. */
const FRAME_LINE = /^\s*at\s/;

/** An `Error`'s `code`, when it carries a string or a number — else `null`. */
function codeOfError(error: Error): string | number | null {
  const code = Object.getOwnPropertyDescriptor(error, 'code')?.value;
  if (typeof code === 'number') return code;
  return typeof code === 'string' ? ClientIssueSystem.scrub(code) : null;
}

/**
 * An `Error` as a log field (RU-38): `{ name, code, message, stack }` — the
 * message scrubbed, the stack's head rewritten as `<name>: <scrubbed
 * message>` and every frame line kept only through `ClientIssueSystem.frame`
 * (any other stack line — a message's own continuation — is dropped).
 */
function errorField(error: Error): {
  readonly name: string;
  readonly code: string | number | null;
  readonly message: string;
  readonly stack: string;
} {
  const name = ClientIssueSystem.scrub(error.name);
  const message = ClientIssueSystem.scrub(error.message);
  const lines = [`${name}: ${message}`];
  for (const line of (error.stack ?? '').split('\n')) {
    if (FRAME_LINE.test(line)) {
      lines.push(`    at ${ClientIssueSystem.frame(line)}`);
    }
  }
  return { name, code: codeOfError(error), message, stack: lines.join('\n') };
}

/**
 * The fields a line is written with: the scope's UNDER the call's own, and
 * each top-level `Error` value normalised ({@link errorField}). A new plain
 * object — never the caller's.
 */
function withScope(
  own: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const scope = scopes.getStore();
  if (own === undefined && scope === undefined) return undefined;
  return Object.fromEntries(
    Object.entries({ ...scope, ...own }).map(([name, value]) => [
      name,
      value instanceof Error ? errorField(value) : value,
    ]),
  );
}

export const consoleTelemetry = (sink: LogSink = logger): TelemetryPorts => ({
  log: (level, msg, fields) => {
    if (fields?.['@type'] === ClientIssueSystem.REPORTED_ERROR_EVENT) {
      sink.write({ ...fields, severity: 'ERROR', message: msg });
      return;
    }
    const write = writerFor(sink, level);
    const payload = withScope(fields);
    if (payload === undefined) write(msg);
    else write(msg, payload);
  },
  trackError: (error, context) => {
    const payload = withScope(context) ?? {};
    if (error instanceof Error) sink.error(error, payload);
    else
      sink.error('non-error thrown', { ...payload, thrown: describe(error) });
  },
});

/**
 * The per-invocation log scope ({@link LogContextPorts}, WS-4.2): `bind`
 * runs `run` inside a fresh scope holding a copy of `context`; `add` merges
 * fields into the CURRENT scope, and does nothing outside one.
 */
export const consoleLogContext = (): LogContextPorts => ({
  bindLogContext: (context, run) => scopes.run({ ...context }, run),
  addLogContext: (context: LogContext) => {
    const scope = scopes.getStore();
    if (scope !== undefined) Object.assign(scope, context);
  },
});
