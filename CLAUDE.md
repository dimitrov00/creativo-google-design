# Creativo — repository constitution

This file is law for every Claude Code session and every sub-agent spawned
from one. Path-scoped detail (file templates, checklists) lives in
`.claude/rules/*.md` and loads automatically when a matching file is touched.
`AGENTS.md` is a byte-for-byte mirror of this file for other agent tools —
edit both together.

## 0. Stance

- **Greenfield.** No production users, no backward compatibility, no schema
  deprecation duty. Overhaul schemas, delete legacy classes, move directories
  and rewrite files from scratch when the result is cleaner. The one thing a
  refactor must preserve is the _intent_ of the existing tests.
- **Architecture: pure ECS / Data-Oriented Design (DOD).** Plain data structs,
  pure mathematical systems, sandwich pipelines, zero-mapper Firestore. The
  goal is mechanical sympathy with V8 (monomorphic plain objects, flat arrays,
  no hidden-class churn, no prototype chains) and with Firestore's pricing and
  indexing mechanics.
- **The 3-tier OOP shape that preceded it is legacy to remove, not extend.**
  Rich entities with `private constructor` + `static create()`, class-based
  `Result`/`Success`/`Failure`, the `DomainError` class hierarchy,
  `reconstitute()`/`toDocument()` mappers, `InjectionToken` ports and
  `@Injectable` use-case classes (built 2026-07 → 2026-10 across
  `libs/domain/*`, `libs/application/*`, `libs/infrastructure/*`,
  `apps/functions`) all violate the laws below. Convert what you touch; never
  add to it.

## 1. The five laws

### Law 1 — Components are plain data (`*.data.ts`)

- Never `class` for a component or value object. No prototypes, no `new`, no
  `Object.freeze` in production code, no getters, no methods on data.
- Each component file exports exactly three things under ONE name:
  1. the root type — a discriminated union when there are variants;
  2. a runtime companion object `export const Name = { … } as const` holding
     pure factories, guards and helper math;
  3. a single type-only `export namespace Name { export type Variant = … }`
     where every variant is declared **once**. Never declare a variant at top
     level and re-alias it inside the namespace.
- State tags come from `as const` dictionaries (`BookingState.Confirmed`),
  never bare string literals at use sites. Compare with `===` on the tag.
- A data name never ends in `Component`. That suffix belongs to Angular.
- Failures are values: `Result<T, E>` is a plain
  `{ ok: true; value } | { ok: false; error }` union; errors are plain
  `{ code: 'booking.slot_unavailable'; … }` structs with a stable `code` the
  UI translates. No `Error` subclasses, no `throw` for expected outcomes.

### Law 2 — Entities are component bags with branded ids (`*.entity.ts`)

- `export type AppointmentId = string & { readonly __brand: unique symbol };`
  — one per entity, the property must be `readonly` (verified nominal on
  TS 6.0.3). A companion `AppointmentId.of(raw)` is the only cast site.
- `export type AppointmentEntity = { readonly id: AppointmentId; readonly
timeInterval: TimeInterval; readonly bookingStatus: BookingStatus; … }`.
  No logic, no `assemble()` shallow-copy/freeze boilerplate — rely on
  structural typing. A cross-component validator exists only when an
  invariant genuinely spans two or more components.

### Law 3 — Business logic is pure math (`*.system.ts`)

- Deterministic `state_in → state_out`. No I/O, no queries, no network, no
  `Date.now()`/`new Date()`/`Math.random()`, no mutation of inputs, no
  imports of ports, adapters, Firebase or Angular.
- Prefer linear `for` scans over flat struct arrays for collision and range
  work; sort once, scan once. No per-element allocations in hot loops.
- Lazy evaluation: compute availability windows and derived views on demand
  from intervals; never pre-generate or persist slot grids.
- Every system has a spec that proves purity (same input → same output,
  inputs unchanged) and covers the boundary cases of its math.

### Law 4 — Orchestration is the Impure-Pure-Impure sandwich (`*.pipeline.ts`)

1. **Impure read** — fetch raw documents through a read port.
2. **Pure compute** — hand plain component slices to systems; get a decision
   and a write plan back.
3. **Impure write** — commit the plan atomically through a write port; enqueue
   background tasks through a task port.

- When atomicity needs a Firestore transaction, the transaction _is_ the
  sandwich: the port takes the pure decision function as a parameter and runs
  reads → decide → writes inside one `runTransaction`.
- Ports are plain function types (`*.port.ts`). Dependencies arrive as closure
  parameters: `export const bookAppointment = (ports: BookingPorts) =>
async (cmd) => …`. No IoC container, no abstract classes, no `InjectionToken`
  outside Angular UI wiring.
- Adapters (`*.adapter.ts`) implement ports over an SDK and contain no
  business logic. Pino and Sentry adapters sit only in the backend composition
  root (`apps/functions/src/main.ts` today; `apps/api` if the Hono/Cloud Run
  move is confirmed — see §4).

### Law 5 — Firestore mirrors the archetypes (zero-mapper layout)

- A document body **is** the entity's component bag minus `id`:
  `/appointments/{id}` → `{ timeInterval: {…}, bookingStatus: {…},
serviceBundle: {…} }`. The parsed JSON is the component bag; there is no
  `fromFirestore`/`toFirestore`/`reconstitute` layer. A read port returns
  `AppointmentEntity | null`; a write port takes the same type.
- Store what systems compute on: epoch-millisecond integers, minutes-of-day
  integers, `as const` tags. Formatting happens in the UI.
- **No unbounded dynamic map keys** inside a document (`Record<BarberId, …>`,
  `Record<DayKey, …>`). Bounded maps only when the key set is finite and
  known at design time. Sequences are arrays of plain structs
  (`blocks: Array<{ startMinutes; endMinutes; kind }>`).
- Blob arrays that are never queried get a `fieldOverrides` entry in
  `firestore.indexes.json` switching single-field indexes off.
- Unbounded entities (appointments, clients, photos, journal) live in their
  own top-level collections — never embedded in a shop or barber document.
- Appointments stay callable-only in `firestore.rules` (no direct client
  writes), and every composite query has its index declared before deploy.

## 2. File kinds at a glance

| Kind      | Suffix                                                     | Contains                                                | Never contains                                       |
| --------- | ---------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------- |
| Component | `*.data.ts`                                                | root type + `as const` companion + type-only namespace  | `class`, `new`, I/O, imports of systems or pipelines |
| Entity    | `*.entity.ts`                                              | branded id + id companion + component-bag type          | logic, `assemble()`, `Object.freeze`                 |
| System    | `*.system.ts`                                              | pure functions over components and entities             | I/O, clock, randomness, mutation, SDK imports        |
| Port      | `*.port.ts`                                                | plain function types                                    | implementations                                      |
| Pipeline  | `*.pipeline.ts`                                            | a factory taking ports, returning the use-case function | business math (call a system), SDK imports           |
| Adapter   | `*.adapter.ts`                                             | port implementations over one SDK                       | business logic                                       |
| Angular   | `*.component.ts` `*.directive.ts` `*.pipe.ts` `*.store.ts` | framework classes, signals, templates                   | domain math (call a system), view-model mappers      |

`class` is legal **only** in the Angular row. Tests mirror their subject:
`x.system.spec.ts`, `x.pipeline.spec.ts`.

## 3. Workspace map

- **Apps:** `apps/web` (Angular 22 SPA, Firebase Hosting), `apps/functions`
  (Firebase Cloud Functions gen 2, Node 22 — the backend composition root
  today), `apps/showcase` (design-system workbench). No `apps/api` exists yet.
- **ECS core:** `libs/ecs-core` (`@creativo/ecs-core`, tags `scope:shared`,
  `type:domain`) with `entities/`, `components/`, `systems/`, `ports/` and a
  barrel `index.ts`. It replaces `libs/domain/*` (the kernel folds in) and the port halves of `libs/application/*`. Server pipelines live in `apps/functions/src/pipelines/`, beside their composition root, never in ecs-core.
- **Design system:** `libs/ui/*` (`ui-*` elements, `--sys-*` tokens), with
  taste rules in `docs/styling-conventions.md` and the design-research docs.
  Unchanged by the ECS move; Angular classes are expected there.
- **Boundaries** are enforced by `@nx/enforce-module-boundaries` in
  `eslint.config.mjs` (`scope:*` + `type:*` tags, documented in
  `docs/architecture/module-boundaries.md`). The layering arrows stay: ui
  never sees application/infrastructure; only `libs/infrastructure/**` and
  `apps/functions/**` may import `firebase/*`; `libphonenumber-js` only inside `libs/ecs-core/src/systems/phone.system.ts` (and the kernel until Phase 4 deletes it). **No Luxon and no dinero.js** — time is native `Intl` inside `zoned-time.system.ts`, money is the plain `{ amountMinorUnits, currencyCode }` struct; both packages leave `package.json` when the kernel is deleted.

## 4. Decisions and the migration record

The ECS migration runs bottom-up in four phases (foundation, systems,
pipelines and adapters, client integration and legacy deletion). On
2026-10-10 the owner adopted every recommendation of
`docs/architecture/ecs-migration.md` §9 (D1–D28), with two amendments: time
is native `Intl`, no Luxon (D5); money is a plain integer struct, no
dinero.js (D4). The conditional ones resolved as D12(b) (contact change is not
shipped; its adapter goes), D16(b) (the public exception effect is the only
record) and D27(b) (server pipelines in `apps/functions/src/pipelines/`).
Phase status and baselines live in the auto-memory note
`project-ecs-migration-status`. Implement the phase plan of the blueprint's
§6; do not reopen a decided question in code.

## 5. Verification (run through Nx, never the raw tool)

```bash
pnpm nx run-many -t typecheck
pnpm nx run-many -t test
pnpm nx run-many -t lint
pnpm nx build web
pnpm nx build functions
```

`typecheck` is plain `tsc` and does not see Angular templates — a template
error only surfaces in `pnpm nx build web` or the dev server's logs. The
emulator does not enforce composite indexes; declare them in
`firestore.indexes.json` as part of the change that adds the query.

## 6. Working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill
  first — it has patterns for querying projects, targets and dependencies.
- Always run tasks through `nx` (`nx run`, `nx run-many`, `nx affected`),
  prefixed with the workspace package manager: `pnpm nx …`.
- The Nx MCP server is available; use it. For plugin best practices check
  `node_modules/@nx/<plugin>/PLUGIN.md` when it exists.
- NEVER guess CLI flags — check `nx_docs` or `--help` first.
- Scaffolding (new app, lib, project structure): invoke the `nx-generate`
  skill FIRST, before exploring or calling MCP tools.
- Use `nx_docs` for advanced config, unfamiliar flags, migrations and plugin
  configuration — not for basic generator syntax or standard commands.
