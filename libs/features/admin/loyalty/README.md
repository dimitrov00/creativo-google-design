# admin-loyalty

The admin's loyalty rules. The first page is «Ритъм» (`/admin/loyalty/rhythm`):
the rule that decides when a visit keeps a client's rhythm, managed by the
admin pair (`admin`, `sysadmin`) and never hard-coded. Design record:
`docs/design-research/client-card-revision-3.md` §2.6 (the page), §3.17 (the
component, the sheets, the guard, the store), §4.1–§4.4 (the rule's domain, the
callable, the use cases).

Import path `@creativo/features/admin/loyalty`; tags `scope:app`,
`type:feature`; selector prefix `lib`.

## What it exports

| Export                             | What it is                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `AdminRhythm` (`lib-admin-rhythm`) | The routed page. It provides `AdminRhythmStore`; `confirmLeave()` answers the route's guard |
| `adminRhythmCanDeactivate`         | `CanDeactivateFn<AdminRhythm>`: leaving with a draft asks first                             |

The store, the preview and the sheets (`lib-admin-rhythm-sheet`) are private to
the lib.

## What it may import

`@creativo/ui/*` (controls, patterns, layout, modifiers, icons),
`@creativo/features/shared/visits` (the rule's words),
`@creativo/application/engagement`, `@creativo/application/booking`,
`@creativo/application/shared`, `@creativo/infrastructure/i18n`. Each is a
project reference in `tsconfig.lib.json` and `tsconfig.spec.json`; a new edge
needs its reference there.

A feature never imports a domain lib: what the page needs of the rule's domain
it takes from the application barrel, re-exported by name.

The page is built only from DS controls: no native inputs, no chips as pickers,
no hard-coded strings.

## Running unit tests

Run `nx test admin-loyalty` to execute the unit tests.
