/**
 * The one trigger-settle wait (`settle.mjs`) that the e2e suite and the P0
 * proofs share: the quiet-window rule, held for any sequence of answers
 * under a scripted clock; the fingerprint's coverage of every projection
 * the triggers write; the execution tally read off the Logging emulator's
 * stream, with each trigger's declared timeout off the functions emulator's
 * listing; and `settleTriggers`, which answers from the data and the tally
 * TOGETHER — the part a data-only wait gets wrong — and refuses to wait on
 * the data alone unless told it may.
 */
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import fc from 'fast-check';
import {
  createExecutionTally,
  NO_LOGGING_EMULATOR,
  lostExecutions,
  optionsFromArgv,
  settleTriggers,
  timeoutsFromBackends,
  triggerFingerprint,
  waitForQuiet,
  watchExecutions,
} from './settle.mjs';

/**
 * A clock that moves only when slept on, and a `read` that answers `values`
 * in order (the last one for good once they run out), logging each answer
 * with the instant it was read.
 */
function scripted(values) {
  let now = 0;
  let index = 0;
  const log = [];
  return {
    log,
    clock: {
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    },
    read: async () => {
      const value = values[Math.min(index, values.length - 1)];
      index += 1;
      log.push({ at: now, value });
      return value;
    },
  };
}

/**
 * Whether the read at `index` ends a window of `quietMs` with one answer.
 * `null` is "busy": it is never part of a quiet window.
 */
function quietAt(log, index, quietMs) {
  if (log[index].value === null) return false;
  let since = index;
  while (since > 0 && log[since - 1].value === log[index].value) since -= 1;
  return log[index].at - log[since].at >= quietMs;
}

describe('waitForQuiet', () => {
  it('resolves once one answer has held for the quiet window', async () => {
    const { clock, read, log } = scripted(['a', 'b', 'b', 'c']);
    const waited = await waitForQuiet(read, {
      clock,
      quietMs: 2_000,
      pollMs: 1_000,
      timeoutMs: 60_000,
    });
    // 'c' first answered at 3 s, then held at 4 s and 5 s.
    expect(waited).toBe(5_000);
    expect(log.map(({ value }) => value)).toEqual([
      'a',
      'b',
      'b',
      'c',
      'c',
      'c',
    ]);
  });

  it('a change restarts the window rather than extending it', async () => {
    const { clock, read } = scripted(['a', 'a', 'b', 'b', 'b']);
    const waited = await waitForQuiet(read, {
      clock,
      quietMs: 2_000,
      pollMs: 1_000,
      timeoutMs: 60_000,
    });
    // 'a' held for 1 s only; 'b' from 2 s to 4 s.
    expect(waited).toBe(4_000);
  });

  it('refuses once the timeout passes without a quiet window', async () => {
    const { clock, read } = scripted(
      Array.from({ length: 100 }, (_, i) => String(i)),
    );
    await expect(
      waitForQuiet(read, {
        clock,
        quietMs: 2_000,
        pollMs: 1_000,
        timeoutMs: 10_000,
      }),
    ).rejects.toThrow('the emulators never went quiet within 10000 ms');
  });

  it('a busy answer holds the window open however long it lasts', async () => {
    const { clock, read } = scripted(['a', null, null, null, 'a', 'a', 'a']);
    const waited = await waitForQuiet(read, {
      clock,
      quietMs: 2_000,
      pollMs: 1_000,
      timeoutMs: 60_000,
    });
    // Busy from 1 s to 3 s; 'a' again from 4 s, held to 6 s.
    expect(waited).toBe(6_000);
  });

  it('names what is still busy when it refuses', async () => {
    const { clock, read } = scripted([null]);
    await expect(
      waitForQuiet(read, {
        clock,
        quietMs: 2_000,
        pollMs: 1_000,
        timeoutMs: 5_000,
        describeBusy: () => 'still running: us-central1-x',
      }),
    ).rejects.toThrow(
      'the emulators never went quiet within 5000 ms (still running: us-central1-x)',
    );
  });

  it('ends at the FIRST quiet window, or refuses only past the timeout', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.oneof(fc.integer({ min: 0, max: 2 }), fc.constant(null)), {
          minLength: 1,
          maxLength: 40,
        }),
        fc.integer({ min: 50, max: 1_000 }),
        fc.integer({ min: 1, max: 5_000 }),
        fc.integer({ min: 0, max: 20_000 }),
        async (values, pollMs, quietMs, timeoutMs) => {
          const { clock, read, log } = scripted(values);
          const options = { clock, pollMs, quietMs, timeoutMs };
          const outcome = await waitForQuiet(read, options).then(
            (waited) => ({ waited }),
            (error) => ({ error }),
          );
          const last = log.length - 1;
          const quietEarlier = log
            .slice(0, last)
            .some((_, index) => quietAt(log, index, quietMs));
          expect(quietEarlier).toBe(false);
          if ('waited' in outcome) {
            expect(quietAt(log, last, quietMs)).toBe(true);
            expect(outcome.waited).toBe(log[last].at);
          } else {
            expect(quietAt(log, last, quietMs)).toBe(false);
            expect(clock.now()).toBeGreaterThan(timeoutMs);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

/**
 * A Firestore stand-in holding `{ path: updateMillis }` per watched source;
 * `audit` is the audit log's size, or a function answering it per read.
 */
function fakeDb({ docs, audit }) {
  const snapshot = (source) => ({
    docs: Object.entries(docs[source] ?? {}).map(([path, millis]) => ({
      ref: { path },
      updateTime: { toMillis: () => millis },
    })),
  });
  return {
    collection: (name) => ({
      get: async () => snapshot(name),
      count: () => ({
        get: async () => ({
          data: () => ({
            count: typeof audit === 'function' ? audit() : audit,
          }),
        }),
      }),
    }),
    collectionGroup: (name) => ({
      get: async () => snapshot(`**/${name}`),
    }),
  };
}

const QUIET = {
  audit: 7,
  docs: {
    clientStats: { 'clientStats/u1': 1 },
    '**/restricted': { 'clientStats/u1/restricted/money': 1 },
    barberBusy: { 'barberBusy/ivan__2026-09-25': 1 },
    capacity: { 'capacity/loc-center__2026-09': 1 },
  },
};

/** The Logging emulator's lines about one execution, as it sends them. */
const begin = (trigger, timestamp) => ({
  timestamp,
  message: `Beginning execution of "${trigger}"`,
});
const finish = (trigger, timestamp) => ({
  timestamp,
  message: `Finished "${trigger}" in 6.2ms`,
});
/** A line the emulator's per-function logger writes: the function in the metadata. */
const aboutFunction = (trigger, timestamp, message) => ({
  timestamp,
  level: 'error',
  message,
  data: { metadata: { function: { name: trigger } } },
});
const requestFailed = (trigger, timestamp) =>
  aboutFunction(
    trigger,
    timestamp,
    'Request to function failed: Error: socket hang up',
  );
const timedOut = (trigger, timestamp) =>
  aboutFunction(
    trigger,
    timestamp,
    'Your function timed out after ~60s. To configure this timeout, see\n      https://firebase.google.com/docs/functions/manage-functions#set_timeout_and_memory_allocation.',
  );
const killed = (trigger, timestamp) =>
  aboutFunction(
    trigger,
    timestamp,
    'Your function was killed because it raised an unhandled error.',
  );

describe('triggerFingerprint', () => {
  it('is the same while nothing is written', async () => {
    expect(await triggerFingerprint(fakeDb(QUIET))).toBe(
      await triggerFingerprint(fakeDb(structuredClone(QUIET))),
    );
  });

  it.each(Object.keys(QUIET.docs))(
    'moves when a %s document is rewritten',
    async (source) => {
      const [path] = Object.keys(QUIET.docs[source]);
      const rewritten = structuredClone(QUIET);
      rewritten.docs[source][path] = 2;
      expect(await triggerFingerprint(fakeDb(rewritten))).not.toBe(
        await triggerFingerprint(fakeDb(QUIET)),
      );
    },
  );

  it.each(Object.keys(QUIET.docs))(
    'moves when a %s document appears',
    async (source) => {
      const grown = structuredClone(QUIET);
      grown.docs[source][`${source}/new`] = 1;
      expect(await triggerFingerprint(fakeDb(grown))).not.toBe(
        await triggerFingerprint(fakeDb(QUIET)),
      );
    },
  );

  it('moves when the audit log grows', async () => {
    expect(await triggerFingerprint(fakeDb({ ...QUIET, audit: 8 }))).not.toBe(
      await triggerFingerprint(fakeDb(QUIET)),
    );
  });
});

describe('createExecutionTally', () => {
  const SINCE = 1_000;

  it('counts each start and finish, and holds what has not finished', () => {
    const tally = createExecutionTally(SINCE);
    tally.record(begin('us-central1-b', SINCE));
    tally.record(begin('us-central1-a', SINCE));
    tally.record(begin('us-central1-a', SINCE));
    tally.record(finish('us-central1-a', SINCE));
    expect(tally.events()).toBe(4);
    expect(tally.running()).toEqual(['us-central1-a', 'us-central1-b']);
    tally.record(finish('us-central1-a', SINCE));
    tally.record(finish('us-central1-b', SINCE));
    expect(tally.running()).toEqual([]);
    expect(tally.events()).toBe(6);
  });

  it('holds an execution begun before it started watching, without counting it as a change', () => {
    // The Logging emulator replays its whole history to a new connection.
    const tally = createExecutionTally(SINCE);
    tally.record(begin('us-central1-a', SINCE - 500));
    tally.record(begin('us-central1-b', SINCE - 400));
    tally.record(finish('us-central1-b', SINCE - 300));
    expect(tally.events()).toBe(0);
    expect(tally.running()).toEqual(['us-central1-a']);
    tally.record(finish('us-central1-a', SINCE + 1));
    expect(tally.events()).toBe(1);
    expect(tally.running()).toEqual([]);
  });

  it('counts a finish it never saw begin, and never goes below none', () => {
    const tally = createExecutionTally(SINCE);
    tally.record(finish('us-central1-a', SINCE));
    tally.record(begin('us-central1-a', SINCE));
    expect(tally.events()).toBe(2);
    expect(tally.running()).toEqual(['us-central1-a']);
  });

  it('ignores every other log line', () => {
    const tally = createExecutionTally(SINCE);
    for (const message of [
      'i  functions: Loaded environment variables from .env.local.',
      'Callable request verification passed',
      '',
    ]) {
      tally.record({ timestamp: SINCE, message });
    }
    tally.record(null);
    tally.record({ message: 'Beginning execution of "no-timestamp"' });
    expect(tally.events()).toBe(0);
    expect(tally.running()).toEqual([]);
    expect(tally.failures()).toEqual([]);
  });

  it('a failed request ends the execution it names, and is reported', () => {
    const tally = createExecutionTally(SINCE);
    tally.record(begin('us-central1-a', SINCE));
    tally.record(requestFailed('us-central1-a', SINCE + 10));
    expect(tally.running()).toEqual([]);
    expect(tally.events()).toBe(2);
    expect(tally.failures()).toEqual([
      {
        trigger: 'us-central1-a',
        atMs: SINCE + 10,
        cause: 'Request to function failed: Error: socket hang up',
      },
    ]);
  });

  it('a timeout or a kill says why, and only the line after it ends the execution', () => {
    const tally = createExecutionTally(SINCE);
    tally.record(begin('us-central1-a', SINCE));
    tally.record(begin('us-central1-a', SINCE + 1));
    tally.record(timedOut('us-central1-a', SINCE + 2));
    tally.record(killed('us-central1-a', SINCE + 3));
    // Two in flight still: neither line closed one.
    tally.record(requestFailed('us-central1-a', SINCE + 4));
    expect(tally.running()).toEqual(['us-central1-a']);
    expect(tally.failures().map(({ cause }) => cause)).toEqual([
      'Your function timed out after ~60s. To configure this timeout, see',
      'Your function was killed because it raised an unhandled error.',
      'Request to function failed: Error: socket hang up',
    ]);
  });

  it('a failure before it started watching is history: it ends the execution, it is not reported', () => {
    const tally = createExecutionTally(SINCE);
    tally.record(begin('us-central1-a', SINCE - 20));
    tally.record(requestFailed('us-central1-a', SINCE - 10));
    expect(tally.running()).toEqual([]);
    expect(tally.failures()).toEqual([]);
    expect(tally.events()).toBe(0);
  });

  it('a failure that names no function is still reported', () => {
    const tally = createExecutionTally(SINCE);
    tally.record({
      timestamp: SINCE,
      message: 'Request to function failed: Error: read ECONNRESET',
    });
    expect(tally.failures()).toEqual([
      {
        trigger: null,
        atMs: SINCE,
        cause: 'Request to function failed: Error: read ECONNRESET',
      },
    ]);
  });

  it('reads each trigger in flight by its oldest start, sorted by trigger', () => {
    const tally = createExecutionTally(0);
    tally.record(begin('us-central1-b', 0));
    tally.record(begin('us-central1-a', 1_000));
    tally.record(begin('us-central1-a', 7_000));
    tally.record(begin('us-central1-c', 8_000));
    expect(tally.inFlight(10_000)).toEqual([
      { trigger: 'us-central1-a', forMs: 9_000 },
      { trigger: 'us-central1-b', forMs: 10_000 },
      { trigger: 'us-central1-c', forMs: 2_000 },
    ]);
  });

  it('retires the OLDEST execution of a trigger on a finish, so an age is never overstated', () => {
    const tally = createExecutionTally(0);
    tally.record(begin('us-central1-a', 0));
    tally.record(begin('us-central1-a', 8_000));
    tally.record(finish('us-central1-a', 9_000));
    expect(tally.running()).toEqual(['us-central1-a']);
    expect(tally.inFlight(10_000)).toEqual([
      { trigger: 'us-central1-a', forMs: 2_000 },
    ]);
  });
});

describe('timeoutsFromBackends', () => {
  it("reads each trigger's declared timeout off the functions emulator's listing, by the id its lines name", () => {
    // `GET /backends` as firebase-tools 15 answers it (trimmed).
    const listing = {
      backends: [
        {
          directory: '/workspace/dist/apps/functions',
          functionTriggers: [
            {
              id: 'us-central1-dispatchClientProjections',
              name: 'dispatchClientProjections',
              timeoutSeconds: 60,
            },
            {
              id: 'us-central1-continueClientStatsPolicyRecompute',
              name: 'continueClientStatsPolicyRecompute',
              timeoutSeconds: 540,
            },
          ],
        },
        {
          functionTriggers: [
            { id: 'us-central1-runBackfill', timeoutSeconds: 540 },
          ],
        },
      ],
    };
    expect(timeoutsFromBackends(listing)).toEqual(
      new Map([
        ['us-central1-dispatchClientProjections', 60_000],
        ['us-central1-continueClientStatsPolicyRecompute', 540_000],
        ['us-central1-runBackfill', 540_000],
      ]),
    );
  });

  it('leaves out a trigger the emulator holds to no timeout, and reads nothing from nothing', () => {
    expect(
      timeoutsFromBackends({
        backends: [
          {
            functionTriggers: [
              { id: 'us-central1-a' },
              { id: 'us-central1-b', timeoutSeconds: 0 },
              { name: 'no-id', timeoutSeconds: 60 },
              { id: 'us-central1-c', timeoutSeconds: '60' },
            ],
          },
          {},
        ],
      }),
    ).toEqual(new Map());
    expect(timeoutsFromBackends(undefined)).toEqual(new Map());
    expect(timeoutsFromBackends({})).toEqual(new Map());
  });
});

describe('lostExecutions', () => {
  it('names an execution only once it is in flight past its own timeout and the grace', () => {
    const tally = createExecutionTally(0);
    tally.record(begin('us-central1-short', 0));
    tally.record(begin('us-central1-long', 0));
    tally.record(begin('us-central1-unlisted', 0));
    const timeouts = new Map([
      ['us-central1-short', 60_000],
      ['us-central1-long', 540_000],
    ]);
    expect(lostExecutions(tally, timeouts, 89_999, 30_000)).toEqual([]);
    expect(lostExecutions(tally, timeouts, 90_000, 30_000)).toEqual([
      { trigger: 'us-central1-short', forMs: 90_000, timeoutMs: 60_000 },
    ]);
    // The long one gets its 540 s; one the listing never named, forever.
    expect(lostExecutions(tally, timeouts, 569_999, 30_000)).toEqual([
      { trigger: 'us-central1-short', forMs: 569_999, timeoutMs: 60_000 },
    ]);
    expect(
      lostExecutions(tally, timeouts, 10_000_000, 30_000).map(
        ({ trigger }) => trigger,
      ),
    ).toEqual(['us-central1-long', 'us-central1-short']);
  });
});

describe('settleTriggers', () => {
  const OPTIONS = { quietMs: 2_000, pollMs: 1_000, timeoutMs: 10_000 };

  /**
   * A clock that moves only when slept on; `onTick(now)` runs after each
   * move, where a test plays the Logging emulator's lines into the tally.
   */
  function scriptedClock(onTick = () => undefined) {
    let now = 0;
    return {
      now: () => now,
      sleep: async (ms) => {
        now += ms;
        onTick(now);
      },
    };
  }

  /**
   * What `watchExecutions` answers, around a tally the test feeds and the
   * declared timeouts (none, unless given).
   */
  function watching(tally, timeouts = new Map()) {
    return { tally, timeouts, close: vi.fn() };
  }

  it('settles once the data and the executions have both held still', async () => {
    const tally = createExecutionTally(0);
    tally.record(begin('us-central1-a', 0));
    tally.record(finish('us-central1-a', 0));
    const watch = watching(tally);
    const clock = scriptedClock();
    await expect(
      settleTriggers(fakeDb(QUIET), { ...OPTIONS, clock, watch }),
    ).resolves.toBe(2_000);
    expect(watch.close).toHaveBeenCalledTimes(1);
  });

  it('never reads a trigger in flight as quiet, and names it when it refuses', async () => {
    // Data-only, this settles at 2 s: nothing is written.
    const tally = createExecutionTally(0);
    tally.record(begin('us-central1-dispatchClientProjections', 0));
    const watch = watching(
      tally,
      new Map([['us-central1-dispatchClientProjections', 60_000]]),
    );
    const clock = scriptedClock();
    await expect(
      settleTriggers(fakeDb(QUIET), { ...OPTIONS, clock, watch }),
    ).rejects.toThrow(
      'the emulators never went quiet within 10000 ms (still running: us-central1-dispatchClientProjections (11 s of its 60 s) — busy, or ended in a way the functions emulator did not log)',
    );
    expect(clock.now()).toBeGreaterThan(OPTIONS.timeoutMs);
    expect(watch.close).toHaveBeenCalledTimes(1);
  });

  it('restarts the window on an execution even while the data holds still', async () => {
    const tally = createExecutionTally(0);
    // One execution begins and ends between the 1 s and the 2 s reads.
    const clock = scriptedClock((now) => {
      if (now === 2_000) {
        tally.record(begin('us-central1-rebuildBusy', 1_400));
        tally.record(finish('us-central1-rebuildBusy', 1_600));
      }
    });
    // Data-only, this settles at 2 s; the execution moves it to 4 s.
    await expect(
      settleTriggers(fakeDb(QUIET), {
        ...OPTIONS,
        clock,
        watch: watching(tally),
      }),
    ).resolves.toBe(4_000);
  });

  it('restarts the window on a write even while the executions hold still', async () => {
    let reads = 0;
    const db = fakeDb({ ...QUIET, audit: () => (reads++ < 2 ? reads : 2) });
    await expect(
      settleTriggers(db, {
        ...OPTIONS,
        clock: scriptedClock(),
        watch: watching(createExecutionTally(0)),
      }),
    ).resolves.toBe(3_000);
  });

  it('waits for an execution that began before the watch connected', async () => {
    // Replayed history: begun at -3 s, before `sinceMs`; it finishes at 3 s.
    const tally = createExecutionTally(0);
    tally.record(begin('us-central1-rebuildCapacity', -3_000));
    const clock = scriptedClock((now) => {
      if (now === 3_000)
        tally.record(finish('us-central1-rebuildCapacity', now));
    });
    await expect(
      settleTriggers(fakeDb(QUIET), {
        ...OPTIONS,
        clock,
        watch: watching(tally),
      }),
    ).resolves.toBe(5_000);
  });

  it('goes on past an execution the emulator killed, and names it when it ends', async () => {
    // Timed out at 2 s: the emulator's own lines end it. Waiting for a
    // 'Finished' that never comes would hold the window to the timeout.
    const tally = createExecutionTally(0);
    tally.record(begin('us-central1-dispatchClientProjections', 0));
    const clock = scriptedClock((now) => {
      if (now === 2_000) {
        tally.record(timedOut('us-central1-dispatchClientProjections', now));
        tally.record(
          requestFailed('us-central1-dispatchClientProjections', now),
        );
      }
    });
    const watch = watching(tally);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await expect(
        settleTriggers(fakeDb(QUIET), { ...OPTIONS, clock, watch }),
      ).resolves.toBe(4_000);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        'settle: 2 trigger execution(s) ended without finishing, and the emulator never retries them — what they were writing may be missing ("us-central1-dispatchClientProjections": Your function timed out after ~60s. To configure this timeout, see; "us-central1-dispatchClientProjections": Request to function failed: Error: socket hang up)',
      );
      expect(watch.close).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('names a trigger that died even when the wait then refuses', async () => {
    const tally = createExecutionTally(0);
    tally.record(killed('us-central1-rebuildBusy', 0));
    tally.record(begin('us-central1-rebuildCapacity', 0));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await expect(
        settleTriggers(fakeDb(QUIET), {
          ...OPTIONS,
          clock: scriptedClock(),
          watch: watching(tally),
        }),
      ).rejects.toThrow('still running: us-central1-rebuildCapacity');
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          '"us-central1-rebuildBusy": Your function was killed because it raised an unhandled error.',
        ),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('says nothing about failures when there were none', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await settleTriggers(fakeDb(QUIET), {
        ...OPTIONS,
        clock: scriptedClock(),
        watch: watching(createExecutionTally(0)),
      });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('refuses an execution in flight past its own timeout and the grace as lost, naming it', async () => {
    const tally = createExecutionTally(0);
    tally.record(begin('us-central1-rebuildCapacity', 0));
    const watch = watching(
      tally,
      new Map([['us-central1-rebuildCapacity', 2_000]]),
    );
    const clock = scriptedClock();
    await expect(
      settleTriggers(fakeDb(QUIET), {
        ...OPTIONS,
        timeoutMs: 180_000,
        graceMs: 2_000,
        clock,
        watch,
      }),
    ).rejects.toThrow(
      'a trigger execution outlived its timeout without the functions emulator ending it ("us-central1-rebuildCapacity" in flight for 4 s, past its own 2 s timeout)',
    );
    // Refused at its timeout and the grace, not waited out to the three minutes.
    expect(clock.now()).toBe(4_000);
    expect(watch.close).toHaveBeenCalledTimes(1);
  });

  it('gives a function that declares a long timeout its time: still running at the overall bound, never lost', async () => {
    // The policy recompute's step declares 540 s. A flat limit near the
    // emulator's 60 s default would call it lost at 90 s.
    const trigger = 'us-central1-continueClientStatsPolicyRecompute';
    const tally = createExecutionTally(0);
    tally.record(begin(trigger, 0));
    const clock = scriptedClock();
    const outcome = settleTriggers(fakeDb(QUIET), {
      ...OPTIONS,
      timeoutMs: 180_000,
      clock,
      watch: watching(tally, new Map([[trigger, 540_000]])),
    });
    await expect(outcome).rejects.toThrow(
      `the emulators never went quiet within 180000 ms (still running: ${trigger} (181 s of its 540 s)`,
    );
    await expect(outcome).rejects.not.toThrow('outlived its timeout');
  });

  it('never calls lost a trigger the listing does not name', async () => {
    const tally = createExecutionTally(0);
    tally.record(begin('us-central1-unlisted', 0));
    const outcome = settleTriggers(fakeDb(QUIET), {
      ...OPTIONS,
      timeoutMs: 180_000,
      graceMs: 0,
      clock: scriptedClock(),
      watch: watching(tally),
    });
    await expect(outcome).rejects.toThrow(
      'the emulators never went quiet within 180000 ms (still running: us-central1-unlisted (181 s) — busy',
    );
  });

  it('with no Logging emulator, refuses at once rather than wait on the data alone', async () => {
    const clock = scriptedClock();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      // Data-only, this would settle at 2 s: nothing is written.
      await expect(
        settleTriggers(fakeDb(QUIET), { ...OPTIONS, clock, watch: null }),
      ).rejects.toThrow(NO_LOGGING_EMULATOR);
      expect(clock.now()).toBe(0);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
    expect(NO_LOGGING_EMULATOR).toContain('START_LOGGING_EMULATOR=true');
    expect(NO_LOGGING_EMULATOR).toContain('--allow-data-only');
  });

  it('with no Logging emulator and the data-only wait allowed, settles on the data alone and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await expect(
        settleTriggers(fakeDb(QUIET), {
          ...OPTIONS,
          clock: scriptedClock(),
          watch: null,
          allowDataOnly: true,
        }),
      ).resolves.toBe(2_000);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        'settle: no Logging emulator, and the data-only wait allowed: waiting on the projections alone, which can call a trigger storm quiet',
      );
    } finally {
      warn.mockRestore();
    }
  });
});

/** One unmasked WebSocket text frame, as a server sends it. */
function textFrame(text) {
  const payload = Buffer.from(text);
  const header =
    payload.length < 126
      ? Buffer.from([0x81, payload.length])
      : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff]);
  return Buffer.concat([header, payload]);
}

/**
 * A stand-in emulator hub on one local port: the hub's `/emulators`, the
 * functions emulator's `/backends` (`listing`), and — unless `logging` is
 * false, as firebase-tools means it to be under `emulators:exec` with
 * neither `--ui` nor START_LOGGING_EMULATOR=true — a Logging emulator that
 * sends `history` to each new connection, as the real one replays its own.
 */
async function standInHub({ logging = true, history = [], listing } = {}) {
  const upgraded = new Set();
  const server = createServer((request, response) => {
    const self = { host: '0.0.0.0', port: server.address().port };
    const body =
      request.url === '/emulators'
        ? { hub: self, functions: self, ...(logging ? { logging: self } : {}) }
        : request.url === '/backends' && listing !== undefined
          ? listing
          : undefined;
    response.writeHead(body === undefined ? 404 : 200, {
      'content-type': 'application/json',
    });
    response.end(body === undefined ? 'Not Found' : JSON.stringify(body));
  });
  server.on('upgrade', (request, socket) => {
    upgraded.add(socket);
    const accept = createHash('sha1')
      .update(
        `${request.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`,
      )
      .digest('base64');
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '',
        '',
      ].join('\r\n'),
    );
    for (const bundle of history)
      socket.write(textFrame(JSON.stringify(bundle)));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    hub: `127.0.0.1:${server.address().port}`,
    close: () =>
      new Promise((resolve) => {
        for (const socket of upgraded) socket.destroy();
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}

describe('watchExecutions, against a stand-in hub', () => {
  const SINCE = 1_000;
  let hub;

  afterEach(async () => {
    vi.unstubAllEnvs();
    await hub?.close();
    hub = undefined;
  });

  it('reads the replayed history into the tally, and the declared timeouts off the listing', async () => {
    hub = await standInHub({
      history: [
        begin('us-central1-rebuildCapacity', SINCE - 500),
        begin('us-central1-rebuildBusy', SINCE - 400),
        finish('us-central1-rebuildBusy', SINCE - 300),
        begin('us-central1-dispatchClientProjections', SINCE + 10),
      ],
      listing: {
        backends: [
          {
            functionTriggers: [
              { id: 'us-central1-rebuildCapacity', timeoutSeconds: 60 },
            ],
          },
        ],
      },
    });
    vi.stubEnv('FIREBASE_EMULATOR_HUB', hub.hub);
    const watch = await watchExecutions({ sinceMs: SINCE });
    try {
      expect(watch.timeouts).toEqual(
        new Map([['us-central1-rebuildCapacity', 60_000]]),
      );
      await vi.waitFor(() =>
        expect(watch.tally.running()).toEqual([
          'us-central1-dispatchClientProjections',
          'us-central1-rebuildCapacity',
        ]),
      );
      // Only the line logged from `sinceMs` on counts as a change.
      expect(watch.tally.events()).toBe(1);
    } finally {
      watch.close();
    }
  });

  it('knows no timeout when the functions listing cannot be read', async () => {
    hub = await standInHub();
    vi.stubEnv('FIREBASE_EMULATOR_HUB', hub.hub);
    const watch = await watchExecutions({ sinceMs: SINCE });
    try {
      expect(watch.timeouts).toEqual(new Map());
    } finally {
      watch.close();
    }
  });

  it('answers null when the hub lists no Logging emulator', async () => {
    hub = await standInHub({ logging: false });
    vi.stubEnv('FIREBASE_EMULATOR_HUB', hub.hub);
    await expect(watchExecutions({ sinceMs: SINCE })).resolves.toBeNull();
  });

  it('left to find the emulators itself, settleTriggers refuses on a hub with no Logging emulator', async () => {
    // A hub with no Logging emulator (any firebase-tools that reads an
    // unset START_LOGGING_EMULATOR as false, started without --ui) once
    // got the data-only wait, silently.
    hub = await standInHub({ logging: false });
    vi.stubEnv('FIREBASE_EMULATOR_HUB', hub.hub);
    await expect(
      settleTriggers(fakeDb(QUIET), {
        quietMs: 2_000,
        pollMs: 1_000,
        timeoutMs: 10_000,
        clock: { now: () => 0, sleep: async () => undefined },
      }),
    ).rejects.toThrow(NO_LOGGING_EMULATOR);
  });
});

describe('optionsFromArgv', () => {
  it('reads --since as epoch milliseconds and --allow-data-only as the opt-in', () => {
    expect(
      optionsFromArgv(['--since=1790000000000', '--allow-data-only']),
    ).toEqual({ sinceMs: 1_790_000_000_000, allowDataOnly: true });
  });

  it('with no flags, counts from the start of the wait and never waits on the data alone', () => {
    expect(optionsFromArgv([])).toEqual({
      sinceMs: undefined,
      allowDataOnly: false,
    });
  });

  it.each(['--since=', '--since=soon', '--since=-5', '--since=1.5'])(
    'refuses %s',
    (flag) => {
      expect(() => optionsFromArgv([flag])).toThrow(
        '--since takes epoch milliseconds',
      );
    },
  );

  it.each(['--data-only', '--allow-data-only=true', '--since', 'since=5'])(
    'refuses the unknown argument %s rather than run a different wait',
    (arg) => {
      expect(() => optionsFromArgv([arg])).toThrow(`unknown argument "${arg}"`);
    },
  );
});
