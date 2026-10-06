import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * EVERY SCRIPT THAT STARTS THE FUNCTIONS EMULATOR STARTS A LOGGING EMULATOR.
 *
 * The settle (`settle.mjs`) watches trigger executions on the Logging
 * emulator and refuses without one. firebase-tools starts it for `--ui` or
 * for `START_LOGGING_EMULATOR=true` in its environment — and, in the pinned
 * 15.31.0 as in 15.11, on every start by accident (an unset variable reads
 * as the truthy string "false"; see the settle's header). These cases hold
 * each script to one of the two documented ways, so a firebase-tools
 * release that fixes the accident cannot turn `e2e:web` or `verify:p0` red
 * on its own.
 */

const PACKAGE_JSON = resolve(__dirname, '../../package.json');

/** The workspace's npm scripts, by name. */
function workspaceScripts() {
  return new Map(
    Object.entries(JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')).scripts),
  );
}

/**
 * Every `firebase emulators:exec|start` in one script line: the variable
 * assignments written right before it (`A=1 B=2 firebase …`) and its own
 * flags — up to the quoted script `exec` runs, or the next `&&`.
 */
function emulatorStarts(script) {
  const starts = [];
  const command = /firebase\s+emulators:(exec|start)\b/g;
  for (const match of script.matchAll(command)) {
    const before = script.slice(0, match.index);
    const cut = before.lastIndexOf('&&');
    const segment = cut < 0 ? before : before.slice(cut + 2);
    const env = new Map(
      [...segment.matchAll(/(?:^|\s)([A-Z_][A-Z0-9_]*)=(\S*)/g)].map(
        ([, name, value]) => [name, value],
      ),
    );
    const after = script.slice(match.index + match[0].length);
    const end = after.search(/"|&&/);
    const flags = (end < 0 ? after : after.slice(0, end)).trim().split(/\s+/);
    const onlyAt = flags.indexOf('--only');
    const only = onlyAt < 0 ? null : (flags[onlyAt + 1] ?? '').split(',');
    starts.push({ env, flags, only });
  }
  return starts;
}

/** `--only` names functions, or there is no `--only` (every configured emulator). */
const startsFunctions = (start) =>
  start.only === null ||
  start.only.some((name) => name.split(':')[0] === 'functions');

/** firebase-tools' two documented doors to the Logging emulator. */
const startsLogging = (start) =>
  start.flags.includes('--ui') ||
  start.env.get('START_LOGGING_EMULATOR') === 'true';

describe('emulatorStarts', () => {
  it('reads the variables before the command and the flags before its quoted script', () => {
    expect(
      emulatorStarts(
        'pnpm nx build functions && START_LOGGING_EMULATOR=true FOO=bar firebase emulators:exec --only firestore,functions --project p "a && b --ui"',
      ),
    ).toEqual([
      {
        env: new Map([
          ['START_LOGGING_EMULATOR', 'true'],
          ['FOO', 'bar'],
        ]),
        flags: ['--only', 'firestore,functions', '--project', 'p'],
        only: ['firestore', 'functions'],
      },
    ]);
  });

  it.each([
    ['firebase emulators:exec --only functions "x"', false],
    [
      'START_LOGGING_EMULATOR=false firebase emulators:exec --only functions "x"',
      false,
    ],
    [
      'START_LOGGING_EMULATORS=true firebase emulators:exec --only functions "x"',
      false,
    ],
    [
      'START_LOGGING_EMULATOR=true firebase emulators:exec --only functions "x"',
      true,
    ],
    ['firebase emulators:exec --only functions --ui "x"', true],
    // A `--ui` inside the quoted script is not the emulators' flag.
    ['firebase emulators:exec --only functions "serve --ui"', false],
    // A variable set for an earlier command does not reach this one.
    [
      'START_LOGGING_EMULATOR=true node a.mjs && firebase emulators:start',
      false,
    ],
  ])('%s starts a Logging emulator: %s', (script, expected) => {
    const [start] = emulatorStarts(script);
    expect(start && startsLogging(start)).toBe(expected);
  });

  it.each([
    ['firebase emulators:exec --only firestore,auth "x"', false],
    ['firebase emulators:exec --only firestore,functions:api "x"', true],
    ['firebase emulators:start', true],
  ])('%s starts the functions emulator: %s', (script, expected) => {
    const [start] = emulatorStarts(script);
    expect(start && startsFunctions(start)).toBe(expected);
  });
});

describe('the workspace scripts that start the functions emulator', () => {
  const scripts = workspaceScripts();
  const functionStarts = [...scripts].flatMap(([name, script]) =>
    emulatorStarts(script)
      .filter(startsFunctions)
      .map((start) => [name, start]),
  );

  it('include the three that settle or serve over triggers', () => {
    // Fails if the reading above stops finding them, rather than passing
    // over an empty list.
    expect(functionStarts.map(([name]) => name)).toEqual(
      expect.arrayContaining(['dev', 'e2e:web', 'verify:p0']),
    );
  });

  it.each(functionStarts)(
    '%s starts a Logging emulator for the settle (--ui or START_LOGGING_EMULATOR=true)',
    (_name, start) => {
      expect(startsLogging(start)).toBe(true);
    },
  );

  it.each(['e2e:web', 'verify:p0'])(
    '%s asks for it with START_LOGGING_EMULATOR=true, not by the accident of an unset variable',
    (name) => {
      const [start] = emulatorStarts(scripts.get(name) ?? '');
      expect(start?.env.get('START_LOGGING_EMULATOR')).toBe('true');
    },
  );
});
