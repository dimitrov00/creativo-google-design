import { execSync } from 'node:child_process';
import { workspaceRoot } from '@nx/devkit';

/**
 * Seeds the dev catalogue (shops, services, barbers, rosters, the booking
 * policy) ONCE for the whole run, and lets it settle, before any worker
 * starts.
 *
 * `e2e:web` starts empty emulators, so a screen that NAMES what a visit is —
 * the service, the barber's face — needs it, or it renders its fallbacks.
 * It is the dev seed itself rather than a second copy of it, and no spec
 * seeds it again.
 *
 * The CATALOGUE only (`--catalog-only`): no spec reads the dev seed's client
 * book, staff account, client avatars, promotions or stats — every spec
 * seeds the people and visits it asserts on (`seed-firestore.ts`) and signs
 * in with minted roles (`sign-in.ts`), and the rebooking spec needs only the
 * catalogue's chair and roster. The book's projections were some five
 * hundred function-trigger runs (the client stats, the busy and capacity
 * rebuilds), which share the emulator hub with Auth and Storage: seeding
 * from each worker once ran those storms underneath the tests, and a
 * Storage round trip inside one took longer than an assertion waits.
 *
 * FIRST, THE CLI. The emulators must be the workspace's pinned firebase-tools
 * (`tools/seed/emulator-cli.mjs`): the suite runs with no local retries, and
 * another CLI's defects would read as our flakes (15.11's Storage emulator
 * lost rules answers that arrived together and hung the browser's request).
 * A hub any other CLI started refuses the run before anything is seeded.
 *
 * The settle is `tools/seed/settle.mjs`, the same wait the P0 proofs run
 * between their seeds; this project is `scope:web` and may not import
 * tooling, so it runs it as a CLI — from the instant the seed began, so a
 * trigger the seed set off that died before the settle connected is still
 * reported by name. It watches the executions on the Logging emulator,
 * which `e2e:web` asks for with START_LOGGING_EMULATOR=true (the pinned
 * firebase-tools also starts one when the variable is unset, but only by
 * accident; see the settle's header). Without one the settle refuses, and
 * the run with it, rather than wait on the data alone (never
 * `--allow-data-only` here).
 */
export default function globalSetup(): void {
  // One line: the CLI the emulators run, or why the run stops here.
  run('node tools/seed/emulator-cli.mjs', 'inherit');
  const seededFrom = Date.now();
  // The seed's progress log is noise; stderr says why it refused, if it did.
  run('node tools/seed-dev-catalog.mjs --catalog-only', 'ignore');
  // One line: how long the triggers took to go quiet.
  run(`node tools/seed/settle.mjs --since=${seededFrom}`, 'inherit');
}

/** From the workspace root, stderr always shown. */
function run(command: string, stdout: 'ignore' | 'inherit'): void {
  execSync(command, {
    cwd: workspaceRoot,
    stdio: ['ignore', stdout, 'inherit'],
  });
}
