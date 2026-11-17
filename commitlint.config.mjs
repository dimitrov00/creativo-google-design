// The commit grammar (ADR docs/architecture/decisions/2026-11-18-releases-and-environments.md,
// R3–R4): Conventional Commits, checked on every PR title by the required
// `pr-title` job (.github/workflows/pr-title.yml) — the title IS the squash
// commit on main — and on local commits by the husky commit-msg hook.
// release-please reads the same grammar to choose the next version.

/** The types a commit may have — release-please's changelog sections name each one. */
export const COMMIT_TYPES = [
  'feat',
  'fix',
  'perf',
  'refactor',
  'docs',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
];

/**
 * The longest header. The repository's titles run long by taste, and every
 * PR title in its history fits; GitHub appends ` (#123)` to the squash
 * commit on main, past this check.
 */
export const HEADER_MAX_LENGTH = 160;

export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', COMMIT_TYPES],
    'header-max-length': [2, 'always', HEADER_MAX_LENGTH],
    // A scope is lower-case (`team`, `identity`, `release/v0.4`).
    'scope-case': [2, 'always', 'lower-case'],
    // A subject may start with a name: «Apple Health columns», «G5 specs».
    'subject-case': [0],
    // A squash commit's body is the PR description: markdown, links and
    // tables, whose lines are as long as they need to be.
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
};
