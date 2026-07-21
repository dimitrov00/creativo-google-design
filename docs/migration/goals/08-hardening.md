# Goal 08 — Quality & parity hardening

**Depends on:** 06 + 07 · **Blueprint refs:** §8 Phase 8

## Kickoff prompt

> Execute Phase 8 of `docs/migration-blueprint.md`. v2 runs locally as the visual reference (`cd ../v2 && npm run dev`) — never modify it.
>
> 1. Full-page Playwright screenshot suite: every route of `apps/web` in light + dark × bg + en × mobile (390px) + desktop (1280px); compare key pages against the running v2 and reduce diffs to ≤ 1% pixel delta (token/CSS fixes only — no structural rewrites).
> 2. PWA audit: Lighthouse PWA + performance pass on `/`, `/account`, `/book`; offline shell loads; install prompt works.
> 3. Accessibility sweep: axe on every route with zero serious/critical violations; keyboard-only walkthrough of auth, booking and settings flows; focus-visible everywhere.
> 4. Bundle discipline: verify Firestore, Storage and MapLibre are absent from the initial chunk (build stats); set Nx bundle budgets that fail the build on regression.
> 5. **Parity close-out (blueprint §0.5):** audit `docs/migration/v2-parity-checklist.md` against the running apps — every row must be checked with a concrete `apps/web` route/component or `apps/functions` handler filled in. Anything unchecked is missing work: go build it (or, if genuinely obsolete, move it to the "out of scope" section with a one-line justification). Remember `apps/showcase` is an internal design-system workbench, not a product surface — a feature that renders only there does NOT count as migrated, and showcase may import from `libs/ui` only.
> 6. Close out: run the full matrix (`typecheck lint test test-integration e2e`), fix stragglers, update `docs/architecture/domain-deviations.md` to final state.

## /goal condition

```
Phase 8 of docs/migration-blueprint.md is complete: (1) a Playwright screenshot suite covers every route in light and dark, bg and en, mobile and desktop, and passes with committed baselines; (2) documented pixel-diff results against locally running v2 exist for the landing, auth, account, booking and settings pages at ≤1% delta each; (3) axe checks report zero serious or critical violations on all routes; (4) Lighthouse runs (committed reports) show PWA installability and performance ≥90 for /, /account and /book; (5) build stats prove firestore, storage and maplibre chunks are lazy (not in the initial bundle) and bundle budgets are configured in the web project; (6) docs/migration/v2-parity-checklist.md has zero unchecked rows — every row is either checked with a concrete apps/web route or apps/functions handler named in its location column, or moved to the out-of-scope section with a justification; (7) grep confirms apps/showcase imports nothing from libs/features, libs/application, libs/domain or libs/infrastructure (libs/ui only); (8) `pnpm nx run-many -t typecheck lint test` plus the integration and e2e targets all exit 0; (9) nothing under ../v2 was modified. Or stop after 40 turns.
```

## Scope guard

- Fix-forward only: no new features, no schema changes, no API changes without flagging first.
