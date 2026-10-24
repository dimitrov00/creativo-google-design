#!/usr/bin/env node
/**
 * Waits for the function triggers to finish: no trigger running or starting,
 * and the projections they maintain (client stats and their restricted
 * money halves, the busy and capacity rebuilds) and the audit log
 * unchanged, for a quiet window.
 *
 * A seed returns long before its writes have been processed: the dev seed's
 * client book sets off some five hundred trigger runs that start after it
 * exits and go on for another ten seconds or so, loading every emulator on
 * the machine. Whatever reads or writes next — a proof comparing two seeds,
 * a browser suite on the Storage emulator — has to start on a quiet hub.
 *
 * WHY BOTH SIGNALS. The data alone is not enough: measured on 2026-09-25,
 * the projections held still for six seconds in the middle of a storm while
 * `dispatchClientProjections` ran over a hundred times and wrote nothing
 * (the seed had already written the answer), and the busy rebuilds only
 * began after that — a five-second window on the data alone declared the
 * hub quiet before most of the storm. The functions emulator logs every
 * execution's start and finish to the Logging emulator, and across the same
 * storm those never paused for more than about half a second; so an
 * execution in flight, or one begun or finished inside the window, keeps
 * the window open.
 *
 * NO LOGGING EMULATOR, NO SETTLE. Without one the wait REFUSES, because a
 * wait on the data alone is the defect above. `--only` cannot name the
 * Logging emulator; firebase-tools means to start it only with the Emulator
 * UI (`--ui`; this workspace's `firebase.json` turns the UI off otherwise)
 * or with `START_LOGGING_EMULATOR=true` in its environment
 * (`lib/emulator/controller.js`). In the workspace's pinned CLI (15.31.0,
 * as in 15.11 before it) it in fact starts on every emulator start that
 * leaves the variable unset: it is read with
 * `envOverride(…, "false", …)`, whose default, used as is, is the STRING
 * "false" — truthy (`lib/utils.js`); only an explicit
 * `START_LOGGING_EMULATOR=false` turns it off. That is why `verify:p0`
 * passed with no variable set. It is a defect, not a contract, so nothing
 * here leans on it:
 * `pnpm run dev` passes `--ui`, and the two scripts that settle under
 * `emulators:exec` — `e2e:web` and `verify:p0` — set
 * `START_LOGGING_EMULATOR=true` themselves (`settle-scripts.spec.mjs` holds
 * every script that starts the functions emulator to one of the two). A
 * caller that knowingly accepts the data alone says so:
 * `allowDataOnly: true`, or `--allow-data-only`.
 *
 * WHAT IS IN FLIGHT. The Logging emulator replays its whole history to a
 * new connection, so an execution that began before the watch connected
 * and is still running is seen — in flight, though not counted as a change
 * (only what is logged from `sinceMs` on moves the answer).
 *
 * A TRIGGER THAT DIED is not a busy hub. The functions emulator logs
 * 'Finished' only when the request completes; when it kills a worker or the
 * request to it fails, it logs why instead — `Request to function failed`,
 * `Your function timed out…`, `Your function was killed…` (firebase-tools'
 * `lib/emulator/functionsRuntimeWorker.js`, `emulatorLogger.js`). The first
 * closes the execution, so the wait goes on without it; every one of them
 * since `sinceMs` is REPORTED, by function and cause, when the wait ends.
 * Reported, not refused: in the emulator EVERY error a trigger throws kills
 * its worker (`functionsEmulatorRuntime.js` logs it FATAL), the transient
 * ones a `retry: true` trigger throws on purpose included, and the emulator
 * never re-delivers them. Whether the lost run mattered — the seed writes
 * the same stats in-process, so a stats trigger that lost that race left
 * nothing missing — is for the checks after the settle to say, with the
 * cause printed above them.
 *
 * AN EXECUTION THAT NEVER ENDS is refused as LOST. The functions emulator
 * holds each execution to its trigger's own declared timeout (60 s when it
 * declares none) and logs both the timeout and the failed request that ends
 * it (`functionsRuntimeWorker.js`); an execution still in flight `graceMs`
 * past that timeout, with neither line, went down with its worker unlogged.
 * It is named, with its age and its timeout, rather than waited out to
 * `timeoutMs` as "busy". The timeouts are the emulator's own listing of the
 * triggers (`GET /backends` on the functions emulator), so a function that
 * declares 540 s — the policy recompute's step, the backfill run — is given
 * its 540 s and no caller passes a limit; a trigger the listing does not
 * name is never called lost. `timeoutMs` still bounds the whole wait: a
 * long run still going then is refused as still running, with its age and
 * its timeout. (Under `--inspect-functions` the emulator lifts every
 * timeout, so a function held at a breakpoint reads as lost: do not settle
 * while debugging one.)
 *
 * ONE copy, two doors:
 *
 *   - in process, with the caller's Firestore:
 *       import { settleTriggers } from '../../seed/settle.mjs';
 *       const sinceMs = Date.now();
 *       // … the seed or backfill that sets the triggers off …
 *       await settleTriggers(db, { sinceMs });
 *     (`tools/verify/p0/verify-p0.mjs`, between its seeds and backfills,
 *     each settle counted from the instant its step began);
 *   - as a CLI, against the emulators the environment names:
 *       node tools/seed/settle.mjs [--since=<epoch ms>] [--allow-data-only]
 *     (the e2e suite's `apps/web/e2e/support/global-setup.ts`, which is
 *     `scope:web` and may not import tooling, so it spawns this instead,
 *     with `--since` the instant its seed began: a trigger that died
 *     between the seed and the settle is still reported).
 *
 * Emulator-only by construction, like the seed: the CLI refuses to run
 * unless FIRESTORE_EMULATOR_HOST points at this machine.
 */
import { pathToFileURL } from 'node:url';

const PROJECT_ID = 'demo-creativo-test';

/**
 * Five seconds without a write or an execution, polled every 750 ms, for at
 * most three minutes; an execution still in flight thirty seconds past its
 * own declared timeout is lost.
 */
export const SETTLE_DEFAULTS = Object.freeze({
  quietMs: 5_000,
  timeoutMs: 180_000,
  pollMs: 750,
  graceMs: 30_000,
});

/** Whole seconds, for a message. */
const seconds = (ms) => Math.round(ms / 1_000);

const SYSTEM_CLOCK = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** `emulators:exec` may hand over the 0.0.0.0 bind address; connect locally. */
const local = (host) => host.replace('0.0.0.0', '127.0.0.1');

/**
 * Everything the triggers write, as one string: each projection document's
 * path and update time, and the audit log's size. Two equal answers mean
 * nothing was written in between.
 */
export async function triggerFingerprint(db) {
  const [stats, money, busy, capacity, audit] = await Promise.all([
    db.collection('clientStats').get(),
    db.collectionGroup('restricted').get(),
    db.collection('barberBusy').get(),
    db.collection('capacity').get(),
    db.collection('auditLog').count().get(),
  ]);
  return [stats, money, busy, capacity]
    .flatMap((snapshot) =>
      snapshot.docs.map(
        (doc) => `${doc.ref.path}@${doc.updateTime.toMillis()}`,
      ),
    )
    .concat(`audit=${audit.data().count}`)
    .join('|');
}

/**
 * Resolves once `read` has answered the same for `quietMs`, with the
 * milliseconds it waited; rejects once `timeoutMs` has passed without such a
 * window. A `null` answer means "busy": it never counts as quiet and opens
 * the window afresh. `describeBusy` adds what is still going on to the
 * refusal; `clock` is the seam a unit test drives.
 */
export async function waitForQuiet(read, options = {}) {
  const { quietMs, timeoutMs, pollMs } = { ...SETTLE_DEFAULTS, ...options };
  const clock = options.clock ?? SYSTEM_CLOCK;
  const start = clock.now();
  let last = await read();
  let quietSince = clock.now();
  while (last === null || clock.now() - quietSince < quietMs) {
    if (clock.now() - start > timeoutMs) {
      const busy = options.describeBusy?.();
      throw new Error(
        `the emulators never went quiet within ${timeoutMs} ms${busy ? ` (${busy})` : ''}`,
      );
    }
    await clock.sleep(pollMs);
    const next = await read();
    if (next === null || next !== last) {
      last = next;
      quietSince = clock.now();
    }
  }
  return clock.now() - start;
}

const BEGUN = /^Beginning execution of "([^"]+)"/;
const FINISHED = /^Finished "([^"]+)"/;

/**
 * The functions emulator's words for an execution that ends without
 * finishing. `ends`: the line closes the execution (the request failed and
 * was answered with a 500); the others say why it is about to close — a
 * timeout or a kill is followed by the line that does close it (the failed
 * request, or a 'Finished' when the answer had begun), so counting them as
 * ends too would close a sibling execution of the same trigger.
 */
const FAILURES = Object.freeze([
  { pattern: /^Request to function failed/, ends: true },
  { pattern: /^Your function timed out/, ends: false },
  { pattern: /^Your function was killed/, ends: false },
]);

/**
 * The functions emulator's executions, from the Logging emulator's stream:
 * which are in flight (from everything it is fed, the replayed history
 * included), and how many have begun, finished or failed since `sinceMs`,
 * and which failed. Pure; {@link watchExecutions} feeds it. A closure over
 * its counters, read through its functions.
 */
export function createExecutionTally(sinceMs) {
  /** Log entries about an execution, begun, finished or failed, since `sinceMs`. */
  let events = 0;
  /** triggerKey → when each of its executions in flight began, oldest first. */
  const running = new Map();
  /** Executions the emulator ended without a 'Finished' since `sinceMs`. */
  const failures = [];

  /**
   * The log does not say WHICH of a trigger's executions ended, so the
   * oldest is retired: an age is then never overstated, and one execution
   * that hangs among busy siblings is still caught once they stop.
   */
  const end = (trigger) => {
    const [, ...left] = running.get(trigger) ?? [];
    if (left.length > 0) running.set(trigger, left);
    else running.delete(trigger);
  };

  return {
    /** One Logging-emulator bundle (`{ timestamp, message, data }`). */
    record(bundle) {
      if (typeof bundle?.timestamp !== 'number') return;
      const at = bundle.timestamp;
      const recent = at >= sinceMs;
      const message = String(bundle.message ?? '');
      const begun = BEGUN.exec(message);
      if (begun) {
        if (recent) events += 1;
        running.set(begun[1], [...(running.get(begun[1]) ?? []), at]);
        return;
      }
      const finished = FINISHED.exec(message);
      if (finished) {
        if (recent) events += 1;
        end(finished[1]);
        return;
      }
      const failure = FAILURES.find(({ pattern }) => pattern.test(message));
      if (failure === undefined) return;
      // The emulator's per-function logger names the function in the metadata.
      const name = bundle.data?.metadata?.function?.name;
      const trigger = typeof name === 'string' && name !== '' ? name : null;
      if (failure.ends && trigger !== null) end(trigger);
      if (!recent) return;
      if (failure.ends) events += 1;
      failures.push({ trigger, atMs: at, cause: message.split('\n')[0] });
    },

    /** Log entries about an execution, begun, finished or failed, since `sinceMs`. */
    events() {
      return events;
    },

    /** The triggers with an execution in flight, sorted. */
    running() {
      return [...running.keys()].sort();
    },

    /**
     * Each trigger with an execution in flight at `nowMs`, and how long its
     * oldest has been, sorted by trigger.
     */
    inFlight(nowMs) {
      return [...running.entries()]
        .map(([trigger, [oldest]]) => ({ trigger, forMs: nowMs - oldest }))
        .sort((a, b) => (a.trigger < b.trigger ? -1 : 1));
    },

    /**
     * What the emulator logged, since `sinceMs`, about an execution it ended
     * without finishing: `{ trigger, atMs, cause }`, `trigger` `null` when the
     * line named none; in the order logged.
     */
    failures() {
      return [...failures];
    },
  };
}

/**
 * The executions the emulator ended without finishing, as one warning that
 * names each function and cause once; `null` when there were none.
 */
export function describeFailures(failures) {
  if (failures.length === 0) return null;
  const causes = [
    ...new Set(
      failures.map(
        ({ trigger, cause }) =>
          `${trigger === null ? 'a function' : `"${trigger}"`}: ${cause}`,
      ),
    ),
  ];
  return `settle: ${failures.length} trigger execution(s) ended without finishing, and the emulator never retries them — what they were writing may be missing (${causes.join('; ')})`;
}

/**
 * Each trigger's own timeout in ms, by the id its execution lines name, from
 * the functions emulator's listing (`GET /backends`: `{ backends: [{
 * functionTriggers: [{ id, timeoutSeconds }] }] }`, the timeout already
 * defaulted to the 60 s the emulator enforces when a function declares
 * none). A trigger without a positive timeout there is left out: the
 * emulator holds it to none, so it is never called lost.
 */
export function timeoutsFromBackends(listing) {
  const triggers = (listing?.backends ?? []).flatMap(
    (backend) => backend?.functionTriggers ?? [],
  );
  return new Map(
    triggers
      .filter(
        ({ id, timeoutSeconds }) =>
          typeof id === 'string' &&
          Number.isFinite(timeoutSeconds) &&
          timeoutSeconds > 0,
      )
      .map(({ id, timeoutSeconds }) => [id, timeoutSeconds * 1_000]),
  );
}

/**
 * The executions in flight past their trigger's declared timeout by
 * `graceMs` or more at `nowMs`, each with its age and its timeout: the
 * emulator ends a timed-out execution itself, and logs it, so these were
 * lost unlogged. A trigger `timeouts` does not name is never among them.
 */
export function lostExecutions(tally, timeouts, nowMs, graceMs) {
  return tally
    .inFlight(nowMs)
    .filter(
      ({ trigger, forMs }) =>
        timeouts.has(trigger) && forMs >= timeouts.get(trigger) + graceMs,
    )
    .map((execution) => ({
      ...execution,
      timeoutMs: timeouts.get(execution.trigger),
    }));
}

/** Refuses, naming each function, when {@link lostExecutions} names any. */
function refuseLostExecutions({ tally, timeouts }, nowMs, graceMs) {
  const lost = lostExecutions(tally, timeouts, nowMs, graceMs);
  if (lost.length > 0) {
    const named = lost.map(
      ({ trigger, forMs, timeoutMs }) =>
        `"${trigger}" in flight for ${seconds(forMs)} s, past its own ${seconds(timeoutMs)} s timeout`,
    );
    throw new Error(
      `a trigger execution outlived its timeout without the functions emulator ending it (${named.join('; ')}): the emulator ends and logs a timed-out execution itself, so this one was lost with its worker, unlogged — restart the emulators`,
    );
  }
}

/** What is still in flight, for a refusal: each trigger, its age and its timeout. */
function describeRunning({ tally, timeouts }, nowMs) {
  const running = tally.inFlight(nowMs).map(({ trigger, forMs }) => {
    const timeoutMs = timeouts.get(trigger);
    const of = timeoutMs === undefined ? '' : ` of its ${seconds(timeoutMs)} s`;
    return `${trigger} (${seconds(forMs)} s${of})`;
  });
  return running.length > 0
    ? `still running: ${running.join(', ')} — busy, or ended in a way the functions emulator did not log`
    : '';
}

/**
 * Streams the functions emulator's executions into a tally
 * ({@link createExecutionTally}) — the Logging emulator's replayed history
 * first, so what is already in flight is seen — with each trigger's declared timeout
 * ({@link timeoutsFromBackends}; none known when the listing cannot be
 * read); or answers `null` when no Logging emulator can be reached (the hub
 * named by FIREBASE_EMULATOR_HUB, 127.0.0.1:4400 by default, lists where
 * each emulator runs). Only what is logged from `sinceMs` on counts as a
 * change.
 */
export async function watchExecutions({ sinceMs = Date.now() } = {}) {
  const hub = local(process.env.FIREBASE_EMULATOR_HUB ?? '127.0.0.1:4400');
  const tally = createExecutionTally(sinceMs);
  let socket;
  let emulators;
  try {
    emulators = await (
      await fetch(`http://${hub}/emulators`, {
        signal: AbortSignal.timeout(2_000),
      })
    ).json();
    const logging = emulators?.logging;
    if (!logging?.port) return null;
    socket = new WebSocket(
      `ws://${local(logging.host ?? '127.0.0.1')}:${logging.port}`,
    );
    // Listening before the socket opens: the replay follows the handshake.
    socket.addEventListener('message', (event) => {
      try {
        tally.record(JSON.parse(String(event.data)));
      } catch {
        // Not a log bundle; nothing to count.
      }
    });
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
  } catch {
    socket?.close();
    return null;
  }
  const timeouts = await readDeclaredTimeouts(emulators?.functions);
  return { tally, timeouts, close: () => socket.close() };
}

/** {@link timeoutsFromBackends} off the functions emulator; empty on any failure. */
async function readDeclaredTimeouts(functions) {
  if (!functions?.port) return new Map();
  try {
    const response = await fetch(
      `http://${local(functions.host ?? '127.0.0.1')}:${functions.port}/backends`,
      { signal: AbortSignal.timeout(2_000) },
    );
    return timeoutsFromBackends(await response.json());
  } catch {
    return new Map();
  }
}

/** Why a settle without a Logging emulator refuses (see the header). */
export const NO_LOGGING_EMULATOR =
  'no Logging emulator on the emulator hub to watch trigger executions on, and the data alone once called a trigger storm quiet: start the emulators with START_LOGGING_EMULATOR=true in their environment (or with --ui), or accept the data-only wait knowingly with --allow-data-only (allowDataOnly: true in process)';

/**
 * {@link waitForQuiet} over {@link triggerFingerprint} and the functions
 * emulator's executions: an execution in flight reads as busy, one begun,
 * finished or failed changes the answer, one past its own timeout by
 * `graceMs` refuses as lost, and the ones that died are warned about by name
 * when the wait ends (see the header). Resolves with the milliseconds waited.
 * Refuses at once with no Logging emulator, unless `allowDataOnly`.
 *
 * `options` are {@link SETTLE_DEFAULTS}' and `clock` (as for
 * {@link waitForQuiet}), `sinceMs` (what counts as new; the start of the
 * wait by default), `allowDataOnly`, and `watch` — `{ tally, timeouts,
 * close }` as {@link watchExecutions} answers it, or `null` for no Logging
 * emulator — the seam a unit test drives; left out, the emulators are
 * watched.
 */
export async function settleTriggers(db, options = {}) {
  const { watch: given, sinceMs, allowDataOnly = false, ...rest } = options;
  const settings = { ...SETTLE_DEFAULTS, ...rest };
  const clock = settings.clock ?? SYSTEM_CLOCK;
  const watch =
    'watch' in options
      ? given
      : await watchExecutions({ sinceMs: sinceMs ?? clock.now() });
  if (watch === null) {
    if (!allowDataOnly) throw new Error(NO_LOGGING_EMULATOR);
    console.warn(
      'settle: no Logging emulator, and the data-only wait allowed: waiting on the projections alone, which can call a trigger storm quiet',
    );
  }
  try {
    return await waitForQuiet(
      async () => {
        const fingerprint = await triggerFingerprint(db);
        if (watch === null) return fingerprint;
        refuseLostExecutions(watch, clock.now(), settings.graceMs);
        if (watch.tally.running().length > 0) return null;
        return `${fingerprint}|executions=${watch.tally.events()}`;
      },
      {
        ...settings,
        clock,
        describeBusy: () =>
          watch === null ? '' : describeRunning(watch, clock.now()),
      },
    );
  } finally {
    const failed = watch && describeFailures(watch.tally.failures());
    if (failed) console.warn(failed);
    watch?.close();
  }
}

/**
 * The CLI's flags — `--since=<epoch ms>` and `--allow-data-only` — as
 * {@link settleTriggers} options; refuses anything else, so a misspelt flag
 * is never silently a different wait.
 */
export function optionsFromArgv(argv) {
  const options = { sinceMs: undefined, allowDataOnly: false };
  for (const arg of argv) {
    if (arg === '--allow-data-only') {
      options.allowDataOnly = true;
    } else if (arg.startsWith('--since=')) {
      const value = arg.slice('--since='.length);
      const sinceMs = /^\d+$/.test(value) ? Number(value) : Number.NaN;
      if (!Number.isSafeInteger(sinceMs)) {
        throw new Error(`--since takes epoch milliseconds, not "${value}"`);
      }
      options.sinceMs = sinceMs;
    } else {
      throw new Error(
        `unknown argument "${arg}" (takes --since=<epoch ms> and --allow-data-only)`,
      );
    }
  }
  return options;
}

async function main() {
  process.env.FIRESTORE_EMULATOR_HOST = local(
    process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080',
  );
  if (!process.env.FIRESTORE_EMULATOR_HOST.includes('127.0.0.1')) {
    console.error('Refusing to run outside the local emulators.');
    process.exit(1);
  }
  const options = optionsFromArgv(process.argv.slice(2));
  const { default: admin } = await import('firebase-admin');
  const app = admin.initializeApp({ projectId: PROJECT_ID });
  try {
    const waited = await settleTriggers(admin.firestore(app), options);
    console.log(
      `settled: no trigger ran or wrote for ${SETTLE_DEFAULTS.quietMs} ms (waited ${waited} ms)`,
    );
  } finally {
    await app.delete();
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(`settle: ${error.message}`);
    process.exit(1);
  });
}
