// The Firebase projects of the owner's OLD, live React app (ADR
// docs/architecture/decisions/2026-11-18-releases-and-environments.md, E11).
// This product never deploys to, reads from, configures or reuses them; a
// later migration moves their data into this product's own projects.
//
// The one list for JavaScript: the preflight's P6 and its escape hatch
// (tools/verify/preflight/preflight.mjs) and the deploy's checkout pointer
// (tools/release/deploy-target.mjs) and its invoker check
// (tools/release/callable-invokers.mjs) refuse through it. The ops scripts hold
// the same list for bash (tools/ops/lib/legacy-projects.sh) and each deploy
// workflow in its first step, which reads no repository code;
// tools/verify/legacy/legacy-projects.spec.mjs holds the three equal and
// fails on either id anywhere else in a config, workflow or environment file.

/** The legacy project ids. */
export const LEGACY_PROJECT_IDS = Object.freeze([
  'creativo-prod',
  'creativo-staging',
]);

/** Whether `projectId` is one of the legacy projects. */
export function isLegacyProject(projectId) {
  return LEGACY_PROJECT_IDS.includes(projectId);
}

/** The sentence every refusal prints. */
export function legacyRefusal(projectId) {
  return `${projectId} runs the owner's old, live app — this product never deploys to it, reads it or configures it (ADR 2026-11-18, E11)`;
}

/** Every legacy id `text` names as a whole project id (not inside a longer id). */
export function legacyIdsIn(text) {
  return LEGACY_PROJECT_IDS.filter((id) =>
    new RegExp(`(?<![a-z0-9-])${id}(?![a-z0-9-])`).test(text),
  );
}
