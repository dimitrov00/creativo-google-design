/**
 * The production TypeScript the seed runs in-process — BUNDLED, because
 * every document the seed writes is TypeScript now (flip 1, booking core):
 *
 * - THE SEED ITSELF. The catalogue, the rosters, the appointments, the
 *   promotions, the waitlist request, the client records and the accounts
 *   (`users`, flip 2) are bodies in `tools/seed/fixtures/*.fixtures.ts`,
 *   each `satisfies Omit<X, 'id'>` of its `@core/entities` archetype, and
 *   the plan modules that place them (`catalog.mjs`, `fixtures.mjs`,
 *   `appointments.mjs`, `loyalty.mjs`, `promotions.mjs`, `waitlist.mjs`)
 *   import those bodies; `seed-dev-catalog.mjs` takes the staff account's
 *   body straight from `users`. Plain Node can
 *   neither strip their types nor resolve their `@core/*` aliases, so
 *   `seed-dev-catalog.mjs` reaches every one of them through this bundle
 *   (`SEED_PLAN_MODULES`), in every mode. The specs import them directly:
 *   vitest resolves both.
 * - THE SERVER'S OWN CODE, by path (`SEED_SERVER_MODULES`), so the seed's
 *   writes are the server's by construction (design §12.5.7, "the seed is
 *   engine output"), never a second copy: `projectClientStats` from
 *   `@core/pipelines` writes `clientStats/{customerId}` and its
 *   `restricted/money` through the server's `firestoreCommitPlan`, under
 *   the policy `firestoreSettingsPorts` reads; `purgeAtFor` is the ONE
 *   `purgeAt` stamp (F1-7) every busy day and waitlist request the seed
 *   writes carries.
 * - THE LOYALTY ENGINE'S READERS (flip 3's, until it lands): the
 *   catalogue as one validated model, the account, family progress, season
 *   tracks and point rows (`readLoyaltyWrites` in `loyalty.mjs` reads each
 *   document back through them before writing it), and the rhythm's
 *   projector, `traceStreak`, with the rule's head and version readers and
 *   the state's write half. Named by FILE, not barrel: the barrel
 *   `@creativo/application/engagement` also exports use cases that reach
 *   for lines the domain barrel does not carry (contract delta R2b-1).
 *   `load-domain.spec.mjs` holds each name equal to the barrel's.
 *
 * `tools/icons/load-ts.mjs` transpiles file by file and follows relative
 * imports only; this graph crosses the `@creativo/*` and `@core/*` path
 * aliases and a few hundred files, so it is BUNDLED instead — with the
 * workspace's own esbuild, reading `tsconfig.base.json` for the aliases.
 * npm packages stay external and resolve from the workspace
 * `node_modules`, which is why the bundle is written under
 * `node_modules/.cache` rather than the OS temp dir; and so does THIS
 * module (`WORKSPACE_ROOT` is computed from where it lies, which a copy
 * inside the bundle would get wrong). Each call bundles into its own
 * directory, so two seeds running at once never import each other's
 * half-written file.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const WORKSPACE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

/** The seed's plan modules the bundle hands out as namespaces, by file. */
export const SEED_PLAN_MODULES = Object.freeze({
  catalog: 'tools/seed/catalog.mjs',
  book: 'tools/seed/fixtures.mjs',
  appointments: 'tools/seed/appointments.mjs',
  loyalty: 'tools/seed/loyalty.mjs',
  promotions: 'tools/seed/promotions.mjs',
  waitlist: 'tools/seed/waitlist.mjs',
  customers: 'tools/seed/fixtures/customers.fixtures.ts',
  users: 'tools/seed/fixtures/users.fixtures.ts',
});

/** The server modules the seed runs by path, relative to the workspace root. */
export const SEED_SERVER_MODULES = Object.freeze({
  commitPlan: 'apps/functions/src/adapters/firestore-tx.adapter',
  ttl: 'apps/functions/src/adapters/firestore-ttl.adapter',
  settings: 'apps/functions/src/adapters/firestore-settings.adapter',
});

/** The loyalty engine's modules the entry names by path (flip 3's). */
export const SEED_DOMAIN_MODULES = Object.freeze({
  loyaltyDocument: 'libs/application/engagement/src/lib/ports/loyalty-document',
  streakProjector: 'libs/domain/engagement/src/lib/loyalty/streak-projector',
});

const ENTRY = `
export { projectClientStats } from '@core/pipelines';
export { firestoreCommitPlan } from './${SEED_SERVER_MODULES.commitPlan}';
export { purgeAtFor } from './${SEED_SERVER_MODULES.ttl}';
export { firestoreSettingsPorts } from './${SEED_SERVER_MODULES.settings}';
${Object.entries(SEED_PLAN_MODULES)
  .map(([name, path]) => `export * as ${name} from './${path}';`)
  .join('\n')}
export {
  activityEntryFromDocument,
  badgeProgressFromDocument,
  ledgerEntryFromDocument,
  loyaltyAccountFromDocument,
  loyaltyCatalogFromDocuments,
  seasonProgressFromDocument,
  streakDefinitionVersionFromDocument,
  streakDefinitionVersionToDocument,
  streakScheduleFromDocument,
  streakScheduleToDocument,
  streakStateToDocument,
} from './${SEED_DOMAIN_MODULES.loyaltyDocument}';
export {
  projectStreak,
  traceStreak,
} from './${SEED_DOMAIN_MODULES.streakProjector}';
export { ServiceCategoryId, ServiceId } from '@creativo/domain/catalog';
`;

/** This very module, imported by the bundle where it lies (see the head of the file). */
const THIS_MODULE = fileURLToPath(import.meta.url);

/**
 * Bare specifiers other than the workspace aliases and JSON stay imports;
 * so does this module, by its file URL.
 */
const externalPackages = {
  name: 'external-packages',
  setup(build) {
    build.onResolve({ filter: /load-domain\.mjs$/ }, (args) =>
      join(args.resolveDir, args.path) === THIS_MODULE
        ? { path: pathToFileURL(THIS_MODULE).href, external: true }
        : undefined,
    );
    build.onResolve({ filter: /^[^./]/ }, (args) =>
      args.path.startsWith('@creativo/') ||
      args.path.startsWith('@core/') ||
      args.path.endsWith('.json')
        ? undefined
        : { path: args.path, external: true },
    );
  },
};

export async function loadSeedDomain() {
  const { build } = await import('esbuild');
  const result = await build({
    stdin: {
      contents: ENTRY,
      resolveDir: WORKSPACE_ROOT,
      sourcefile: 'seed-domain.ts',
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    tsconfig: join(WORKSPACE_ROOT, 'tsconfig.base.json'),
    write: false,
    logLevel: 'error',
    plugins: [externalPackages],
  });

  const cacheDir = join(WORKSPACE_ROOT, 'node_modules/.cache/creativo-seed');
  mkdirSync(cacheDir, { recursive: true });
  const runDir = mkdtempSync(join(cacheDir, 'run-'));
  try {
    const file = join(runDir, 'seed-domain.mjs');
    writeFileSync(file, result.outputFiles[0].contents);
    // A file this function just bundled into its own directory — not input.
    // eslint-disable-next-line no-unsanitized/method
    return await import(pathToFileURL(file).href);
  } finally {
    // Loaded modules live on in memory; the file has done its job.
    rmSync(runDir, { recursive: true, force: true });
  }
}
