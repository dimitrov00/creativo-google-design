#!/usr/bin/env node
/**
 * THE EMULATORS ARE THE WORKSPACE'S OWN firebase-tools.
 *
 * The CLI is a root devDependency pinned to one exact version, and every
 * package script that starts the emulators runs it by its bare name, which
 * pnpm resolves from `node_modules/.bin` before anything else on PATH. A
 * `firebase` from anywhere else (a global install, `npx firebase-tools`)
 * runs other emulator code, and that has cost us before: 15.11's Storage
 * emulator JSON-parsed its rules runtime's stdout one `data` chunk at a
 * time, so two answers that arrived in one chunk never resolved and the
 * browser's Storage request hung, failing one to three e2e tests in a
 * hundred (2026-09-26). 15.31 reads that stdout line by line
 * (`handleRuntimeStdout`), and the spec beside this file holds the pinned
 * CLI to it.
 *
 * So a run that depends on the emulators' behaviour asks the hub which CLI
 * started it (`GET /` answers the hub's locator, whose `version` is the
 * CLI's) and refuses any other, rather than meeting that CLI's defects as
 * flakes:
 *
 *   - in process: `await assertPinnedEmulatorCli()`;
 *   - as a CLI: `node tools/seed/emulator-cli.mjs` (the e2e suite's
 *     `apps/web/e2e/support/global-setup.ts`, before it seeds anything).
 *
 * The hub is the one FIREBASE_EMULATOR_HUB names (`emulators:exec` sets it
 * for the script it runs), 127.0.0.1:4400 by default.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ROOT_PACKAGE_JSON = new URL('../../package.json', import.meta.url);

/** `emulators:exec` may hand over the 0.0.0.0 bind address; connect locally. */
const local = (host) => host.replace('0.0.0.0', '127.0.0.1');

/**
 * The firebase-tools version the root package.json pins; refuses a range, a
 * tag or no entry, because only one exact version is hermetic.
 */
export function pinnedEmulatorCli(
  packageJson = JSON.parse(readFileSync(ROOT_PACKAGE_JSON, 'utf8')),
) {
  const pinned = packageJson?.devDependencies?.['firebase-tools'];
  if (typeof pinned !== 'string' || !/^\d+\.\d+\.\d+$/.test(pinned)) {
    throw new Error(
      `the root package.json must pin firebase-tools to one exact version in devDependencies, not ${JSON.stringify(pinned ?? null)}`,
    );
  }
  return pinned;
}

/** Why a hub started by `running` is refused, or `null` when it is the pinned CLI. */
export function emulatorCliRefusal(running, pinned) {
  if (running === pinned) return null;
  const which =
    typeof running === 'string' && running !== ''
      ? `firebase-tools ${running}`
      : 'a firebase-tools that does not say its version';
  return `the emulators run ${which}, but the workspace pins ${pinned}: start them through the package scripts (pnpm run e2e:web, verify:p0, test:emulator or dev), which run the pinned node_modules/.bin/firebase`;
}

/**
 * Resolves with the pinned version when the hub's CLI is it; rejects,
 * saying why, when it is another or when no hub answers.
 */
export async function assertPinnedEmulatorCli({
  hub = process.env.FIREBASE_EMULATOR_HUB ?? '127.0.0.1:4400',
  pinned = pinnedEmulatorCli(),
} = {}) {
  let locator;
  try {
    const response = await fetch(`http://${local(hub)}/`, {
      signal: AbortSignal.timeout(2_000),
    });
    locator = await response.json();
  } catch (error) {
    throw new Error(
      `no emulator hub answered at ${hub} (${error.message}): start the emulators through the package scripts`,
    );
  }
  const refusal = emulatorCliRefusal(locator?.version, pinned);
  if (refusal !== null) throw new Error(refusal);
  return pinned;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  assertPinnedEmulatorCli().then(
    (version) => console.log(`emulator-cli: firebase-tools ${version}`),
    (error) => {
      console.error(`emulator-cli: ${error.message}`);
      process.exit(1);
    },
  );
}
