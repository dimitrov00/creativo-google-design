# Sourced by every project-scoped tools/ops script: the Firebase projects of
# the owner's OLD, live React app, refused before anything is printed or run,
# dry run included (ADR docs/architecture/decisions/2026-11-18-releases-and-environments.md,
# E11). The same list as tools/release/legacy-projects.mjs and the deploy
# workflows' first step — tools/verify/legacy/legacy-projects.spec.mjs holds
# them equal.

LEGACY_PROJECT_IDS=(creativo-prod creativo-staging)

# Exits 2 when the project is a legacy one.
refuse_legacy_project() {
  local id
  for id in "${LEGACY_PROJECT_IDS[@]}"; do
    if [ "$1" = "$id" ]; then
      echo "refused: $1 runs the owner's old, live app — this product never deploys to it, reads it or configures it (ADR 2026-11-18, E11)" >&2
      exit 2
    fi
  done
}
