---
paths:
  - 'libs/ecs-core/src/ports/**'
  - '**/*.port.ts'
  - '**/*.pipeline.ts'
  - '**/*.adapter.ts'
  - '**/ports.tokens.ts'
  - 'apps/web/src/app/app.config.ts'
  - 'apps/functions/src/main.ts'
  - 'apps/functions/src/adapters/**'
---

# Ports — bottom-up composition (Law 9 of `CLAUDE.md`)

A port bundle is declared first, as a concrete record, and every larger
suite is the intersection of bundles. Nothing is ever carved back out of a
catalogue with `Pick`/`Omit`.

## The shape (`scheduling.port.ts`)

```ts
// 1. Port function types — one per capability.
export type ObserveBusyDay = (
  barberId: BarberId,
  localDate: LocalDate,
) => Observable<Result<BarberBusyDay | null, RepositoryError>>;
export type LoadPolicy = () => Promise<Result<BookingPolicy, RepositoryError>>;

// 2. Focused bundles — concrete records, 1:1 with an InjectionToken or an adapter factory.
/** A shop day's raw streams — the booking sheet's day. */
export type ShopDayStreamPorts = {
  readonly observeBusyDay: ObserveBusyDay;
  readonly observeExceptions: ObserveExceptions;
  readonly observeSchedule: ObserveSchedule;
  readonly observeLocation: ObserveLocation;
};
/** The booking policy — `firestore-settings.adapter.ts`. */
export type PolicyReadPorts = {
  readonly loadPolicy: LoadPolicy;
};

// 3. Token-sized and context-sized suites — intersections only.
export type SchedulingReadPorts = ShopDayStreamPorts &
  PolicyStreamPorts &
  CapacityStreamPorts;
export type SchedulingPorts = SchedulingReadPorts &
  ScheduleExceptionPorts &
  AppointmentReadPorts &
  /* … */ GatewayPorts;
```

## Consumers name bundles, never slices

```ts
// a pipeline's dependencies — an intersection of named bundles
export type RebuildCapacityPorts = CommitPorts &
  ClockPorts &
  BarberListPorts &
  PolicyReadPorts &
  LogPorts;

// a functions adapter — returns its bundle (or their intersection), no local alias
export const firestoreSettingsPorts = (db: Firestore): PolicyReadPorts => ({ … });

// the web — one token per bundle
export const SCHEDULING_READ_PORTS = new InjectionToken<SchedulingReadPorts>(
  'SCHEDULING_READ_PORTS',
);

// a feature helper that reads only the day — the bundle that names it
export function observeDay(ports: ShopDayStreamPorts, …) { … }
```

- `Pick<…Ports, '…'>` / `Omit<…Ports, '…'>` is banned in every file — a
  pipeline, an adapter, a composition root, a feature, a spec double, a
  fixture. A spec double that scripts two members spreads a full in-memory
  double and overrides them; its parameter is `Partial<TheBundle>`.
- **A subset no bundle names is a missing bundle.** Split the bundle in its
  port file (keep the token-sized suite as the `&` of the parts), then
  depend on the part. Never re-alias a bundle under a feature-local name.
- The ports tier holds no `Pick`/`Omit` at all: a port's argument shape is a
  named type — an entity slice (`AppointmentPhotoFacts`, `AccountContact`)
  or a component — so a rename is one compiler-checked change.
- A port function type and its bundle live in `libs/ecs-core/src/ports/`
  only — never declared inside a pipeline or an adapter; a pipeline-local
  `XPorts` type is an intersection of tier bundles and nothing else.
- Configuration a pipeline needs beside its functions (`defaultLocationId`)
  is a bundle too (`DefaultLocationPorts`, `ports/catalog.port.ts`), never a
  loose parameter.

## Enforcement

`creativo/no-sliced-ports` (`tools/lint-rules/no-sliced-ports.mjs`, spec
beside it, run by `nx run lint-rules:test`): the root `eslint.config.mjs`
reports a `Pick`/`Omit` whose sliced type names a `*Ports` type on every
`.ts` file, and every `Pick`/`Omit` in a `*.port.ts` (`{ anyType: true }`);
`libs/ecs-core/eslint.config.mjs` adds `{ anyType: true }` on all of
`src/ports/**` (the barrel and the ports specs).
