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

## 1. The seven laws

Laws 6 (flat archetypes, domain-prefixed discriminators) and 7 (branded
primitives, shop-anchored time, error structs) were added by the owner on
2026-10-10 and override any earlier wording below. They are applied to the
whole codebase by one **flatten pass** that runs after Phase 3a lands and
before the 3b document flips. Until that pass, existing ecs-core shapes
(nested component maps, `kind` tags, `*Ms` instants, per-entity `zone`
fields, `ZonedInstant`, raw-number coordinates, `{ code }` errors) stay as
they are — never convert a file piecemeal; new files follow Laws 6 and 7 from
the start. Every name, shape and staging step of that pass is fixed in
`docs/architecture/flatten-spec.md`.

### Law 1 — Components are plain data (`*.data.ts`)

- Never `class` for a component or value object. No prototypes, no `new`, no
  `Object.freeze` in production code, no getters, no methods on data.
- Each component file exports exactly three things under ONE name:
  1. the root type — a **flat slice**: a discriminated union of flat variants
     when there are variants (Law 6);
  2. a runtime companion object `export const Name = { … } as const` holding
     pure factories, guards and helper math;
  3. a single type-only `export namespace Name { export type Variant = … }`
     where every variant is declared **once**. Never declare a variant at top
     level and re-alias it inside the namespace.
- Discriminator values are SCREAMING_SNAKE literals declared once in an
  `as const` dictionary named after the field (`BookingStatus.Confirmed`
  → `'CONFIRMED'` for the field `bookingStatus`), never bare literals at use
  sites. Compare with `===` on the discriminator field.
- A data name never ends in `Component`. That suffix belongs to Angular.
- Failures are values (Law 7): `Result<T, E>` is a plain
  `{ ok: true; value } | { ok: false; error }` union; errors are flat
  `{ errorCode: 'BOOKING_SLOT_UNAVAILABLE'; … }` structs whose `errorCode`
  the UI translates (`errors.<errorCode>`). No `Error` subclasses; `throw`
  only for programmer defects. (`Result.ok` is a wrapper flag, never
  intersected into an archetype — the one sanctioned non-prefixed
  discriminator.)

### Law 2 — Entities are flat intersections with branded ids (`*.entity.ts`)

- Ids are branded primitives (Law 7):
  `export type AppointmentId = Brand<string, 'AppointmentId'>;` with the one
  `Brand` helper of `primitives/brand.ts`. Its companion's smart constructor
  `AppointmentId.parse(raw): Result<AppointmentId, PrimitiveError>` is the
  only way a raw string becomes an id.
- An entity is the **intersection** of its flat slices (Law 6):
  `export type Appointment = AppointmentMeta & TimeCoordinate &
BookingLifecycle & PaymentRecord;` where `AppointmentMeta` holds the id
  and the plain identity fields. Every 1-to-1 field sits at the root.
- No logic, no `assemble()` shallow-copy/freeze boilerplate — rely on
  structural typing. A cross-component validator exists only when an
  invariant genuinely spans two or more slices.

### Law 3 — Business logic is pure math (`*.system.ts`)

- Deterministic `state_in → state_out`. No I/O, no queries, no network, no
  `Date.now()`/`new Date()`/`Math.random()`, no mutation of inputs, no
  imports of ports, adapters, Firebase or Angular.
- **Zero inbound mapping.** A system accepts the slice it needs
  (`readonly TimeCoordinate[]`) or the whole entity, by structural typing.
  Never `.map()` to strip or rename properties before calling a system.
- Narrow with TypeScript's control flow on the domain discriminator
  (`if (apt.bookingStatus === BookingStatus.Cancelled) apt.cancellationReason`).
- Prefer linear `for` scans over flat struct arrays for collision and range
  work; sort once, scan once. No per-element allocations in hot loops.
- Lazy evaluation: compute availability windows and derived views on demand
  from intervals; never pre-generate or persist slot grids.
- Every system has a spec that proves purity (same input → same output,
  inputs unchanged) and covers the boundary cases of its math.

### Law 4 — Orchestration is the Impure-Pure-Impure sandwich (`*.pipeline.ts`)

1. **Impure read** — fetch raw documents through a read port.
2. **Pure compute** — hand plain entities or slices to systems; get a decision
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
  business logic. Telemetry adapters (console today; Pino and Sentry when
  installed) sit only in the backend composition root
  (`apps/functions/src/main.ts`).

### Law 5 — Firestore mirrors the archetypes (zero-mapper layout)

- A document body **is** the flat entity minus `id`: `/appointments/{id}` →
  `{ tenantId, locationId, barberIds, localDate, startMinutes, endMinutes,
utcEpochMs, bookingStatus: 'CONFIRMED', confirmedAtUtcMs, paymentMethod:
'CASH', priceCents, currency, seats: [ … ] }` — every value a branded
  primitive (Law 7), and no time-zone field: the zone belongs to the location. Firestore documents, wire JSON and
  TypeScript structs share the identical flat layout. There is no
  `fromFirestore`/`toFirestore`/`reconstitute` layer. A read port returns the
  entity or `null`; a write port takes the same type.
- Writes target **root fields directly**, never dot paths
  (`update(ref, { bookingStatus: 'CANCELLED', cancellationReason: 'ILLNESS',
cancelledAtUtcMs })`). Security rules and composite indexes query top-level
  keys (`bookingStatus`, `startMinutes`, `utcEpochMs`).
- Store what systems compute on, as branded primitives (Law 7):
  `UtcEpochMs` instants (`*UtcMs`), `LocalDate` shop days, `MinuteOfDay`
  times of day (`*Minutes`), `DurationMinutes`, `PriceCents` with a
  `currency`, SCREAMING_SNAKE tags. Formatting happens in the UI.
- **No unbounded dynamic map keys** inside a document (`Record<BarberId, …>`,
  `Record<DayKey, …>`). Sub-objects and arrays exist only for true 1-to-N
  relationships (`seats: Array<{ … }>`, `serviceIds: readonly string[]`) or a
  third-party audit blob.
- Blob arrays that are never queried get a `fieldOverrides` entry in
  `firestore.indexes.json` switching single-field indexes off.
- Unbounded entities (appointments, clients, photos, journal) live in their
  own top-level collections — never embedded in a shop or barber document.
- Appointments stay callable-only in `firestore.rules` (no direct client
  writes), and every composite query has its index declared before deploy.

### Law 6 — Flat archetypes and domain-prefixed discriminators

1. **Flat struct policy.** Every 1-to-1 component and attribute lives at the
   root of the entity and its document. Never nest a 1-to-1 component under
   a wrapper (`appointment.timing.startMinutes`,
   `appointment.pricing.amountCents` are forbidden). Sub-objects and arrays
   are allowed only for true 1-to-N relationships or third-party audit blobs.
   Zero mapping: document, wire JSON and struct are the same flat layout.
2. **Domain-prefixed discriminators.** Never `type`, `kind` or `status` as a
   discriminator. Every state machine names its field after its domain:
   `bookingStatus` (`'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | …`),
   `paymentMethod` (`'UNPAID' | 'CASH' | 'CARD'`), `attendanceState`
   (`'PENDING' | 'SEATED' | 'NO_SHOW'`). Variant-only fields carry their own
   domain prefix (`cancelledAtUtcMs`, `cancellationReason`) so intersecting
   slices can never collide into `never`.
3. **Composition.** Define each component as a union of flat variant slices
   and compose entities by intersection (`&`). Each slice owns a disjoint set
   of field names; a type-spec per entity proves the intersection is not
   `never` and that every variant narrows.
4. **Execution.** Systems take slices or entities as they are (Law 3, zero
   inbound mapping) and narrow on the discriminator; Firestore writes and
   queries touch root keys only (Law 5).

### Law 7 — Data-oriented primitives, time governance and error structs

1. **No date classes, anywhere.** `ZonedDateTime`, Luxon `DateTime`, Moment,
   date-fns/dayjs wrappers and any custom date class are banned; ecs-core
   never constructs a `Date`. They allocate on the heap, chase pointers and
   couple pure logic to a time-zone database. (The legacy kernel's
   `ZonedDateTime` survives only until Phase 4 deletes it — never add a use.)
2. **The physical chair invariant.** A haircut happens on the shop's wall
   clock, wherever the client was when they booked. The IANA time zone is
   configuration of the **shop location only** —
   `ShopLocation = { id: LocationId; name; timeZone: TimeZone }` — and never
   a field of an appointment, exception, busy day, waitlist request or any
   other temporal entity.
3. **Asymmetric time duality (integers only).** Every temporal entity carries
   - the **shop wall clock**: `localDate: LocalDate` (`YYYY-MM-DD`) plus
     `MinuteOfDay` integers in `[0, 1440)` (`startMinutes`, `endMinutes`).
     ALL collision math, schedule packing, availability sweeps and calendar
     grids run on these local coordinates only — which makes them immune to
     DST shifts; and
   - the **absolute point**: `utcEpochMs: UtcEpochMs`, computed **once at the
     ingestion boundary** (the pipeline or callable edge) from the shop's
     `timeZone` with native `Intl` via `ZonedTimeSystem`, and used only for
     Firestore range indexes, reminder crons
     (`where('utcEpochMs', '>=', now)`) and `.ics` generation.
     **DST at ingestion (locked 2026-10-10):** a wall-clock time inside the
     spring-forward gap returns the error `DST_GAP_INVALID_TIME`; an ambiguous
     time in the fall-back repeat resolves deterministically to the **earlier
     offset**. **"Now" (locked):** systems stay time-zone-blind and receive the
     shop-local `ShopNow = { localDate: LocalDate; currentMinute: MinuteOfDay;
utcEpochMs: UtcEpochMs }` the boundary derived once — `localDate` +
     `currentMinute` for every comparison and calculation, `utcEpochMs` passed
     alongside ONLY to stamp lifecycle instants (`confirmedAtUtcMs`,
     `cancelledAtUtcMs`, …), never for math.
4. **Universal branded primitives.** Never a raw `number` or `string` for a
   coordinate, an amount of money or an id. One helper,
   `libs/ecs-core/src/primitives/brand.ts`:
   `declare const BrandSymbol: unique symbol; export type Brand<T, B extends
string> = T & { readonly [BrandSymbol]: B };` — nominal per tag, zero
   runtime cost (verified on TS 6.0.3). The core set, each with JSDoc:
   `LocalDate`, `MinuteOfDay`, `DurationMinutes` (positive integer),
   `UtcEpochMs`, `PriceCents` (minor units — cents, stotinki), `TimeZone`
   (IANA), and every id (`TenantId`, `LocationId`, `BarberId`, `CustomerId`,
   `UserId`, `ServiceId`, `AppointmentId`, …). `ShopLocation.id` is a
   `LocationId`. **`CustomerId` (the client record) and `UserId` (the auth
   account) are strictly distinct** — never assignable to each other; a
   client record may reference an account, and the link is an explicit field,
   never a shared value used as both. Each primitive's companion owns a **smart
   constructor returning `Result`** (`LocalDate.parse(raw)`,
   `MinuteOfDay.of(raw)`) — the only way foreign input becomes a brand — and
   invariant-preserving math that returns brands; the cast lives only in the
   primitive's own file.
5. **Flat Result, no error classes.** Expected failures — validation
   rejections, slot collisions, out-of-range input — return
   `Result<T, E>` (`{ ok: true; value } | { ok: false; error }`). Errors are
   flat, zero-prototype, serialisable structs discriminated by **`errorCode`**
   (SCREAMING_SNAKE, domain-prefixed, from an `as const` dictionary:
   `BookingErrorCode.SlotUnavailable` → `'BOOKING_SLOT_UNAVAILABLE'`) with
   flat context fields beside it; the UI looks them up as
   `errors.<errorCode>` (locked 2026-10-10). No `Error` subclasses, no stack traces on
   expected paths. `throw` is reserved for unrecoverable programmer defects
   (an exhausted `switch`, a broken structural invariant) and never crosses a
   system boundary as control flow.

## 2. File kinds at a glance

| Kind      | Suffix                                                     | Contains                                                                  | Never contains                                       |
| --------- | ---------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------- |
| Primitive | `*.primitive.ts`                                           | `Brand<T, B>` alias + JSDoc + companion with a `Result` smart constructor | `class`, unchecked casts outside its own file        |
| Component | `*.data.ts`                                                | root type + `as const` companion + type-only namespace                    | `class`, `new`, I/O, imports of systems or pipelines |
| Entity    | `*.entity.ts`                                              | branded id + id companion + flat slice intersection                       | logic, `assemble()`, `Object.freeze`                 |
| System    | `*.system.ts`                                              | pure functions over components and entities                               | I/O, clock, randomness, mutation, SDK imports        |
| Port      | `*.port.ts`                                                | plain function types                                                      | implementations                                      |
| Pipeline  | `*.pipeline.ts`                                            | a factory taking ports, returning the use-case function                   | business math (call a system), SDK imports           |
| Adapter   | `*.adapter.ts`                                             | port implementations over one SDK                                         | business logic                                       |
| Angular   | `*.component.ts` `*.directive.ts` `*.pipe.ts` `*.store.ts` | framework classes, signals, templates                                     | domain math (call a system), view-model mappers      |

`class` is legal **only** in the Angular row. Tests mirror their subject:
`x.system.spec.ts`, `x.pipeline.spec.ts`.

## 3. Workspace map

- **Apps:** `apps/web` (Angular 22 SPA, Firebase Hosting), `apps/functions`
  (Firebase Cloud Functions gen 2, Node 22 — the backend composition root
  today), `apps/showcase` (design-system workbench). No `apps/api` exists yet.
- **ECS core:** `libs/ecs-core` (`@creativo/ecs-core`, tags `scope:shared`,
  `type:domain`) with `primitives/` (the `Brand` helper and every branded
  primitive, Law 7), `entities/`, `components/`, `systems/`, `ports/` and a
  barrel `index.ts`. It replaces `libs/domain/*` (the kernel folds in) and the port halves of `libs/application/*`. Server pipelines live in `apps/functions/src/pipelines/`, beside their composition root, never in ecs-core.
- **Design system:** `libs/ui/*` (`ui-*` elements, `--sys-*` tokens), with
  taste rules in `docs/styling-conventions.md` and the design-research docs.
  Unchanged by the ECS move; Angular classes are expected there.
- **Boundaries** are enforced by `@nx/enforce-module-boundaries` in
  `eslint.config.mjs` (`scope:*` + `type:*` tags, documented in
  `docs/architecture/module-boundaries.md`). The layering arrows stay: ui
  never sees application/infrastructure; only `libs/infrastructure/**` and
  `apps/functions/**` may import `firebase/*`; `libphonenumber-js` only inside `libs/ecs-core/src/systems/phone.system.ts` (and the kernel until Phase 4 deletes it). **No Luxon and no dinero.js** — time is native `Intl` inside `zoned-time.system.ts`, money is integer `…Cents: PriceCents` beside a `currency: Currency`, with the plain `Money { amountCents: PriceCents; currency: Currency }` struct for arithmetic; both packages leave `package.json` when the kernel is deleted.

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
