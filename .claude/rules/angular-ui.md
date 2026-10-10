---
paths:
  - 'apps/web/**'
  - 'apps/showcase/**'
  - 'libs/features/**'
  - 'libs/ui/**'
  - 'libs/shared/ui/**'
---

# Angular UI — the only place `class` is allowed

The framework requires classes for components, directives, pipes and
injectables. That permission ends at the framework boundary.

## Naming

- `Component` as a suffix belongs to Angular classes in `*.component.ts`
  only. A data type is `TimeInterval`, `BookingStatus`, `ServiceBundle` —
  never `TimeIntervalComponent`.
- Selectors stay `ui-*` for the design system (`libs/ui/*`) and `lib-*` for
  feature components; tokens are `--sys-*`.

## Signals bind to plain ECS data

- Stores (`*.store.ts`) hold `signal<AppointmentEntity[]>`,
  `signal<BookingStatus>` — the same types the pipelines read and write. No
  view-model classes, no `toViewModel()` mappers; a template reads the
  component fields and a `computed()` calls a system for anything derived:

  ```ts
  readonly free = computed(() =>
    AvailabilitySystem.freeWindows(this.working(), this.busy(), this.policy()),
  );
  ```

- Never construct a `Date` or a date-library object for domain math (Law 7);
  the UI reads `LocalDate`, `MinuteOfDay`, `PriceCents` and `UtcEpochMs`
  straight off the entity. Display "today" and the clock in the LOCATION's
  `timeZone`, never the browser's.
- Formatting (money, dates, durations) happens in the template layer via
  existing pipes/helpers (`formatMoney`, native `Intl.DateTimeFormat` /
  `Intl.NumberFormat` formatting in the i18n lib, formatters cached per
  locale+zone, never constructed per row) — systems return numbers.
- A store may be an `@Injectable` class because Angular DI needs an injectable;
  it carries signals and calls systems and read ports. It never contains
  domain math and never mutates an entity in place — replace the signal value
  with a new struct.

## Reading and writing data from the web app

- Reads go through read-port adapters in `libs/infrastructure/*` returning
  the ECS entity types straight from `snap.data()`.
- Writes go through the callable pipelines only; the web app never writes an
  appointment document directly (rules forbid it anyway).
- Firebase SDK imports stay inside `libs/infrastructure/**`; features and UI
  consume ports.

## Design-system taste rules still apply

The accent law (one orange, words are ink), the interaction grammar, the
SwiftUI-parity rulings and the DS-inputs-only rule are unchanged by the ECS
move. See `docs/styling-conventions.md` and `docs/design-research/*`.
