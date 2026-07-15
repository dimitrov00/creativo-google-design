# Module boundaries

Every Nx project in this workspace carries two independent tags, enforced by
`@nx/enforce-module-boundaries` in `eslint.config.mjs`. Run `nx run <project>:lint`
to see violations; there is no way to bypass the rule short of editing the config.

## `scope:*` — which product surface a project belongs to

| Tag               | Meaning                                                                       | Exists today?                             |
| ----------------- | ----------------------------------------------------------------------------- | ----------------------------------------- |
| `scope:shared`    | Design system: tokens, UI components, cursor lib                              | Yes                                       |
| `scope:showcase`  | The Phase 1 component/token showcase app                                      | Yes                                       |
| `scope:marketing` | Marketing site                                                                | Yes                                       |
| `scope:client`    | Client booking app                                                            | Yes                                       |
| `scope:owner`     | Owner/business dashboard — **also hosts the performer/staff role**, see below | Yes                                       |
| `scope:performer` | Performer/staff app                                                           | Reserved, deliberately unused             |
| `scope:admin`     | Admin back-office                                                             | Reserved                                  |
| `scope:backend`   | Cloud Functions / server-side logic                                           | Yes (added alongside the Foundation pass) |

**Rule:** a project can only depend on projects in its own scope, plus `scope:shared`.
A `scope:client` feature can never import a `scope:owner` feature directly — both
would go through `scope:shared` if they need to share logic. This is why the reserved
scopes are pre-declared in `eslint.config.mjs` even though no `marketing`/`client`/
`owner`/`performer`/`admin` projects exist yet: when app 2 is generated, it just needs
the right tag — the boundary rule requires zero changes.

## Amendments

**`scope:owner` hosts both the owner and performer roles (Foundation pass).** `apps/staff`
is tagged `scope:owner`, not a new `scope:staff`/`scope:performer` deployable — owner and
performer are one internal product surface (dashboards, schedules, appointment management)
for a single-location client with 1-3 staff members, gated by in-app RBAC route guards
rather than a separate Nx scope/app. `scope:performer` stays reserved and unused; revisit
only if a second, operationally-distinct staff app becomes justified (e.g. a future
white-label tenant that wants performer and owner deployed and permissioned completely
independently).

**`scope:backend` added (Foundation pass).** Cloud Functions (`apps/functions`) don't fit
any of the scopes above — those are all frontend-app-shaped. `scope:backend` isn't folded
into `scope:shared` either: `scope:shared` is for framework-agnostic/presentational code
safe for _any_ scope (including the browser) to depend on, whereas Cloud Functions carry
Node-only runtime concerns (`firebase-admin`, service-account credentials) that must never
leak into a browser bundle. `apps/functions` may depend on `scope:backend` and
`scope:shared` only, matching the existing pattern exactly.

**`scope:client`/`scope:owner` do not get their own `type:data-access` libs — reversed
shortly after the Foundation pass.** It briefly had `libs/client/booking-data-access` and
`libs/owner/dashboard-data-access`, following the module-boundaries _rule structure_ (scope
isolation) past the point where it actually applied. That reasoning doesn't hold for
data-access code: **Firestore Security Rules are the real authorization boundary**, not the
Nx lib graph — a Firestore repository reading `tenants/{t}/appointments/{a}` is identical
code whether the caller is `apps/client` or `apps/staff`, because `firestore.rules` already
restricts what each role can read/write. Splitting identical adapter code by scope added no
security and would have repeated on every future feature (rewards, gamification, a blog).
Both libs are deleted; when a frontend Firestore adapter is needed, it lives in
`libs/adapters/firebase/src/lib/adapters/`, implementing the port already declared
in `libs/domain/models` (see `docs/architecture/domain-model.md`) — genuinely shared, not
scope-locked. `scope:client`/`scope:owner` remain reserved for what _is_ legitimately
scope-specific: UI/feature libraries (`type:feature`, `type:ui` beyond the shared design
system) — see the Worked example below.

**`libs/shared/kernel`/`domain-models`/`data-access-firebase` moved to `libs/domain/kernel`,
`libs/domain/models`, `libs/adapters/firebase` (same day).** Same reasoning as the point
above, one level up: `libs/shared/*` had become an undifferentiated bucket holding both the
actual domain layer and genuinely generic design-system infra (`design-tokens`/`ui`/`cursor`)
as six flat peers, which buried the most central part of the system. `scope:*`/`type:*` tags
are unchanged for all three — this was a directory/import-path clarity change only, see
`docs/architecture/domain-model.md`'s "Why `libs/domain/*` and `libs/adapters/*`" section for
the full reasoning. Project names changed too, dropping the now-redundant prefix the new path
already carries: `domain-models` → `models`, `data-access-firebase` → `firebase`.

## `type:*` — architectural layer

| Tag                | Meaning                                                                                |
| ------------------ | -------------------------------------------------------------------------------------- |
| `type:app`         | A deployable application                                                               |
| `type:feature`     | Routed, business-logic library (none yet — first one lands with the booking-flow pass) |
| `type:ui`          | Presentational components only, no business logic or data access                       |
| `type:data-access` | API calls / state                                                                      |
| `type:util`        | Pure helpers with no framework opinions                                                |
| `type:tokens`      | Design tokens — a true dependency-free leaf                                            |

**Rule (layering):**

```
type:app  ──▶  type:feature, type:ui, type:data-access, type:util, type:tokens
type:feature ─▶ type:feature, type:ui, type:data-access, type:util, type:tokens
type:ui  ──▶  type:ui, type:util, type:tokens               (never type:data-access)
type:data-access ─▶ type:data-access, type:util, type:tokens
type:util ──▶ type:util, type:tokens
type:tokens ─▶ type:tokens                                   (never depends on anything else)
```

The important one: **`type:ui` can never depend on `type:data-access`.** This keeps
`libs/shared/ui` purely presentational and safe to reuse across all five product
apps without dragging in any app-specific API/state logic.

## Today's projects

| Project         | Path                        | Tags                               |
| --------------- | --------------------------- | ---------------------------------- |
| `showcase`      | `apps/showcase`             | `scope:showcase`, `type:app`       |
| `marketing`     | `apps/marketing`            | `scope:marketing`, `type:app`      |
| `client`        | `apps/client`               | `scope:client`, `type:app`         |
| `staff`         | `apps/staff`                | `scope:owner`, `type:app`          |
| `functions`     | `apps/functions`            | `scope:backend`, `type:app`        |
| `design-tokens` | `libs/shared/design-tokens` | `scope:shared`, `type:tokens`      |
| `ui`            | `libs/shared/ui`            | `scope:shared`, `type:ui`          |
| `cursor`        | `libs/shared/cursor`        | `scope:shared`, `type:util`        |
| `kernel`        | `libs/domain/kernel`        | `scope:shared`, `type:util`        |
| `models`        | `libs/domain/models`        | `scope:shared`, `type:util`        |
| `firebase`      | `libs/adapters/firebase`    | `scope:shared`, `type:data-access` |
| `i18n`          | `libs/adapters/i18n`        | `scope:shared`, `type:util`        |

Verify the graph matches this table at any time with `nx graph`.

## Worked example

`apps/client`/`apps/staff` currently depend only on `scope:shared` libs (`design-tokens`,
`ui`, `cursor`, `models`, `kernel`, `firebase`, `i18n`) — there is no
`scope:client`/`scope:owner` library yet, and that's correct for where the product is today,
not a gap. The boundary rule is still live and still matters: a deliberately-added
cross-scope import (`libs/owner/dashboard-data-access` from `apps/client`, back when that lib
existed) was confirmed rejected by `nx run client:lint` before it was removed — the rule
works, it just hasn't had a real `scope:client`-vs-`scope:owner` UI conflict to prevent yet.

The next library either app actually needs is a **UI/feature** one — e.g.
`libs/client/booking-feature` (`scope:client,type:feature`), the client-only booking wizard
UI, once that pass lands. Not a data-access lib (see the Amendments entry above for why) and
not created speculatively ahead of that pass.
