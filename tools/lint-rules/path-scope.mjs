/**
 * The path scope shared by the four UI-residue guards
 * (`creativo/no-undecorated-class`, `creativo/no-ambient-clock`,
 * `creativo/no-generic-discriminator`, `creativo/no-hand-built-load-slice`;
 * `ui-residue-cleanup.md` §3 "Scoping").
 *
 * ESLint resolves a config block's `files`/`ignores` against a base path
 * that depends on how it is invoked: the `@nx/eslint:lint` executor runs
 * from the workspace root with `overrideConfigFile`, while directory lookup
 * (an IDE, `eslint` run inside a project) loads the project's nested
 * `eslint.config.mjs` with the project dir as base. A repo-root-relative
 * glob is silently off under one of the two. So the blocks registering
 * these rules use only base-path-independent patterns (`**\/*.ts` plus
 * `**\/`-prefixed ignores), and each rule decides its own scope from
 * path-FRAGMENT options matched against `context.physicalFilename`
 * (normalised to `/`, the `icon-registry-only` `allowInlineSvg` precedent):
 *
 *   - `include` — the rule runs only on a file whose path contains one of
 *     these fragments (`'/libs/'`, `'/apps/web/src/'`); absent → every file;
 *   - `allowIn` — a file whose path contains one of these is skipped.
 *
 * `pathScope` is that one reading. A helper module, not a rule: `index.mjs`
 * registers no rule from it.
 */

/** The JSON-schema properties of the path-fragment options. */
export const PATH_FRAGMENTS = {
  type: 'array',
  items: { type: 'string', minLength: 1 },
};

/**
 * The file's path as the scope options see it: `/`-separated and rooted with
 * a leading `/`, so a fragment such as `'/libs/'` matches an absolute path
 * and a relative one (`libs/x.ts`, as RuleTester or `--stdin-filename` may
 * pass it) alike.
 */
export function scopedPath(context) {
  const raw = String(context.physicalFilename ?? context.filename ?? '');
  const path = raw.split('\\').join('/');
  return path.startsWith('/') ? path : `/${path}`;
}

/**
 * Reads the rule's first option against the linted file:
 * `listed(key)` — does the path contain a fragment of `options[key]`;
 * `active` — `include` matches (or is absent) and `allowIn` does not.
 */
export function pathScope(context) {
  const path = scopedPath(context);
  const options = context.options[0] ?? {};
  const listed = (key) =>
    (options[key] ?? []).some((fragment) => path.includes(fragment));
  const included = options.include === undefined || listed('include');
  return { path, listed, active: included && !listed('allowIn') };
}
