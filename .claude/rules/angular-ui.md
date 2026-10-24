---
paths:
  - 'apps/web/**'
  - 'apps/showcase/**'
  - 'libs/features/**'
  - 'libs/ui/**'
---

# Angular UI — the only place `class` is allowed

The framework requires classes for components, directives, pipes and
injectables. That permission ends at the framework boundary.

## Naming

- `Component` as a suffix belongs to Angular classes in `*.component.ts`
  only. A data type is `MinuteRange`, `BookingStatus`, `ServiceBundle` —
  never `MinuteRangeComponent`.
- Selectors stay `ui-*` for the design system (`libs/ui/*`) and `lib-*` for
  feature components; tokens are `--sys-*`.

## Signals bind to plain ECS data

- Stores (`*.store.ts`) hold `signal<Appointment[]>`,
  `signal<BookingStatus>` — the same types the pipelines read and write. No
  view-model classes and no mapper outside a presenter: a `computed()` calls
  a system for anything derived, and — when a screen prints finished words —
  a presenter (`*.presenter.ts`, Law 10, `presenters.md`) inside a
  `computed()` turns those values into the display struct the template
  prints:

  ```ts
  readonly free = computed(() =>
    AvailabilitySystem.freeWindows(this.working(), this.busy(), this.policy()),
  );
  readonly pass = computed(() => passVm({ account: this.account(), words: this.words() }));
  ```

- Never construct a `Date` or a date-library object for domain math (Law 7);
  the UI reads `LocalDate`, `MinuteOfDay`, `PriceCents` and `UtcEpochMs`
  straight off the entity. Display "today" and the clock in the LOCATION's
  `timeZone`, never the browser's.
- Formatting (money, dates, durations) happens in the template layer — a
  template's pipes, or a presenter (Law 10) — via existing helpers: the
  wall clock, instants and money in `@creativo/ui/wall-clock`
  (`formatWallClock`, `formatMinute`, `formatInstant`, `formatCents` — native
  `Intl.DateTimeFormat` / `Intl.NumberFormat`), relative times and plural
  forms in the i18n lib (`relativeTime`, `pluralForm`); formatters cached per
  locale+zone, never constructed per row — systems return numbers, presenters
  return words.
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
