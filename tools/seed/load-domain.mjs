/**
 * The production TypeScript the seed runs in-process: the appointment
 * mapper's reader and the functions' own `recomputeClientStats`, so the
 * `clientStats` the seed writes are the trigger's answer by construction
 * (design §12.5.7, "the seed is engine output"), not a second copy of it.
 *
 * And the READERS of what the seed writes for the client card
 * (client-card-redesign.md §4.4, §4.6): the loyalty mappers the client
 * card's adapters run — the catalogue as one validated model, the account,
 * family progress, season tracks and point rows — and the waitlist
 * request's, with `CalendarDay` for its lapse rule. The seed reads each
 * document back through them before writing it (`readLoyaltyWrites` in
 * `loyalty.mjs`), so a document the card could not read stops the seed.
 *
 * Since revision 3 of the client card (client-card-revision-3.md §4) also:
 *
 * - THE RHYTHM'S PROJECTOR, `traceStreak`. The seed held a copy of the
 *   rule's clock (`rhythmOf`); it now folds each holder's visits through
 *   the domain's own, under the rule the shop has in force, so a rule the
 *   admin publishes moves Георги's and Мартин's cards on the next run;
 * - the rule's head and its versions, read and written
 *   (`streakScheduleFromDocument`, `streakDefinitionVersion…`), and the
 *   state's write half (`streakStateToDocument`);
 * - the activity feed's reader (`activityEntryFromDocument`), which reads
 *   every kind of row the journal now holds;
 * - the gift voucher's and the coupon's mappers, both halves, so a
 *   voucher with a holder and the birthday coupon's occasion read back
 *   before they are written (`promotions.mjs`).
 *
 * ### Why the entry names FILES, not barrels, for the engagement libs
 * A bundle follows every import of every module it reaches. The barrel
 * `@creativo/application/engagement` also exports the use cases, and one of
 * them imports `projectStreak` from the barrel `@creativo/domain/engagement`,
 * which does not carry the projector's line yet (contract delta R2b-1): the
 * bundle of the barrel does not build, and the seed could not run at all.
 * The modules below are the ones the barrels re-export, by their own
 * paths: the same code, and a bundle that builds before and after that
 * line lands. `load-domain.spec.mjs` holds each name equal to the one the
 * barrel hands out.
 *
 * `tools/icons/load-ts.mjs` transpiles file by file and follows relative
 * imports only; this graph crosses the `@creativo/*` and `@core/*` path aliases and a
 * hundred-odd files, so it is BUNDLED instead — with the workspace's own
 * esbuild, reading `tsconfig.base.json` for the aliases. npm packages stay
 * external and resolve from the workspace `node_modules`, which is why the
 * bundle is written under `node_modules/.cache` rather than the OS temp dir.
 * Each call bundles into its own directory, so two seeds running at once
 * (the e2e workers do) never import each other's half-written file.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const WORKSPACE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

/** The modules the entry names by path, relative to the workspace root. */
export const SEED_DOMAIN_MODULES = Object.freeze({
  loyaltyDocument: 'libs/application/engagement/src/lib/ports/loyalty-document',
  giftVoucherDocument:
    'libs/application/engagement/src/lib/ports/gift-voucher-document',
  streakProjector: 'libs/domain/engagement/src/lib/loyalty/streak-projector',
  couponPersistence: 'libs/infrastructure/firestore/src/lib/coupon-persistence',
});

const ENTRY = `
export {
  loadClientStatsPolicy,
  recomputeClientStats,
} from './apps/functions/src/lib/clients/recompute-client-stats';
export {
  appointmentFromDocument,
  waitlistFromDocument,
  waitlistToDocument,
} from '@creativo/application/booking';
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
  giftVoucherFromDocument,
  giftVoucherToDocument,
} from './${SEED_DOMAIN_MODULES.giftVoucherDocument}';
export {
  projectStreak,
  traceStreak,
} from './${SEED_DOMAIN_MODULES.streakProjector}';
export {
  couponFromPersistence,
  couponToPersistence,
} from './${SEED_DOMAIN_MODULES.couponPersistence}';
export {
  CalendarDay,
  ClientStatsPolicy,
  computeClientStats,
} from '@creativo/domain/scheduling';
export { ServiceCategoryId, ServiceId } from '@creativo/domain/catalog';
export { UserId } from '@creativo/domain/accounts';
`;

/** Bare specifiers other than the workspace aliases and JSON stay imports. */
const externalPackages = {
  name: 'external-packages',
  setup(build) {
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
