import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  RulesTestContext,
  RulesTestEnvironment,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import type { Firestore } from 'firebase/firestore';

/**
 * Shared Firestore Emulator harness for `*.integration.spec.ts` files in
 * this lib — both plain repository/reader integration tests (seeded via
 * `withSecurityRulesDisabled`, exercised via `authenticatedContext`) and
 * the dedicated rules-unit-testing suite. One instance per test file
 * (`beforeAll`/`afterAll`), never shared across files — each gets its own
 * isolated project id so parallel test files can't see each other's data.
 *
 * Requires the Firestore emulator running on localhost:8080 (and, for
 * {@link createStorageRulesTestEnv}, the Storage emulator on 9199) — see
 * `firebase.json` and the root `test:emulator` script (`firebase
 * emulators:exec`). NOT part of this lib's public API (excluded from
 * `tsconfig.lib.json` — `@firebase/rules-unit-testing` is a devDependency
 * and must never end up in a production bundle).
 */
export async function createEmulatorTestEnv(
  projectId: string,
): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId,
    firestore: {
      rules: loadFirestoreRules(),
      host: '127.0.0.1',
      port: 8080,
    },
  });
}

/**
 * The project the Storage emulator itself runs under (the root
 * `test:emulator` script's `--project`). Its rules runtime answers a
 * `firestore.get` from THIS project's Firestore data, whatever project the
 * client names — so the documents a Storage rule reads are seeded here.
 */
export const STORAGE_EMULATOR_PROJECT_ID = 'demo-creativo-test';

/**
 * The Storage-and-Firestore variant of {@link createEmulatorTestEnv}, for
 * the `storage.rules` suite (Phase 4 S-L-12): the root `storage.rules`
 * loaded into the Storage emulator on localhost:9199, and a Firestore
 * client on localhost:8080 under {@link STORAGE_EMULATOR_PROJECT_ID} to seed
 * the documents the rules read cross-service. No Firestore rules are
 * loaded — the Storage rules runtime reads Firestore as the owner, past any
 * Firestore rule, and this project's rules are not this suite's to replace.
 * The Storage emulator holds ONE ruleset for every bucket: the file loaded
 * is the same one `firebase.json` names, so nothing else changes. Shared
 * data, so a suite seeds run-unique ids and deletes exactly what it wrote —
 * never `clearFirestore()` / `clearStorage()`.
 */
export async function createStorageRulesTestEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: STORAGE_EMULATOR_PROJECT_ID,
    firestore: {
      host: '127.0.0.1',
      port: 8080,
    },
    storage: {
      rules: loadStorageRules(),
      host: '127.0.0.1',
      port: 9199,
    },
  });
}

/**
 * `RulesTestContext.firestore()` is typed against the legacy compat SDK
 * (`firebase.firestore.Firestore`), but every adapter in this lib is
 * constructed with the modular SDK's `Firestore` (`firebase/firestore`) —
 * at runtime they're the same client, `@firebase/rules-unit-testing` just
 * hasn't updated its public types. Every integration spec should go through
 * this cast instead of writing its own, so there's exactly one place that
 * asserts the two are compatible.
 */
export function modularFirestore(context: RulesTestContext): Firestore {
  return context.firestore() as unknown as Firestore;
}

// libs/infrastructure/firestore/src/testing/emulator-test-env.ts -> repo root
function loadFirestoreRules(): string {
  return readFileSync(
    join(__dirname, '../../../../../firestore.rules'),
    'utf8',
  );
}

function loadStorageRules(): string {
  return readFileSync(join(__dirname, '../../../../../storage.rules'), 'utf8');
}
