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
 * Requires the Firestore emulator running on localhost:8080 — see
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

function loadFirestoreRules(): string {
  // libs/infrastructure/firestore/src/testing/emulator-test-env.ts -> repo root
  return readFileSync(
    join(__dirname, '../../../../../firestore.rules'),
    'utf8',
  );
}
