---
paths:
  - 'libs/**/*.ts'
  - 'apps/**/*.ts'
  - 'tools/**/*.ts'
  - 'tools/**/*.mjs'
  - 'tsconfig.base.json'
---

# Layered subpath exports — Law 8 of `CLAUDE.md`

`libs/ecs-core` is exported ONLY through its tier barrels. There is no root
`src/index.ts` and no `@creativo/ecs-core` alias.

| Import from        | Barrel                                  | May import (inside the library)                          |
| ------------------ | --------------------------------------- | -------------------------------------------------------- |
| `@core/primitives` | `libs/ecs-core/src/primitives/index.ts` | nothing                                                  |
| `@core/components` | `libs/ecs-core/src/components/index.ts` | primitives                                               |
| `@core/entities`   | `libs/ecs-core/src/entities/index.ts`   | components, primitives                                   |
| `@core/ports`      | `libs/ecs-core/src/ports/index.ts`      | entities, components, primitives                         |
| `@core/systems`    | `libs/ecs-core/src/systems/index.ts`    | entities, components, primitives — never ports/pipelines |
| `@core/pipelines`  | `libs/ecs-core/src/pipelines/index.ts`  | systems, ports, entities, components, primitives         |
| `@core/testing`    | `libs/ecs-core/src/testing/index.ts`    | specs and test support only                              |

## How to write an import

```ts
// a system, importing across tiers — always the alias:
import { MinuteOfDay, Result } from '@core/primitives';
import { TimeCoordinate } from '@core/components';
import type { Appointment } from '@core/entities';

// a sibling in the SAME tier — relative, one level, never via its own barrel:
import { IntervalSetSystem } from './interval-set.system';
```

- Never `import … from '@core/<own tier>'` inside that tier (barrel cycle).
- Never `../` inside `libs/ecs-core` — not even mid-path (`./../x`,
  `./a/../b`); never three or more `../` in any import of code anywhere —
  no exception. A nested project's `eslint.config.mjs` imports the root
  config as `#eslint-config` (root `package.json` `imports`); a new
  generator-made config that climbs `../../../` must be switched to it.
  (Plain file paths handed to `resolve()`/`readFileSync` are not imports,
  and neither is a CSS `@import` in an app's global stylesheet —
  `apps/web/src/styles.css`, `apps/showcase/src/styles.css`: its order
  fixes the cascade-layer order and the stylesheet resolver reads no
  tsconfig alias.)
- Result and every error struct and dictionary live in primitives
  (`primitives/*-errors.data.ts`, `result.data.ts`); the collection
  registry is `entities/collections.ts`; the test support is
  `src/testing/` (`@core/testing`).
- Pipelines (server and browser) live in `@core/pipelines`, SDK-free; apps
  import them in their composition roots and wire adapters there.
- The seven aliases are the whole list: no lazy secondary entry
  (`@core/phone` or the like) and no deep `@core/<tier>/…` subpath without
  an owner ruling. One is owed before Phase 4 — whether `libphonenumber-js`
  leaves the initial chunk (`docs/architecture/ecs-migration.md` §6 Phase 4,
  re-point (a)); until then it stays where it is.
- A tier barrel re-exports its files with `export *` / named re-exports only
  — no logic, no side effects (`"sideEffects": false`) — and a file never
  re-exports another tier's name: every exported name, value or type, has
  ONE home tier.

## Specs, test support and type edges (rulings, 2026-10-11)

- **Specs and type-specs are leaves.** Nothing imports a `*.spec.ts` or
  `*.type-spec.ts`; code they share goes into `src/testing`. Being leaves,
  they may import any tier but their own barrel (siblings by `./x`) plus
  `@core/testing` — a primitives spec may build its fixture with
  `ZonedTimeSystem`, a components dictionary type-spec may pair its codes
  with an entity. Keep the spec beside its subject; never move it to the
  tier its imports would otherwise demand.
- **`src/testing` sits above every tier** and may import all of them,
  including other testing entry points. Production code never imports
  `@core/testing` (root `TESTING_ENTRY_POINT_RESTRICTION`).
- **Cycles are runtime cycles.** An `import type` edge is erased at build,
  so two sibling types of one tier may name each other
  (`DurationMinutes` ↔ `MinuteOfDay`, `BookingLifecycle` ↔ `SeatOutcome`);
  a value cycle is a violation, through barrels included.

## Enforcement

- `libs/ecs-core/eslint.config.mjs` — per tier and file kind (own barrel,
  upward tiers and `@core/testing` for production files, a `..` segment
  anywhere): `no-restricted-imports` for static imports and re-exports,
  `creativo/no-restricted-import-expressions`
  (`tools/lint-rules/restricted-import-expressions.mjs`) with the same
  patterns for `import()`, `import('…')` type queries and
  `import x = require()`, which the core rule never reads.
- `tools/lint-rules/ecs-syntax.mjs` — a `*.system.ts` imports nothing from
  the ports or pipelines tiers (`@core/ports`, `@core/pipelines`, `ports/…`).
- `pnpm nx run verify-tools:layering` (`tools/verify/layering/check-layering.mjs`,
  never cached, not part of `run-many`) — entry points and aliases,
  hierarchy (specs as leaves), runtime cycles, barrel contents and single
  name homes, deep relative imports of code in libs/apps/tools (`.css` and
  `.scss` are not scanned).
