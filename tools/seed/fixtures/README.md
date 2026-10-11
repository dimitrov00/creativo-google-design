# tools/seed/fixtures

The home of the dev seed's document bodies as TypeScript (ECS migration,
`docs/architecture/ecs-migration.md` §6 Phase 3, Risk 1, Risk 8). It is empty
on purpose until the Phase 3b flips fill it: each flip moves the bodies of the
collections it reshapes here, in the same commit that changes their shape.

## The rule for every file here

- One file per collection family, named after it (`appointments.ts`,
  `loyalty.ts`, …). A file exports plain bodies — the entity minus its `id`,
  never a mapper's input (Law 5).
- Every exported body is checked against its entity:

  ```ts
  import type { Service } from '@creativo/ecs-core';

  export const classicCut = {
    // …every field of the entity but `id`
  } satisfies Omit<Service, 'id'>;
  ```

  `satisfies` does not exist in the `.mjs` the seed is written in, which is
  why the bodies live here: `pnpm nx typecheck seed-tools` (inferred from
  `tools/seed/tsconfig.json`, over `tsconfig.fixtures.json`, which references
  `libs/ecs-core`) fails on a stale shape instead of a query returning a
  partial set against the emulator.

- Every field is spelled exactly as the entity names it today (after the
  Law 6 flatten pass: flat root fields, `*UtcMs` instants, `localDate` days).
  Instants are literal epoch-ms numbers and days literal `YYYY-MM-DD`
  strings — no `Date.now()`, no `new Date()`, no date library in a body (the
  fixtures' day is `FIXTURE_TODAY`, 2026-09-28, in
  `@creativo/ecs-core/testing`).
- Ids that a key is built from (`BusyKey.of`, `StreakDefinitionVersionId.forVersion`)
  are built by their companion, never spelled by hand.
- The `.mjs` writers (`tools/seed/*.mjs`, `tools/seed-dev-catalog.mjs`) import
  these bodies through the esbuild path of `load-domain.mjs`, which already
  bundles TypeScript across the `@creativo/*` aliases.

`seed-tools` is tagged `type:tooling`, whose row in the root
`eslint.config.mjs` lets it depend on `type:tooling`, `type:util` and
`type:domain` — so `import type { X } from '@creativo/ecs-core'` (the archetype noun, no `Entity` suffix — flatten-spec N1) is
legal here, and nothing of `type:application`/`type:infrastructure` is.

## Not here

The loyalty catalogue and the gift vouchers the seed reads BY PATH
(`catalog.json`, `vouchers.json`) are test fixtures shared with the specs:
they live in `libs/ecs-core/src/testing/fixtures/loyalty/` and are exported
from `@creativo/ecs-core/testing`.
