# Module boundaries

Every Nx project in this workspace carries two independent tags, a `scope:*`
and a `type:*`, enforced by `@nx/enforce-module-boundaries` in the root
`eslint.config.mjs` (its `depConstraints` are the only ones: `nx.json` carries
none). Run `pnpm nx run <project>:lint` to see violations; there is no way
around the rule short of editing the config. Inside `libs/ecs-core` the tags
stop and `CLAUDE.md` Law 8's tier hierarchy takes over (below).

Rewritten 2026-10-23 from the post-Phase-4b graph. `libs/application/*` and
`libs/domain/*` (the kernel and `libs/domain/models` included) were deleted in
Phase 4b, and the `type:application` tag went with them; `libs/ecs-core` is
the whole domain layer. `CLAUDE.md` Laws 1–9 govern the shape of the code;
this doc covers only who may import whom.

## `scope:*` — which part of the product a project belongs to

| Tag              | Meaning                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `scope:shared`   | The ECS core, the design system and the adapters: `libs/ecs-core`, `libs/ui/*`, `libs/shared/*`, `libs/infrastructure/*` |
| `scope:app`      | Every `type:feature` slice — marketing, client, staff, admin, the shared shell, catalogue and visits (`libs/features/*`) |
| `scope:web`      | The single consolidated SPA (`apps/web`)                                                                                 |
| `scope:showcase` | The design-system workbench (`apps/showcase`)                                                                            |
| `scope:backend`  | Cloud Functions (`apps/functions`) — see [`scope:backend`](#scopebackend)                                                |
| `scope:tooling`  | Workspace tooling projects under `tools/` (lint rules, icons, flags, seed, verify, the root scripts)                     |

**Rules** (the root `depConstraints`, scope half):

```
scope:shared    ──▶ shared
scope:app       ──▶ app, shared
scope:web       ──▶ web, app, shared
scope:showcase  ──▶ showcase, shared
scope:backend   ──▶ backend, shared
```

A feature may import any other feature (`scope:app` → `scope:app`), but no
`scope:shared` project — the ECS core, the design system, the adapters — can
ever import a feature, the SPA or the functions. `scope:web` additionally
depends on `scope:app`: `apps/web` composes every surface (marketing at `/`,
client at `/auth` `/onboarding` `/book` `/account`, staff at `/staff`, admin
at `/admin`).

**No `depConstraints` row names `scope:tooling`.** A tooling project's scope
is therefore unconstrained (its `type:*` row still applies), and because every
other scope's row omits it, no product project may depend on a tooling
project. `tools/lint-rules` (the local ESLint plugin) is imported by the root
`eslint.config.mjs` by relative path, outside any project; a nested project's
`eslint.config.mjs` names the root config `#eslint-config` (the root
`package.json` `imports` entry) and never imports `tools/lint-rules` itself — a
direct import would give that project a graph edge to `lint-rules` (for
`apps/functions`, eslint's parsers in its generated `package.json`, caught by
`tools/verify/p0/functions-deps.mjs`).

## scope:backend

`apps/functions` (Firebase Cloud Functions gen 2, Node 22) is the backend
composition root: it binds the `@core/ports` bundles to its Firebase Admin
adapters (`apps/functions/src/adapters/*.adapter.ts`), wires the
`@core/pipelines` use cases in `src/main.ts`, and answers the callables
through `src/edge.ts` and `src/wire/*`. It gets a scope of its own rather than
`scope:shared` or `scope:app` because:

- **Nothing may depend on it.** It is a deployable app, not a library; its
  row's absence from every other scope's list makes an import of it a lint
  error.
- **It may depend only on `scope:shared`** — in practice `libs/ecs-core`
  through the eight `@core/*` aliases. A `scope:backend` → `scope:app` edge
  (an Angular feature slice) is a lint error, which keeps `@angular/*` out of
  the functions bundle; the build-time half of that guarantee is the
  forbidden-key check of `tools/verify/p0/functions-deps.mjs` (no
  `@angular/*`, `luxon` or `dinero.js` in `dist/apps/functions/package.json`),
  run by `node tools/verify/p0/check-functions-deps.mjs` against
  `functions-deps.baseline.json`.
- **Its import cage differs from the browser's.** It is one of the exempt
  zones for `firebase-admin` (below), and its own `eslint.config.mjs` installs
  `ecsProjectBlocks()` — the `InjectionToken` guard on every file (the backend
  composes ports as closure parameters, never through a container) and the
  eight ECS suffix blocks.

## `type:*` — architectural layer

| Tag                   | Meaning                                                                                                                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type:app`            | A deployable application (`apps/web`, `apps/showcase`, `apps/functions`)                                                                                                                                        |
| `type:feature`        | A routed presentation slice: Angular components, stores and their templates, reading `@core/*` data and calling `@core/systems` directly (`libs/features/*`)                                                    |
| `type:ui`             | The design system: presentational components and modifiers, no business logic or data access (`libs/ui/*`)                                                                                                      |
| `type:infrastructure` | Adapters implementing `@core/ports` bundles over one SDK each, the web's `InjectionToken` wiring and the SDK providers (`libs/infrastructure/*`)                                                                |
| `type:domain`         | `libs/ecs-core` **only** (D10(a)): primitives, components, entities, ports, systems and pipelines — pure TypeScript, zero Angular, zero Firebase                                                                |
| `type:util`           | Pure helpers with no framework opinions (`libs/shared/view-state`), and the `scope:tooling` projects `tools/lint-rules`, `tools/icons`, `tools/flags` (Node scripts, `.mjs` — outside the `.ts` rules, below)   |
| `type:tokens`         | Design tokens — a true dependency-free leaf (`libs/ui/tokens`: the `--sys-*` CSS, the baseline reset and reduced-motion sheets, the theme vocabulary)                                                           |
| `type:tooling`        | Workspace tooling whose inputs are typed against the ECS core (`tools/seed`, the `seed-tools` project; `tools/verify`, whose production preflight runs the domain through `tools/seed/load-domain.mjs` — OR-35) |

**Rule** (the root `depConstraints`, layer half):

```
type:app             ──▶ feature, ui, infrastructure, domain, util, tokens
type:feature         ──▶ feature, ui, infrastructure, domain, util
type:ui              ──▶ ui, tokens, util, domain           (never infrastructure or feature)
type:infrastructure  ──▶ infrastructure, domain, util       (never ui or feature)
type:domain          ──▶ domain                             (libs/ecs-core depends on nothing else)
type:util            ──▶ util, tokens
type:tokens          ──▶ tokens                             (never depends on anything else)
type:tooling         ──▶ tooling, util, domain              (never infrastructure)
```

Why each arrow:

- **`ui` never sees `infrastructure`** — the arrow that keeps the design
  system reusable without dragging in ports, adapters or Firebase. `type:ui`
  may depend on `type:domain` (added 2026-07-25 for `UiPhoneField`): the ECS
  core is pure TypeScript, so a DS composite may read its plain data and call
  its pure systems — the month picker's `CalendarGridSystem`, the phone
  field's `PhoneSystem` (imported lazily from `@core/systems`, owner ruling
  F6, `.claude/rules/ecs-layering.md`) — without any app wiring.
- **`feature` → `domain`** (D10(a), 2026-10-10): a feature reads the plain ECS
  data and calls the pure systems of `libs/ecs-core` straight from its stores
  and `computed()`s; there is no view-model layer in between
  (`.claude/rules/angular-ui.md`). A feature reaches I/O only through an
  `InjectionToken` typed against an `@core/ports` bundle (Law 9.1,
  `libs/infrastructure/firebase-app/src/lib/ports.tokens.ts`).
- **`feature` → `infrastructure`** directly: the tokens above live there, and
  narrow cross-cutting infrastructure (the i18n locale types, the language
  service) needs no port of its own — the same edge `apps/*` composition
  roots always had.
- **`infrastructure` → `infrastructure`** (Goal 04): the Firebase-backed
  adapter libs (`firestore`, `firebase-auth`, `storage`) take the
  `FIREBASE_*` SDK singletons from `infrastructure/firebase-app`; that is the
  one legitimate infra → infra edge, not a licence for one adapter concern to
  reach into an unrelated one.
- **`domain` → `domain` only**: `libs/ecs-core` imports no other project.
- **`tooling` → `domain`** (2026-10-10, ECS Phase 3a): `seed-tools`' fixture
  bodies (`tools/seed/fixtures/*.ts`) import their archetype from
  `@core/entities` to `satisfies Body<X>` it, which the `type:util`
  row forbids. Never infrastructure: a fixture is a document body, not an
  adapter's input.

## Inside `type:domain` — the Law 8 tiers

`libs/ecs-core` has no root barrel and no `@creativo/ecs-core` alias. It is
imported only through its tier barrels (`tsconfig.base.json`, paths written
relative):

| Alias              | Barrel                                  | May import                                               |
| ------------------ | --------------------------------------- | -------------------------------------------------------- |
| `@core/primitives` | `libs/ecs-core/src/primitives/index.ts` | nothing from the library                                 |
| `@core/errors`     | `libs/ecs-core/src/errors/index.ts`     | primitives                                               |
| `@core/components` | `libs/ecs-core/src/components/index.ts` | errors, primitives                                       |
| `@core/entities`   | `libs/ecs-core/src/entities/index.ts`   | components, errors, primitives                           |
| `@core/ports`      | `libs/ecs-core/src/ports/index.ts`      | entities, components, errors, primitives                 |
| `@core/systems`    | `libs/ecs-core/src/systems/index.ts`    | entities, components, errors, primitives                 |
| `@core/pipelines`  | `libs/ecs-core/src/pipelines/index.ts`  | systems, ports, entities, components, errors, primitives |
| `@core/testing`    | `libs/ecs-core/src/testing/index.ts`    | every tier — imported from specs and test support only   |

`@core/errors` (owner ruling 2026-10-23) holds every error dictionary and
struct union as `errors/<domain>.error.ts` — the Error file kind; only
`PrimitiveError` stays below it, in `primitives/primitive.error.ts`.
`creativo/error-dictionary-home` keeps an `*ErrorCode` / `*RefusalCode`
dictionary out of every other file, repo-wide.

Because the library imports its own tier aliases across tiers, the root
`@nx/enforce-module-boundaries` options set `allowCircularSelfDependency:
true`. The one-way tier table is enforced twice: by
`libs/ecs-core/eslint.config.mjs` (`no-restricted-imports` per tier and file
kind, plus `creativo/no-restricted-import-expressions` for `import()` and
`import('…')` type queries) and by the layering verifier
`tools/verify/layering/check-layering.mjs`
(`pnpm nx run verify-tools:layering --skip-nx-cache`: the hierarchy, runtime
import cycles, barrel contents, one home tier per exported name, and no deep
relative import of code — three or more `../` — anywhere in the monorepo).

## Import cages (`no-restricted-imports`)

Read off the root `eslint.config.mjs` and the project configs that restate it.
The root declares the rule **unconditionally** on every `**/*.ts`, `**/*.tsx`,
`**/*.js`, `**/*.jsx` file, because ESLint's basePath depends on how it is
invoked: the `@nx/eslint:lint` executor (each project's `lint` target)
`chdir`s to the workspace root and passes the project's config as
`overrideConfigFile` (basePath = the workspace root), while directory lookup
(an IDE, `eslint` run inside a project) loads the same config with the
project dir as basePath — so a repo-root path pattern
(`libs/infrastructure/**`) matches under the executor and never under lookup,
and a project-relative one the reverse. So an exempt project turns the relevant
half off in its OWN `eslint.config.mjs`, restating the rest (a later block's
options replace, never merge), and the root exports
`LAYER_IMPORT_RESTRICTIONS` and `TESTING_ENTRY_POINT_RESTRICTION` for exactly
that.

| Cage                                                           | Allowed only in                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `firebase`, `firebase/*`, `firebase-admin`, `firebase-admin/*` | `libs/infrastructure/**` — the projects that need it restate the rule without the firebase half (`firebase-app`, `firebase-auth`, `firestore`, `storage`; `clock`, `i18n` and `web-storage` take the root rule whole) — `apps/functions/**`, and the Playwright e2e tooling under `**/e2e/**/*.ts`        |
| `libphonenumber-js`, `libphonenumber-js/*`                     | `libs/ecs-core/src/systems/phone.system.ts` (ecs-core's config exempts that one file); everything else goes through `PhoneSystem` and the `PhoneNumber` component                                                                                                                                         |
| `luxon`, `dinero.js`                                           | nowhere — retired (D5, D4). Neither is a dependency since Phase 4b; the bans stay as guards (root `LAYER_IMPORT_RESTRICTIONS`, restated by `apps/functions`). Time is native `Intl` inside `zoned-time.system.ts`, money the plain integer `Money` struct                                                 |
| `@creativo/**/testing`, `@core/testing`                        | specs (`*.spec.ts`, `*.type-spec.ts` — the root's spec block restates the layer half without the testing one) and the e2e tooling; never production code (`TESTING_ENTRY_POINT_RESTRICTION`, e.g. `libs/features/marketing/landing/src/testing.ts` behind `@creativo/features/marketing/landing/testing`) |

**The Playwright exemption.** `apps/web/e2e/**` is Node-side test support
that seeds the emulators and mints custom tokens with `firebase-admin`, and
takes its fixtures from the testing entry points; it never ships in a bundle,
so neither half applies. It is not a project of its own and is linted under
both basePaths (the workspace root for the Nx executor and a direct
`eslint apps/web/e2e` from the root; the app dir for `eslint e2e` run inside
apps/web), so its
exemption lives in the root config as the basePath-independent
`files: ['**/e2e/**/*.ts']` block turning the rule off — never as an
`apps/web/e2e/**` pattern in `apps/web/eslint.config.mjs`.

**Node scripts under `tools/`** (`*.mjs`) sit outside both `.ts`-scoped
rules: `@nx/enforce-module-boundaries` and `no-restricted-imports` are
declared for `ts`/`tsx`/`js`/`jsx` files. The seed loader, the verify scripts
and the lint-rule specs therefore name `@core/*` aliases freely (the deep
relative-import half of Law 8 still covers them through the layering
verifier).

## Today's projects (45)

| Project                | Root                                 | Tags                                  |
| ---------------------- | ------------------------------------ | ------------------------------------- |
| `web`                  | `apps/web`                           | `scope:web`, `type:app`               |
| `showcase`             | `apps/showcase`                      | `scope:showcase`, `type:app`          |
| `functions`            | `apps/functions`                     | `scope:backend`, `type:app`           |
| `ecs-core`             | `libs/ecs-core`                      | `scope:shared`, `type:domain`         |
| `admin-loyalty`        | `libs/features/admin/loyalty`        | `scope:app`, `type:feature`           |
| `admin-programs`       | `libs/features/admin/programs`       | `scope:app`, `type:feature`           |
| `client-account`       | `libs/features/client/account`       | `scope:app`, `type:feature`           |
| `client-account-state` | `libs/features/client/account-state` | `scope:app`, `type:feature`           |
| `client-appointments`  | `libs/features/client/appointments`  | `scope:app`, `type:feature`           |
| `client-auth`          | `libs/features/client/auth`          | `scope:app`, `type:feature`           |
| `client-booking`       | `libs/features/client/booking`       | `scope:app`, `type:feature`           |
| `client-notifications` | `libs/features/client/notifications` | `scope:app`, `type:feature`           |
| `client-onboarding`    | `libs/features/client/onboarding`    | `scope:app`, `type:feature`           |
| `client-profile`       | `libs/features/client/profile`       | `scope:app`, `type:feature`           |
| `marketing-careers`    | `libs/features/marketing/careers`    | `scope:app`, `type:feature`           |
| `marketing-courses`    | `libs/features/marketing/courses`    | `scope:app`, `type:feature`           |
| `marketing-events`     | `libs/features/marketing/events`     | `scope:app`, `type:feature`           |
| `marketing-landing`    | `libs/features/marketing/landing`    | `scope:app`, `type:feature`           |
| `shared-catalog`       | `libs/features/shared/catalog`       | `scope:app`, `type:feature`           |
| `shared-shell`         | `libs/features/shared/shell`         | `scope:app`, `type:feature`           |
| `shared-visits`        | `libs/features/shared/visits`        | `scope:app`, `type:feature`           |
| `staff-client-card`    | `libs/features/staff/client-card`    | `scope:app`, `type:feature`           |
| `staff-dashboard`      | `libs/features/staff/dashboard`      | `scope:app`, `type:feature`           |
| `clock`                | `libs/infrastructure/clock`          | `scope:shared`, `type:infrastructure` |
| `firebase-app`         | `libs/infrastructure/firebase-app`   | `scope:shared`, `type:infrastructure` |
| `firebase-auth`        | `libs/infrastructure/firebase-auth`  | `scope:shared`, `type:infrastructure` |
| `firestore`            | `libs/infrastructure/firestore`      | `scope:shared`, `type:infrastructure` |
| `i18n`                 | `libs/infrastructure/i18n`           | `scope:shared`, `type:infrastructure` |
| `storage`              | `libs/infrastructure/storage`        | `scope:shared`, `type:infrastructure` |
| `web-storage`          | `libs/infrastructure/web-storage`    | `scope:shared`, `type:infrastructure` |
| `controls`             | `libs/ui/controls`                   | `scope:shared`, `type:ui`             |
| `icons`                | `libs/ui/icons`                      | `scope:shared`, `type:ui`             |
| `layout`               | `libs/ui/layout`                     | `scope:shared`, `type:ui`             |
| `modifiers`            | `libs/ui/modifiers`                  | `scope:shared`, `type:ui`             |
| `patterns`             | `libs/ui/patterns`                   | `scope:shared`, `type:ui`             |
| `ui-wall-clock`        | `libs/ui/wall-clock`                 | `scope:shared`, `type:ui`             |
| `ui-theme`             | `libs/ui/theme`                      | `scope:shared`, `type:ui`             |
| `tokens`               | `libs/ui/tokens`                     | `scope:shared`, `type:tokens`         |
| `view-state`           | `libs/shared/view-state`             | `scope:shared`, `type:util`           |
| `flag-tools`           | `tools/flags`                        | `scope:tooling`, `type:util`          |
| `icon-tools`           | `tools/icons`                        | `scope:tooling`, `type:util`          |
| `lint-rules`           | `tools/lint-rules`                   | `scope:tooling`, `type:util`          |
| `script-tools`         | `tools`                              | `scope:tooling`, `type:util`          |
| `seed-tools`           | `tools/seed`                         | `scope:tooling`, `type:tooling`       |
| `verify-tools`         | `tools/verify`                       | `scope:tooling`, `type:tooling`       |

Read off every `project.json` (`git ls-files '**/project.json'`); check it at
any time with `pnpm nx show projects` (45) and `pnpm nx graph`.

Two of them exist for the UI residue cleanup
(`docs/architecture/flips/ui-residue-cleanup.md` UR-2, UR-9) and carry a
dependency budget stricter than their tag's row:

| Project         | May import                                   | Imported by                                    |
| --------------- | -------------------------------------------- | ---------------------------------------------- |
| `view-state`    | nothing — zero dependencies (`type:util`)    | every `type:feature`, `type:ui` and `type:app` |
| `ui-wall-clock` | `@core/primitives` only (`type:ui` → domain) | every `type:feature`, `type:ui` and `type:app` |

`view-state` (`@creativo/shared/view-state`) is the one read-state
vocabulary — `LoadState`, `LoadSlice`, `PagingState`, `loadStateWords` — so
a `type:ui` lib and a feature can share it without a feature → feature or
ui → infrastructure edge; being `type:util` it cannot reach `@core/*`, which
is why it is not the home of anything domain-shaped. `ui-wall-clock`
(`@creativo/ui/wall-clock`) is the template layer's ONE set of cached `Intl`
date and money formatters, moved out of `shared-visits` so the design
system, the showcase, the shell and every feature format through the same
cache instead of growing their own; `type:ui` because a `type:util` lib may
not import `@core/primitives`, and because `@creativo/infrastructure/i18n`
(which `.claude/rules/angular-ui.md` names for formatting) is unreachable
from `type:ui`.

## Worked example

`apps/web` depends on every feature lib (`scope:app`) plus any `scope:shared`
lib it needs directly (`libs/infrastructure/firebase-app` and
`libs/infrastructure/i18n` for its composition root, `@core/*` for the
pipelines its providers bind) — all legal because `apps/web` is tagged
`scope:web`. `libs/features/shared/shell` importing
`libs/features/client/account-state` is likewise legal (`scope:app` →
`scope:app`): the app-wide header and menu read the same session model the
account screens do.

The edges still rejected are the ones that matter: any `scope:shared` project
— `libs/ecs-core`, `libs/ui/patterns`, `libs/infrastructure/firestore` —
importing a feature, the SPA or the functions; `libs/ui/*` importing an
adapter; `libs/ecs-core` importing anything at all. The ECS core and the
design system never learn what screens exist; features depend on them, never
the reverse.

## Amendments (history)

**2026-07-28 — `scope:app` replaced `scope:marketing|client|staff|admin`.**
Owner ruling: this is one app, and the four product surfaces were legacy
structure inherited from the pre-migration multi-app layout. In practice the
split never prevented a bad edge; it only blocked legitimate ones — the shared
shell's account chrome could not read the client session model, which would
have forced either a duplicate profile fetch or a lib move to work around a
boundary that was not protecting anything. Cross-surface isolation is not the
constraint that matters in a single deployed SPA. The constraint that does —
**layering** — was untouched: `type:*` still keeps the core and the design
system from ever seeing a feature.

**2026-09-24 — `libs/ui/icons` and `scope:tooling`.** The icon registry moved
out of `libs/ui/controls` into its own `type:ui` project, `libs/ui/icons`,
because `ui/patterns` (the rating star) must compose `ui-icon` and
`ui/controls` re-exports `ui/patterns` — the registry has to sit below both.
It is also the ALLOW-LIST of the workspace icon guards (`no-restricted-syntax`
icon selectors and `creativo/icon-registry-only`, both declared in the root
`eslint.config.mjs` and turned off only in `libs/ui/icons/eslint.config.mjs`).
`tools/lint-rules` (the local ESLint plugin) and `tools/icons` (the glyph
generator and usage checker) became Nx projects tagged `scope:tooling`,
`type:util` so their tests run under `nx affected -t test`.

**2026-10-23 — Phase 4b.** `libs/application/*` (`type:application`: ports
keyed by `InjectionToken`, `@Injectable` use cases) and `libs/domain/*`
(`type:domain`: the class-based kernel, `models` and the bounded-context
libs) were deleted; their ports live in `@core/ports`, their rules in
`@core/systems` and `@core/pipelines`. The `type:application` row and its
mentions in the `type:app`, `type:feature` and `type:infrastructure` rows went
with the tag; `type:domain` now names `libs/ecs-core` alone. The phase plan is
`docs/architecture/flips/phase-4b-delete.md`; the migration record is
`docs/architecture/HANDOFF.md`.

**2026-10-23 — UI residue cleanup, wave 0.** Two `scope:shared` libraries
joined the graph (44 → 46 projects): `libs/shared/view-state` (`type:util`,
no dependencies — the shared read-state dictionaries) and
`libs/ui/wall-clock` (`type:ui`, `@core/primitives` only — `wall-clock.ts`
moved verbatim out of `libs/features/shared/visits`, which no longer
re-exports it). No `depConstraints` row changed. The plan is
`docs/architecture/flips/ui-residue-cleanup.md`.

**2026-10-24 — the `cr` design system's libraries deleted.** `libs/shared/ui`
(`ui`, `type:ui`: the `cr-*` Button, Input, Card, Badge, ThemeToggle and the
`crText`/`crMaterial`/`crShape` directives), `libs/shared/cursor` (`cursor`,
`type:util`: an Angular cursor-dot component, directive and service, reachable
only from `libs/shared/ui`) and `libs/shared/design-tokens` (`design-tokens`,
`type:tokens`: the retired `--cr-*` token CSS and its TS motion mirror) had no
importer left outside their own family once the web app and the showcase
moved onto `libs/ui` (46 → 43 projects). The two sheets still live —
`reset.css` and `reduced-motion.css` — moved into `libs/ui/tokens` at the
same `@import` position, so the web's built global stylesheet is
byte-identical; the showcase loses only the two retired layers
(`cr-tokens`, `cr-components`). No `depConstraints` row changed:
`type:util` and `type:tokens` keep their other members.
