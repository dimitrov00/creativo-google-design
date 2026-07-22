# Module boundaries

Every Nx project in this workspace carries two independent tags, enforced by
`@nx/enforce-module-boundaries` in `eslint.config.mjs`. Run `nx run <project>:lint`
to see violations; there is no way to bypass the rule short of editing the config.

**This doc reflects the Phase 0 (workspace alignment) layout** — see
`docs/migration-blueprint.md` §1.1/§1.2 for the target architecture and
`docs/migration/goals/00-workspace-alignment.md` for the pass that produced it.
The pre-Phase-0 tag matrix (scope:owner/performer, type:data-access,
`libs/adapters/*`) is superseded; see "Amendments" for the history.

## `scope:*` — which product surface a project belongs to

| Tag               | Meaning                                                                               | Exists today?                        |
| ----------------- | ------------------------------------------------------------------------------------- | ------------------------------------ |
| `scope:shared`    | Design system + hexagon core: tokens, ui, domain, application, infrastructure, cursor | Yes                                  |
| `scope:showcase`  | The design-system/token showcase app                                                  | Yes                                  |
| `scope:marketing` | Marketing feature slice(s)                                                            | Yes (`features/marketing/landing`)   |
| `scope:client`    | Client booking/account feature slices                                                 | Yes (`features/client/*`)            |
| `scope:staff`     | Staff/performer dashboard feature slice                                               | Yes (`features/staff/dashboard`)     |
| `scope:admin`     | Admin back-office feature slice                                                       | Yes (`features/admin/impersonation`) |
| `scope:backend`   | Cloud Functions / server-side logic                                                   | Yes                                  |
| `scope:web`       | The single consolidated SPA shell (`apps/web`)                                        | Yes                                  |

**Rule:** a project can only depend on projects in its own scope, plus
`scope:shared`. A `scope:client` feature can never import a `scope:staff`
feature directly — both would go through `scope:shared` (i.e. `application`/
`domain`/`ui`) if they need to share logic.

**`scope:web` is the one exception**, by design: `apps/web` is the single app
that composes every product surface (marketing at `/`, client at `/auth`
`/onboarding` `/book` `/account`, staff at `/staff`, admin at `/admin` — see
blueprint §1.4), so it's allowed to depend on `scope:marketing`, `scope:client`,
`scope:staff`, `scope:admin`, and `scope:shared` all at once. The isolation
rule still does real work at the _feature_ level: `libs/features/client/*`
still cannot reach into `libs/features/staff/*` directly.

## `type:*` — architectural layer

| Tag                   | Meaning                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| `type:app`            | A deployable application                                                                                   |
| `type:feature`        | Routed, business-logic presentation slice (`libs/features/*`)                                              |
| `type:application`    | Ports (interfaces + `InjectionToken`s) + use-cases (`libs/application/*`)                                  |
| `type:ui`             | Presentational components/modifiers only, no business logic or data access (`libs/ui/*`, `libs/shared/ui`) |
| `type:infrastructure` | Adapters — the only libs allowed to import `firebase/*` (`libs/infrastructure/*`)                          |
| `type:domain`         | Hexagon core — entities/VOs/domain events, zero Angular/Firebase (`libs/domain/*`)                         |
| `type:util`           | Pure helpers with no framework opinions (`libs/shared/cursor`)                                             |
| `type:tokens`         | Design tokens — a true dependency-free leaf (`libs/shared/design-tokens`, `libs/ui/tokens`)                |

**Rule (layering, blueprint §1.2):**

```
type:app            ──▶ feature, application, ui, infrastructure, domain, util, tokens
type:feature         ─▶ feature, application, ui, infrastructure, util
type:application     ─▶ application, domain, util
type:ui              ──▶ ui, tokens, util                    (never application or infrastructure)
type:infrastructure  ─▶ application, domain, util             (never ui or feature)
type:domain          ─▶ domain                                (never depends on application/infrastructure/ui)
type:util            ──▶ util, tokens
type:tokens          ─▶ tokens                                (never depends on anything else)
```

The critical arrow is **`ui` never sees `application` or `infrastructure`** —
that's the one that keeps the design system reusable across every product
surface without dragging in app-specific ports or Firebase. `type:feature`
is allowed a direct `type:infrastructure` dependency (e.g.
`libs/features/marketing/landing`'s `language.service.ts` reads
`SupportedLang` from `@creativo/infrastructure/i18n`) — narrow,
cross-cutting infrastructure like i18n locale types doesn't warrant a
dedicated `application` port the way a Firestore repository does, and this
mirrors how `apps/*` composition roots always could. **`application` never
sees Angular templates or Firebase** (it may only import
`InjectionToken`/`inject` from `@angular/core`). **`infrastructure` is the
only place `firebase/*` resolves** (apart from `apps/functions`, which
imports `firebase-admin` directly since it's the Cloud Functions backend,
not a browser bundle) — enforced by a `no-restricted-imports` rule in the
root `eslint.config.mjs` restricting `firebase`/`firebase/*`/
`firebase-admin`/`firebase-admin/*`. A parallel rule in the same block
restricts `dinero.js`/`luxon`/`libphonenumber-js` to `libs/domain/kernel/**`
— everywhere else goes through `Money`/`ZonedDateTime`/`PhoneNumber`.

**Implementation note:** both rules are declared _unconditionally_ in the
root config (no `ignores`), because Nx's `lint` target runs
`eslint .` with `cwd` set to **the project's own directory** — so
`ignores: ['**/libs/infrastructure/**']` in the root config can never match
once ESLint's basePath already _is_ `libs/infrastructure/firebase-app` (the
prefix that pattern is looking for has already been stripped away). Instead,
the four exempt projects (`libs/domain/kernel`, `libs/infrastructure/*`,
`apps/functions`) each override the rule in their _own_
`eslint.config.mjs`, re-declaring only the half of the restriction that
still applies to them.

## Temporary duplication: `libs/domain/models/src/lib/ports/*`

The port interfaces that used to live in `libs/domain/models/src/lib/ports/`
moved to their matching `libs/application/*/ports/` lib (blueprint §0.3's
"ports move to `libs/application`" decision) — but `apps/functions` still
imports them from `@creativo/domain/models`. Rather than re-exporting
(`export * from '@creativo/application/...'`), which would make
`domain/models` (`type:domain`) depend on `type:application` and — because
those same `application/*` ports import entities back from
`@creativo/domain/models` — create a circular TypeScript project reference
(`domain/models → application/identity → domain/models`) that breaks
composite builds (`TS6059`/`TS6307` rootDir errors), **each old port file is
temporarily duplicated verbatim** in both locations, with a `TODO(goal-03)`
comment on the `domain/models` copy pointing at its new canonical home.
**Delete the `domain/models` copies once goal-03** (application layer) ports
every `apps/functions` consumer over to importing directly from
`@creativo/application/*`.

## Amendments

**Phase 0 (workspace alignment) supersedes the scope/type matrix below this
line.** Kept for history — the reasoning about _why_ boundaries matter still
applies, only the concrete tag names changed:

**`scope:owner`/`scope:performer` → `scope:staff`.** The pre-migration
workspace hosted the staff/performer role inside `apps/staff` tagged
`scope:owner` (with `scope:performer` reserved-unused). Phase 0 folds
`apps/staff` into `apps/web` as `libs/features/staff/dashboard`, tagged
`scope:staff` to match the blueprint's four-scope frontend vocabulary
(`marketing`/`client`/`staff`/`admin`). The underlying reasoning (staff and
performer are one internal product surface, gated by in-app RBAC rather than
a separate scope) is unchanged.

**`type:data-access` → `type:infrastructure` (adapters) + `type:application`
(ports).** The pre-migration workspace had no ports/adapters split at the
type-tag level — `libs/adapters/firebase` was tagged `type:data-access` and
port _interfaces_ lived alongside entities in `libs/domain/models` untagged
separately. Phase 0 gives ports their own layer (`type:application`,
`libs/application/*`) per blueprint §0.3, and `type:data-access` is retired
in favor of `type:infrastructure` for the adapters that implement those
ports. `scope:client`/`scope:staff` still do not get their own data-access
libs — Firestore Security Rules remain the real authorization boundary, not
the Nx lib graph (unchanged reasoning from the original Foundation pass).

**`libs/adapters/*` → `libs/infrastructure/*` (Phase 0, `nx g mv`).**
`libs/adapters/firebase` → `libs/infrastructure/firebase-app`,
`libs/adapters/i18n` → `libs/infrastructure/i18n` — mechanical moves,
project names changed too (`firebase` → `firebase-app`) to match the
blueprint's `libs/infrastructure/firebase-app` naming (§1.1, since more
Firebase-adjacent infra libs — `firebase-auth`, `firestore`, `storage`,
`web-storage` — land in later phases and need `firebase-app` to mean
specifically the SDK-singleton providers, not "all things Firebase").

**`libs/shared/kernel`/`domain-models`/`data-access-firebase` moved to
`libs/domain/kernel`, `libs/domain/models`, `libs/adapters/firebase` (same
day, pre-migration).** Same reasoning one level up: `libs/shared/*` had
become an undifferentiated bucket holding both the domain layer and the
generic design-system infra. `scope:*`/`type:*` tags were unchanged for all
three at the time — see `docs/architecture/domain-model.md`'s "Why
`libs/domain/*` and `libs/adapters/*`" section for the full reasoning
(the `libs/adapters/*` half of that is itself now superseded by the
`libs/infrastructure/*` move above).

## Today's projects

| Project                | Path                                | Tags                                  |
| ---------------------- | ----------------------------------- | ------------------------------------- |
| `web`                  | `apps/web`                          | `scope:web`, `type:app`               |
| `showcase`             | `apps/showcase`                     | `scope:showcase`, `type:app`          |
| `functions`            | `apps/functions`                    | `scope:backend`, `type:app`           |
| `identity`             | `libs/application/identity`         | `scope:shared`, `type:application`    |
| `booking`              | `libs/application/booking`          | `scope:shared`, `type:application`    |
| `catalog`              | `libs/application/catalog`          | `scope:shared`, `type:application`    |
| `engagement`           | `libs/application/engagement`       | `scope:shared`, `type:application`    |
| `accounts`             | `libs/application/accounts`         | `scope:shared`, `type:application`    |
| `governance`           | `libs/application/governance`       | `scope:shared`, `type:application`    |
| `shared` (application) | `libs/application/shared`           | `scope:shared`, `type:application`    |
| `tokens`               | `libs/ui/tokens`                    | `scope:shared`, `type:tokens`         |
| `modifiers`            | `libs/ui/modifiers`                 | `scope:shared`, `type:ui`             |
| `controls`             | `libs/ui/controls`                  | `scope:shared`, `type:ui`             |
| `layout`               | `libs/ui/layout`                    | `scope:shared`, `type:ui`             |
| `patterns`             | `libs/ui/patterns`                  | `scope:shared`, `type:ui`             |
| `marketing-landing`    | `libs/features/marketing/landing`   | `scope:marketing`, `type:feature`     |
| `client-auth`          | `libs/features/client/auth`         | `scope:client`, `type:feature`        |
| `client-onboarding`    | `libs/features/client/onboarding`   | `scope:client`, `type:feature`        |
| `client-booking`       | `libs/features/client/booking`      | `scope:client`, `type:feature`        |
| `client-account`       | `libs/features/client/account`      | `scope:client`, `type:feature`        |
| `staff-dashboard`      | `libs/features/staff/dashboard`     | `scope:staff`, `type:feature`         |
| `admin-impersonation`  | `libs/features/admin/impersonation` | `scope:admin`, `type:feature`         |
| `firebase-app`         | `libs/infrastructure/firebase-app`  | `scope:shared`, `type:infrastructure` |
| `i18n`                 | `libs/infrastructure/i18n`          | `scope:shared`, `type:infrastructure` |
| `kernel`               | `libs/domain/kernel`                | `scope:shared`, `type:domain`         |
| `models`               | `libs/domain/models`                | `scope:shared`, `type:domain`         |
| `domain-identity`      | `libs/domain/identity`              | `scope:shared`, `type:domain`         |
| `domain-accounts`      | `libs/domain/accounts`              | `scope:shared`, `type:domain`         |
| `domain-scheduling`    | `libs/domain/scheduling`            | `scope:shared`, `type:domain`         |
| `domain-catalog`       | `libs/domain/catalog`               | `scope:shared`, `type:domain`         |
| `domain-engagement`    | `libs/domain/engagement`            | `scope:shared`, `type:domain`         |
| `domain-governance`    | `libs/domain/governance`            | `scope:shared`, `type:domain`         |
| `design-tokens`        | `libs/shared/design-tokens`         | `scope:shared`, `type:tokens`         |
| `ui` (shared)          | `libs/shared/ui`                    | `scope:shared`, `type:ui`             |
| `cursor`               | `libs/shared/cursor`                | `scope:shared`, `type:util`           |

**Why `domain-*` project names for the six new bounded contexts** (Goal 02):
Nx project names are workspace-unique regardless of directory, and
`libs/application/{identity,accounts,catalog,engagement,governance}` (Goal 00) already claimed the unprefixed names — `libs/domain/identity`'s Nx
project is therefore `domain-identity`, not `identity`, and likewise for
the other five. `kernel`/`models` predate this collision (no
`libs/application/kernel` or `.../models` exists) so they keep their plain
names. Import paths are unaffected either way — every one of these
resolves via its own `@creativo/domain/<name>` TS path alias, never by Nx
project name.

Verify the graph matches this table at any time with `nx graph`.

## Worked example

`apps/web` depends on `libs/features/marketing/landing` (`scope:marketing`),
`libs/features/client/*` (`scope:client`), `libs/features/staff/dashboard`
(`scope:staff`), `libs/features/admin/impersonation` (`scope:admin`), and any
`scope:shared` lib it needs directly (e.g. `libs/infrastructure/firebase-app`
and `libs/infrastructure/i18n` for its composition root) — all legal because
`apps/web` is tagged `scope:web`. A `libs/features/client/booking` import of
`libs/features/staff/dashboard` would still be rejected: `scope:client` may
only depend on `scope:client` + `scope:shared`, and `scope:staff` is neither.
That's the boundary doing its job — client and staff feature slices share
logic through `application`/`domain`/`ui` (`scope:shared`), never directly.
