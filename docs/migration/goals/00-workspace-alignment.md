# Goal 00 — Workspace alignment

**Depends on:** nothing · **Blueprint refs:** §0.3–0.4, §1.1, §1.2, §8 Phase 0

## Kickoff prompt

> Execute Phase 0 of `docs/migration-blueprint.md` (read §0.3, §0.4, §1.1, §1.2 first). Restructure this Nx workspace to the blueprint layout:
>
> 1. Generate empty lib skeletons for `libs/application/{identity,booking,catalog,engagement,accounts,governance,shared}`, `libs/ui/{tokens,modifiers,controls,layout,patterns}`, and `libs/features/` (marketing/landing, client/auth, client/onboarding, client/booking, client/account, staff/dashboard, admin/impersonation) with the tags from blueprint §1.2. Use `nx g` generators (consult the nx-generate skill), Vitest, standalone Angular libs where applicable.
> 2. Move `libs/adapters/firebase` → `libs/infrastructure/firebase-app` and `libs/adapters/i18n` → `libs/infrastructure/i18n` with `nx g mv`; update all `@creativo/*` aliases and imports.
> 3. Move the port interfaces out of `libs/domain/models/src/lib/ports/` into the matching `libs/application/*/ports/` libs; add temporary re-exports from their old location so `apps/functions` keeps compiling, and leave a `TODO(goal-03)` on each re-export.
> 4. Consolidate frontend apps: create `apps/web` (standalone, zoneless, PWA like `apps/client`); move the marketing app's pages/components into `libs/features/marketing/landing`; delete `apps/client`, `apps/staff`, `apps/marketing`. Keep `apps/showcase` and `apps/functions`. `apps/web` gets a placeholder route tree per blueprint §1.4 (empty page components are fine at this phase).
> 5. Add ESLint boundary rules: imports of `firebase/*` and `firebase-admin` allowed only under `libs/infrastructure/**` and `apps/functions/**`; imports of `dinero.js`, `luxon`, `libphonenumber-js` allowed only under `libs/domain/kernel/**`. Update the tag matrix in `eslint.config.mjs` per §1.2 and document the change in `docs/architecture/module-boundaries.md`.
>
> Greenfield rules: never modify anything under `../v2`; do not port feature logic yet; keep every existing test passing.

## /goal condition

```
Phase 0 of docs/migration-blueprint.md is complete in creativo-google-design: (1) `pnpm nx run-many -t typecheck lint test` exits 0 for all projects; (2) directories libs/application, libs/ui, libs/features, libs/infrastructure exist with the sub-libs named in blueprint §1.1, and libs/adapters no longer exists; (3) apps/web exists and apps/client, apps/staff, apps/marketing no longer exist, while apps/showcase and apps/functions still build; (4) grep shows no import of "firebase/" outside libs/infrastructure and apps/functions, and no import of dinero.js, luxon, or libphonenumber-js outside libs/domain/kernel; (5) eslint.config.mjs contains the updated scope/type tag matrix and `nx graph` produces no boundary violations; (6) nothing under ../v2 was modified. Or stop after 40 turns.
```

## Scope guard

- No feature/business logic yet — structure only.
- No token/CSS work (that's Goal 01), no new domain code (Goal 02).
- Marketing components may be moved verbatim (imports fixed) — visual refactoring comes later.
