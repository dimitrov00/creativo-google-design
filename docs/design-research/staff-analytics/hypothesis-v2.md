# Staff analytics v2 — working hypothesis (2026-11-08)

- **Author:** Dimitar Dimitrov, with Claude
- **Status:** hypothesis for the Goldfish review; not a design
- **Builds on:** `docs/designs/staff-analytics.md` (v1, implemented in PRs #39–#43), the
  ADR `docs/architecture/decisions/2026-11-08-staff-analytics.md`,
  `mobbin-inspiration-v2.md` and `chart-library-survey.md` beside this file

## What the owner asked for (2026-11-08, after seeing v1 running)

1. The screen is rows of figures in one grey; it reads as boring and unclear. He wants
   graphs the way Revolut shows them: creative, varied, understandable at a glance, with
   colour that explains. He named FIFA-style polygons per barber as one idea.
2. Day, week, month and, once the figures are stored, year.
3. The v1.2 and v2 stages of the design's Future Improvements: stored daily figures, year
   view, same period last year, custom ranges, goals, written findings; pay rules and
   earnings, export, sealing closed periods.
4. Analytics must be a tap away from the schedule, where staff spend their day. Page or an
   animated full-screen overlay like search: to be decided.
5. Reports exportable.
6. «Към 11:40» worried him: are the figures built in real time, at Firestore's expense?

## The answer to item 6 first

The figures are not live. Every open paints the report saved on the device, then makes one
callable request; «Към 11:40» is the time the server computed that answer
(`reportComputedAtUtcMs`), not a clock. There are no listeners and no per-write rebuilds.
The cost is the request itself: about 1,000 document reads for a barber-month and 11,500 for
a shop-month, because the server re-reads every visit of the period on every open (v1 design,
"Reads and cost"). At the modelled use that is about 3M reads a month, about $2. Stored daily
figures (below) cut a month open to about 200 reads for a barber and 1,700 for the shop,
and make the year view possible at all. The wording changes too: "Обновено преди 2 мин"
says what the stamp means.

## Hypothesis

Keep v1's model (one callable, the device cache, the visibility table, the agreement specs)
and change four things:

1. **Store each closed barber-day as one small document** so that every period, up to a
   year and a custom range, reads days instead of visits; today stays computed live.
2. **Build a chart kit in the design system** (`libs/ui/charts`, hand-built SVG, no
   dependency) and redraw the screen with it: one chart per question, colour by a validated
   data palette, text in ink.
3. **Open analytics from the schedule's toolbar** with the search overlay's view transition,
   as a route, opening on the schedule's barber and day.
4. **Add goals, written findings, export and a pay rule** in that order, each its own PR.

## Decisions proposed (with the strongest counter-argument)

### D1 — Stored days, not stored months, and only closed days

`analyticsDays/{barberId}__{localDate}`: the minutes of every part of `ChairTimeSystem`'s
partition, takings and tips in cents, the service rows, client counts (rebooked base and
count, no-shows, late cancellations), the booking origins, and 24 hour buckets of worked
minutes (for the weekday × hour heatmap). Written when the day has passed on the shop's
clock, by a scheduled job at 04:00 shop time for every barber (yesterday), rebuilt by the
appointment trigger when a visit of a closed day changes (a late attendance mark, a price
edit), and by the departure/roster triggers for the days they touch. A missing day is
computed and written by the callable on first read (the pipeline's write step). TTL 25
months, so "same period last year" always has its base. Backfill: one job over the last 24
months, trivial at greenfield volumes.

Today and future days are never stored: unsold, open, unmarked and booked-ahead minutes
depend on the clock (ADR D1), so a stored today would be wrong within the hour. The callable
reads day documents for closed days and visits for today, and adds them with the same
systems. The agreement specs (G5) gain a case: a month from day documents equals the same
month computed from visits.

Law 5 fit: a derived value is stored for a busy screen's read fan-out (a year is ~5,000
visits per barber), as a projection a trigger rebuilds and a TTL expires. Counters stay
banned: a day document is recomputed from its visits, never incremented.

**Counter-argument:** v1 rejected this (Alternative C) as not needed for a week or a month,
and it adds a trigger, a job, a backfill and invalidation rules. It is accepted now because
the year view and the custom range cannot be read from visits within the 4 s budget, and
because the owner's cost worry is answered by it rather than by a rule that skips calls.

### D2 — The chart kit is ours, in `libs/ui/charts`

Ten SVG elements drawn from Angular templates, styled by CSS, colours from tokens, dark
mode for free, reduced motion honoured by CSS, `role="img"` with a hidden table for screen
readers, and a pure geometry module (scales, nice ticks, monotone path, polygon, stack
offsets) with its own specs: `ui-bar-chart`, `ui-line-chart`, `ui-sparkline`,
`ui-stacked-bar`, `ui-heatmap`, `ui-calendar-heatmap`, `ui-radar`, `ui-chart-legend`,
`ui-chart-readout`; rings stay `ui-gauge`. Each gets a showcase page and a visual baseline.
The dataviz method applies: form by the data's job, colour by its job, the palette validated
by the script, marks thin, a hover/tap readout on every chart, a legend for ≥ 2 series.

Rubric (survey §4): bundle 25 / CSP 15 / design-system fit 25 / phone performance 20 /
maintenance 15 → hand-built 4.70, d3-shape + d3-array 4.65, Chart.js 3.15, ECharts 2.60.

**Counter-argument:** Chart.js 4 is MIT, CSP-clean, 64 kB gzipped, costs the route ceiling
nothing inside `@defer`, and gives a first chart in a day. It loses because theme, reduced
motion and the `ui-*` contract are CSS here and a canvas drags each back into JavaScript,
because a bitmap is a wall to screen readers, and because it still has no heatmap or
calendar heatmap. d3-shape is adopted only if a spec shows a curve or stack the geometry
module gets wrong.

### D3 — A data palette beside the accent law

The accent law (one orange; colour is a shape, words are ink) stays for chrome and text. A
chart's marks are shapes, so they get colour: six categorical tokens `--sys-chart-1..6`
(light and dark steps, validated for colour-vision deficiency and contrast by the dataviz
validator), the existing `--sys-identity-0..4` for per-barber series (colour follows the
entity, the same tone as the barber's chair in the schedule), the accent for "selected /
this period / best", grey for "previous / average / context", and `--sys-color-success` /
`--sys-color-destructive` only for change up or down, always with an arrow. Chair-time parts
get a fixed order in `--sys-chart-*`: worked, no-show, unmarked, blocked, unsold, other.
Values, labels and legends stay in ink.

**Counter-argument:** six new hues is a taste change in a system that has refused colour
for a year. The Mobbin round shows every reference app doing exactly this split: chrome
monochrome, one series colour at a time, grey context, red/green only on change.

### D4 — The screen, chart by chart

Period control at the top: segments «Ден · Седмица · Месец · Година» plus a «‹ period ›»
stepper with the forward arrow disabled at today, and a «…» pill for a custom range that
becomes a «По избор · Изчисти» chip. Below, in order:

| Question                     | Form                                                                                                                                                                                                                                        | Colour                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| How much, and vs last time   | Hero figure + one-series line (days for week/month, months for year), previous period as a grey line, dashed average rule, right-edge labels, tap → readout; delta chip                                                                     | accent + grey; change in success/destructive |
| Where the time went          | Stacked bars per day / week / month; the legend is the breakdown table beneath it (parts, minutes, share); day scope shows one tall segmented bar                                                                                           | `--sys-chart-1..6`, fixed order              |
| When the shop is busy        | Weekday × hour heatmap, one-hue ramp of the accent, a sentence naming the busiest and emptiest hour (computed by a system)                                                                                                                  | sequential accent ramp                       |
| Free time ahead              | Hero figure + 7 day bars of open minutes, tap a bar → the schedule on that day with `?free=1`                                                                                                                                               | accent, emptiest bar outlined                |
| Which services sell          | Ranked horizontal bars, largest first, € and count on the row, tap → seat rows                                                                                                                                                              | one hue                                      |
| Do clients come back         | Three stat tiles with a 12-period sparkline and a verdict word (rebooked, no-shows, late cancellations); a "waiting" state under the sample floor                                                                                           | sparkline grey, last point accent            |
| How each barber does (admin) | A radar per barber, six axes: € per hour, fill, rebooking, reliability (100 − no-show), tips rate, returning clients; values 0–100 against the shop's best in the period, the base named in the subtitle; previous period as a grey outline | accent fill, grey outline                    |
| Compare two barbers (admin)  | Split bars per metric, the higher side bold; never two overlaid radars                                                                                                                                                                      | two identity tones                           |
| Fill by weekday (shop)       | 100% stacked bars per weekday, share printed inside segments that fit                                                                                                                                                                       | `--sys-chart-*`                              |
| Where bookings come from     | Thin segmented bar with swatches on the three rows                                                                                                                                                                                          | `--sys-chart-*`                              |
| The year                     | 12 month bars + a calendar heatmap of takings per day                                                                                                                                                                                       | accent / accent ramp                         |

A barber sees their own radar against the shop average only when at least three barbers
contribute (v1.1's reference rule), never a ranking (v1 non-goal kept).

### D5 — Entry from the schedule: a route with the search transition

A chart icon button in the schedule's top trailing cluster (between search and the scope
avatar; it shows at every width) navigates to `/staff/analytics?span=DAY&from=<day>&barber=<id>`
inside a `document.startViewTransition`, the button expanding into the analytics headline
the way the search capsule grows into its field. Back restores the schedule from its own
query (`?day&view&barber`). The menu row, the route guards and the e2e stay.

**Counter-argument:** a full-screen `ui-modal-sheet` over the schedule, exactly like search,
closes instantly to where the person was. It loses because analytics stacks its own sheets
(drill-downs, info, export), needs deep links for the period, and would keep the schedule's
listeners and DOM alive under a chart-heavy screen on a phone — the owner's "lag never" rule.
The transition gives the overlay's feel; the route gives everything else.

### D6 — Goals and written findings (v1.2)

A goal is a takings range for the month (Tonal's pattern, never a single imposed number),
set by the barber for themselves and by the admin for the shop, stored on the user record
(`analyticsGoalLowCents`, `analyticsGoalHighCents`, `analyticsGoalMonth`); shown as a
`ui-gauge` ring with seven week dots. Findings are two or three sentences a system computes
(best day, emptiest hour, the largest change vs the previous period, goal pace) and a
presenter words (Law 10) — the system returns tags and figures, never text.

### D7 — Export (v2): CSV, a share card, print to PDF

CSV of the drill-down rows (days, seats, services) through a `Blob` and the Web Share API
with a download fallback — 0 bytes of dependency. A share card: one hero figure, two stats,
one short list, rendered from our own SVG to PNG and shared (Strava's month card). PDF
through a print stylesheet on the report (`window.print()`), not jsPDF (818 kB and a Cyrillic
font). Money never leaves a barber's own scope; the admin's export carries the shop.

### D8 — Pay rule and earnings (v2), sealing

One rule per barber, set by the admin: a percentage of net takings plus an optional fixed
monthly amount, stored on the barber record (`payRateBasisPoints`, `payFixedCents`,
`payCurrency`, `payEffectiveFromLocalDate`). Earnings = rule × the period's takings, shown to
the barber as «Възнаграждение» beside takings only when a rule exists, in a `restricted/`
subdocument's spirit: the rule is readable by admins and the barber it names. Sealing: an
admin seals a closed month (`analyticsSeals/{barberId}__{YYYY-MM}`) and the day documents of
a sealed month are no longer rebuilt; a later visit edit in a sealed month raises a notice
instead. The reconciliation gate from v1 (the agreement specs) must pass on day documents
before pay ships.

**Counter-argument:** pay has legal and tax weight and its rule model (commission tiers,
chair rent, products) may outgrow one percentage. It is kept to one percentage plus a fixed
amount on purpose; anything richer is a design of its own.

## Staging (one PR each, in order)

1. `libs/ui/charts` + the palette tokens + showcase pages + visual baselines.
2. Stored days: the component, the daily job, the triggers, the backfill, the G5 case.
3. The callable v2: DAY/YEAR/CUSTOM spans, comparison base (previous / same last year),
   day documents + live today, hour buckets, the barber radar figures.
4. The screen: the chart-by-chart redesign, the period control, the schedule entry and
   transition, the freshness wording.
5. Goals and findings.
6. Export.
7. Pay rule, earnings and sealing.

## Open questions for the review

- The six categorical hues: derived from the identity tones or chosen fresh? (The validator
  decides what passes; the choice is which family they come from.)
- Does a barber get a day scope of another day than today (a past day's story), or is the
  day scope only "today"? Hypothesis: any day within 12 months, like the week.
- The hour buckets double the day document's size (24 fields); worth it for the heatmap, or
  should the heatmap read the week's visits live (≤ 400 reads)? Hypothesis: store them.
- Custom range cap: 366 days (one read per day) — enough?
