import baseConfig from '#eslint-config';

/**
 * The specs' own import rule, read from the root config rather than
 * restated: the layer restrictions without the half that keeps the
 * `@creativo/<lib>/testing` entry points to specs (the root keeps the two
 * apart for exactly this, see its `TESTING_ENTRY_POINT_RESTRICTION`; the
 * staff client card's config does the same for its `src/testing/**`).
 */
const specImports = baseConfig.find(
  (block) =>
    block.files?.includes('**/*.spec.ts') &&
    block.rules?.['no-restricted-imports'] !== undefined,
)?.rules['no-restricted-imports'];
if (specImports === undefined) {
  throw new Error(
    "The root eslint config no longer states the specs' import rule.",
  );
}

export default [
  ...baseConfig,
  {
    // `src/testing.ts` is this lib's testing entry point
    // (`@creativo/application/engagement/testing`) — test support,
    // imported by specs only. Since flip 3 it hands out only the
    // gift vouchers (`giftVoucherFixtures`, read from `@core/testing`)
    // and their in-memory reader, until Phase 4 deletes it.
    files: ['**/src/testing.ts'],
    rules: {
      'no-restricted-imports': specImports,
    },
  },
];
