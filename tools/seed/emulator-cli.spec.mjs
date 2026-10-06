/**
 * The emulators are the workspace's pinned firebase-tools (`emulator-cli.mjs`):
 * the root pins one exact version and installs that one; the hub check
 * passes only a hub the pinned CLI started; and the pinned CLI's Storage
 * emulator resolves every rules answer however its runtime's stdout is
 * chunked, the defect that made the e2e suite flaky under 15.11.
 */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import {
  assertPinnedEmulatorCli,
  emulatorCliRefusal,
  pinnedEmulatorCli,
} from './emulator-cli.mjs';

/** Resolves as the workspace root does, where the scripts run the CLI from. */
const requireFromRoot = createRequire(
  new URL('../../package.json', import.meta.url),
);

describe('pinnedEmulatorCli — one exact version, the one installed', () => {
  it('reads the root devDependency, and node_modules holds that version', () => {
    const pinned = pinnedEmulatorCli();
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
    expect(requireFromRoot('firebase-tools/package.json').version).toBe(pinned);
  });

  it.each([['^15.31.0'], ['~15.31.0'], ['latest'], ['15'], [''], [undefined]])(
    'refuses %j',
    (pin) => {
      expect(() =>
        pinnedEmulatorCli({ devDependencies: { 'firebase-tools': pin } }),
      ).toThrow(/one exact version/);
    },
  );

  it('refuses a package.json that does not list it', () => {
    expect(() => pinnedEmulatorCli({ dependencies: {} })).toThrow(
      /one exact version/,
    );
  });
});

describe('emulatorCliRefusal', () => {
  it('passes the pinned version', () => {
    expect(emulatorCliRefusal('15.31.0', '15.31.0')).toBeNull();
  });

  it('names both versions and the way in when another CLI runs', () => {
    const refusal = emulatorCliRefusal('15.11.0', '15.31.0');
    expect(refusal).toContain('firebase-tools 15.11.0');
    expect(refusal).toContain('pins 15.31.0');
    expect(refusal).toContain('pnpm run e2e:web');
  });

  it.each([[undefined], [null], [''], [15]])(
    'refuses a hub that does not say its version (%j)',
    (version) => {
      expect(emulatorCliRefusal(version, '15.31.0')).toContain(
        'does not say its version',
      );
    },
  );
});

describe('assertPinnedEmulatorCli — asks the hub which CLI started it', () => {
  let server;
  let hub;
  let locator;
  let asked;

  beforeAll(async () => {
    server = createServer((request, response) => {
      asked.push(`${request.method} ${request.url}`);
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(locator));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    hub = `127.0.0.1:${server.address().port}`;
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  beforeEach(() => {
    asked = [];
  });

  it('resolves with the version when the pinned CLI started the hub', async () => {
    locator = { version: '15.31.0', origins: [], pid: 1 };
    await expect(
      assertPinnedEmulatorCli({ hub, pinned: '15.31.0' }),
    ).resolves.toBe('15.31.0');
    expect(asked).toEqual(['GET /']);
  });

  it('reads the hub `emulators:exec` hands over on 0.0.0.0 locally', async () => {
    locator = { version: '15.31.0' };
    await expect(
      assertPinnedEmulatorCli({
        hub: hub.replace('127.0.0.1', '0.0.0.0'),
        pinned: '15.31.0',
      }),
    ).resolves.toBe('15.31.0');
  });

  it('refuses a hub another CLI started', async () => {
    locator = { version: '15.11.0', origins: [], pid: 1 };
    await expect(
      assertPinnedEmulatorCli({ hub, pinned: '15.31.0' }),
    ).rejects.toThrow('the emulators run firebase-tools 15.11.0');
  });

  it('refuses when no hub answers', async () => {
    const closed = createServer();
    await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const port = closed.address().port;
    await new Promise((resolve) => closed.close(resolve));
    await expect(
      assertPinnedEmulatorCli({ hub: `127.0.0.1:${port}`, pinned: '15.31.0' }),
    ).rejects.toThrow(`no emulator hub answered at 127.0.0.1:${port}`);
  });
});

/**
 * The pinned CLI's own Storage rules runtime, fed as the Java runtime feeds
 * it: newline-terminated JSON answers, in whatever `data` chunks the pipe
 * delivers. 15.11 parsed each chunk whole, so the first case never resolved
 * there (and the method below did not exist).
 */
describe('the pinned Storage emulator reads its rules runtime line by line', () => {
  const { StorageRulesRuntime } = requireFromRoot(
    'firebase-tools/lib/emulator/storage/rules/runtime.js',
  );

  /** A runtime with a stand-in process, and `count` requests in flight. */
  function inFlight(count) {
    const runtime = new StorageRulesRuntime();
    const written = [];
    runtime._childprocess = { stdin: { write: (line) => written.push(line) } };
    const answers = Array.from({ length: count }, () =>
      runtime._sendRequest({ action: 'verify_with_ruleset' }),
    );
    const settled = answers.map(() => false);
    answers.forEach((answer, index) =>
      answer.then(() => {
        settled[index] = true;
      }),
    );
    return { runtime, answers, settled, written };
  }

  const answer = (id) =>
    `${JSON.stringify({ id, status: 'ok', result: { permit: true } })}\n`;

  it('resolves two answers that arrive in one chunk', async () => {
    const { runtime, answers } = inFlight(2);
    runtime.handleRuntimeStdout(answer(0) + answer(1));
    await expect(Promise.all(answers)).resolves.toEqual([
      { id: 0, status: 'ok', result: { permit: true } },
      { id: 1, status: 'ok', result: { permit: true } },
    ]);
  });

  it('resolves an answer split across two chunks once its line is whole', async () => {
    const { runtime, answers, settled } = inFlight(1);
    const line = answer(0);
    runtime.handleRuntimeStdout(line.slice(0, 10));
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toEqual([false]);
    runtime.handleRuntimeStdout(line.slice(10));
    await expect(answers[0]).resolves.toMatchObject({ id: 0 });
  });
});
