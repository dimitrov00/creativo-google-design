# Goal 05 — App shell (`apps/web` composition root)

**Depends on:** 01 + 04 · **Blueprint refs:** §1.3, §1.4, §8 Phase 5

## Kickoff prompt

> Execute Phase 5 of `docs/migration-blueprint.md` (read §1.3 and §1.4 first). Reference for shell behavior: `../v2/apps/web/src/routes/__root.tsx` and `../v2/apps/web/src/lib/auth/` (read-only).
>
> 1. `apps/web/src/app/app.config.ts`: the full Port → Adapter provider map from §1.3 (zoneless, `provideRouter` with component input binding + view transitions with reduced-motion skip, service worker, `provideI18n`, Firebase providers). Adapter classes are named in this file ONLY.
> 2. Route tree per §1.4 with lazy `loadComponent` into the feature libs (placeholder pages until Goal 06). Functional guards: `activeGuard` (anon→/auth, onboarding→/onboarding via EnsureSessionReady) and `rolesGuard` (staff/admin via Principal) — the /auth route itself uses in-component latch logic, not a guard.
> 3. Pre-paint theme script in `index.html` generated from ONE source module (theme + density + lang + meta theme-color; §7.6 fix — constants exist exactly once). Root-provided AccountStateService: single onIdTokenChanged + single users/{uid} snapshot exposing account/principal/claims signals. Shell component hosts SessionExpiryGuard behavior + ImpersonationBanner slot.
> 4. PWA: ngsw config, installability, installed-PWA + active-user redirect from `/` to `/account`. Transloco bg/en wired app-wide; migrate v2's translation catalogs (`../v2/apps/web/src/locales` or equivalent — locate them) into the i18n assets, adapting keys to DomainError codes.
> 5. E2E smoke (Playwright + emulators): app boots, anon hitting /account lands on /auth, non-staff hitting /staff sees Forbidden.

## /goal condition

```
Phase 5 of docs/migration-blueprint.md is complete: (1) apps/web/src/app/app.config.ts provides every InjectionToken from blueprint §1.3 mapped to its infrastructure adapter, and grep shows no adapter class imported anywhere else in apps/web; (2) app.routes.ts matches the §1.4 table with lazy loadComponent and activeGuard/rolesGuard applied to /account, /staff and /admin, while /auth has no route guard; (3) index.html contains a pre-paint script generated from a single theme-constants module (meta theme-color values appear in exactly one source file); (4) Transloco serves bg and en catalogs and translateDomainError resolves at least the domain error codes used by the auth flow; (5) a Playwright smoke suite running against emulators passes: boot renders, anonymous /account redirects to /auth, non-staff /staff renders the Forbidden screen; (6) service worker config exists and `pnpm nx build web` exits 0 with PWA assets emitted; (7) `pnpm nx run-many -t typecheck lint test` exits 0; (8) nothing under ../v2 was modified. Or stop after 50 turns.
```

## Scope guard

- Screens stay placeholders — no feature UI beyond what guards/redirects need.
- No new ports/adapters; if one is missing, stop and flag it rather than inventing wiring outside §1.3.
