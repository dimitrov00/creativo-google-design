# ui-wall-clock

The template layer's clock and money faces — `formatWallClock`,
`formatWallClockParts`, `formatWallClockRange`, `formatMinute`,
`formatInstant`, `formatWeekdayLabels`, `civilMs`, `formatCents` — on native
`Intl`, formatters cached per locale + zone + options, never a `Date`.
Imported as `@creativo/ui/wall-clock` by features, `libs/ui/*` and the apps;
depends on `@core/primitives` only.
